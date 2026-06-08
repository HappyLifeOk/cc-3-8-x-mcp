#!/usr/bin/env node
'use strict';

/**
 * cocos-mcp-router
 *
 * stdio MCP server，聚合所有活跃的 Cocos 编辑器扩展，给客户端暴露统一的 tool 列表。
 *
 * 发现机制：
 *   扫 ~/.cocos-mcp/editors/*.json，每个文件代表一个活跃扩展实例
 *   过滤 mtime > 120s 的（视为已死）
 *   对每个活跃编辑器调 HTTP POST /mcp initialize + tools/list，拿到其 tool 清单
 *
 * 命名：
 *   tool 名前缀化：<projectShortName>__<originalName>
 *   例：my-project__scene_query_node_tree
 *
 * 转发：
 *   tools/call 收到前缀名 → 拆出 projectShortName → 查 editor URL → HTTP 转发
 *
 * 客户端接入：
 *   claude mcp add cocos -- node /path/to/forest/extensions/cc-3-8-x-mcp/router/bin.js
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');

var offlineTools = require('./src/offline-tools.js');
var editorControl = require('./src/editor-control.js');

var REGISTRY_DIR = path.join(os.homedir(), '.cocos-mcp', 'editors');
var STALE_MS = 120 * 1000;  // 2 分钟没心跳视为死
var DISCOVERY_INTERVAL_MS = 15 * 1000;
var PROTOCOL_VERSION = '2024-11-05';
var ROUTER_INFO = { name: 'cocos-mcp-router', version: '0.1.0' };

function logErr() {
    // router 走 stdio，不能往 stdout 写非 JSON-RPC 内容，日志只能走 stderr
    var args = Array.prototype.slice.call(arguments);
    process.stderr.write('[cocos-mcp-router] ' + args.join(' ') + '\n');
}

// ── 发现活跃编辑器 ──

/** @type {Map<string, {shortName, url, pid, tools: Array, lastProbed: number}>} */
var editors = new Map();

function scanRegistry() {
    var entries = [];
    try {
        if (!fs.existsSync(REGISTRY_DIR)) return entries;
        var files = fs.readdirSync(REGISTRY_DIR);
        var now = Date.now();
        files.forEach(function (name) {
            if (!name.endsWith('.json')) return;
            var full = path.join(REGISTRY_DIR, name);
            try {
                var st = fs.statSync(full);
                if (now - st.mtimeMs > STALE_MS) {
                    // stale：编辑器已退出/崩溃超 STALE_MS 未更新心跳。直接删文件而非仅跳过——
                    // 崩溃/强杀不会调 removeRegistry，旧实现只 return 不删 → 死文件无限堆积（曾攒 1100+）。
                    try { fs.unlinkSync(full); } catch (e) { /* ignore */ }
                    return;
                }
                var info = JSON.parse(fs.readFileSync(full, 'utf-8'));
                if (!info || !info.url) return;
                entries.push(info);
            } catch (e) { /* ignore */ }
        });
    } catch (e) { logErr('scanRegistry:', e.message); }
    return entries;
}

function httpJsonRpc(targetUrl, body) {
    return new Promise(function (resolve, reject) {
        try {
            var u = new URL(targetUrl);
            var data = JSON.stringify(body);
            var req = http.request({
                hostname: u.hostname,
                port: u.port,
                path: u.pathname,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
                timeout: 8000,
            }, function (res) {
                var chunks = [];
                res.on('data', function (c) { chunks.push(c); });
                res.on('end', function () {
                    var raw = Buffer.concat(chunks).toString('utf-8');
                    try { resolve(JSON.parse(raw)); }
                    catch (e) { reject(new Error('invalid json from ' + targetUrl + ': ' + raw.slice(0, 120))); }
                });
            });
            req.on('error', reject);
            req.on('timeout', function () { req.destroy(new Error('timeout')); });
            req.write(data);
            req.end();
        } catch (e) { reject(e); }
    });
}

async function probeEditor(info) {
    try {
        var initRes = await httpJsonRpc(info.url, {
            jsonrpc: '2.0', id: 1, method: 'initialize', params: {
                protocolVersion: PROTOCOL_VERSION,
                clientInfo: { name: 'cocos-mcp-router', version: ROUTER_INFO.version },
                capabilities: {},
            },
        });
        if (initRes.error) throw new Error(initRes.error.message);
        var listRes = await httpJsonRpc(info.url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
        if (listRes.error) throw new Error(listRes.error.message);
        return listRes.result.tools || [];
    } catch (e) {
        logErr('probe failed', info.projectShortName, info.url, e.message);
        return null;
    }
}

async function probeEditorResources(info) {
    try {
        var listRes = await httpJsonRpc(info.url, { jsonrpc: '2.0', id: 3, method: 'resources/list' });
        if (listRes.error) throw new Error(listRes.error.message);
        return listRes.result.resources || [];
    } catch (e) {
        return [];
    }
}

/** 去掉 shortName 里的非法字符，MCP tool 名只允许 [a-zA-Z0-9_-] */
function sanitizeShortName(name) {
    return String(name || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function discover() {
    var entries = scanRegistry();
    var seen = new Set();
    for (var i = 0; i < entries.length; i++) {
        var info = entries[i];
        var key = info.url;
        seen.add(key);
        if (editors.has(key)) continue;  // 已知，不重复 probe
        var tools = await probeEditor(info);
        if (tools == null) continue;
        var resources = await probeEditorResources(info);
        editors.set(key, {
            baseShortName: sanitizeShortName(info.projectShortName),
            shortName: sanitizeShortName(info.projectShortName),   // dedupeShortNames 会按冲突重设
            projectPath: info.projectPath,
            pid: info.pid,
            url: info.url,
            tools: tools,
            resources: resources,
            lastProbed: Date.now(),
        });
        logErr('discovered editor', info.projectShortName, 'pid=' + info.pid, info.url, tools.length + ' tools');
    }
    // 清理已消失的
    for (var key2 of Array.from(editors.keys())) {
        if (!seen.has(key2)) {
            var old = editors.get(key2);
            logErr('lost editor', old.shortName, old.url);
            editors.delete(key2);
        }
    }
    // shortName 撞名去重（多编辑器 projectShortName 相同时，否则 tool 前缀冲突会把请求路由到错的编辑器）
    dedupeShortNames();
}

/**
 * shortName 撞名去重：多个编辑器 projectShortName 算出来相同时（如某仓库下 my-app/client 和
 * my-app/server 两个项目都被 getProjectShortName 算成 my-app），
 * tool 前缀 `<shortName>__xxx` 冲突 → findEditorByPrefixedTool 只命中第一个 → 请求串到错的编辑器。
 * 冲突的用 projectPath 末段（client / server）加后缀区分，单实例保持原名不变。
 */
function dedupeShortNames() {
    var counts = {};
    for (var ed of editors.values()) {
        counts[ed.baseShortName] = (counts[ed.baseShortName] || 0) + 1;
    }
    var used = {};
    for (var ed2 of editors.values()) {
        if (counts[ed2.baseShortName] > 1) {
            var suffix = sanitizeShortName(path.basename(ed2.projectPath || 'unknown'));
            var name = ed2.baseShortName + '-' + suffix;
            // 极端情况末段也相同，再加序号兜底
            var n = 2;
            while (used[name] && used[name] !== ed2.url) { name = ed2.baseShortName + '-' + suffix + '-' + n; n++; }
            ed2.shortName = name;
            used[name] = ed2.url;
        } else {
            ed2.shortName = ed2.baseShortName;
        }
    }
}

function buildAggregatedToolList() {
    var out = [];
    for (var ed of editors.values()) {
        ed.tools.forEach(function (t) {
            out.push({
                name: ed.shortName + '__' + t.name,
                description: '[' + ed.shortName + '] ' + (t.description || ''),
                inputSchema: t.inputSchema || { type: 'object', properties: {} },
            });
        });
    }
    // router 自身的 meta tool
    out.push({
        name: 'router_list_editors',
        description: '列出当前 router 发现的所有活跃 Cocos 编辑器（shortName / pid / url / tool 数）',
        inputSchema: { type: 'object', properties: {} },
    });
    // offline prefab tools（不需要编辑器运行）
    offlineTools.OFFLINE_TOOLS.forEach(function (t) { out.push(t); });
    // 编辑器进程管理 tools（spawn/kill/restart/wait_ready，不需要编辑器运行）
    editorControl.EDITOR_TOOLS.forEach(function (t) { out.push(t); });
    return out;
}

function encodeRouterResourceUri(ed, uri) {
    return 'cocos-router://' + ed.shortName + '/' + encodeURIComponent(uri);
}

function decodeRouterResourceUri(uri) {
    var m = String(uri || '').match(/^cocos-router:\/\/([^\/]+)\/(.+)$/);
    if (!m) return null;
    return { shortName: m[1], uri: decodeURIComponent(m[2]) };
}

function buildAggregatedResourceList() {
    var out = [];
    for (var ed of editors.values()) {
        (ed.resources || []).forEach(function (r) {
            out.push({
                uri: encodeRouterResourceUri(ed, r.uri),
                name: '[' + ed.shortName + '] ' + (r.name || r.uri),
                description: r.description || '',
                mimeType: r.mimeType || 'text/plain',
            });
        });
    }
    return out;
}

function findEditorByShortName(shortName) {
    for (var ed of editors.values()) {
        if (ed.shortName === shortName) return ed;
    }
    return null;
}

function findEditorByPrefixedTool(prefixedName) {
    for (var ed of editors.values()) {
        var pfx = ed.shortName + '__';
        if (prefixedName.indexOf(pfx) === 0) {
            return { editor: ed, originalName: prefixedName.substring(pfx.length) };
        }
    }
    return null;
}

// ── stdio JSON-RPC ──

var stdinBuf = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', function (chunk) {
    stdinBuf += chunk;
    // MCP stdio 协议：按行切分 JSON-RPC 消息（每条独立 JSON）
    var lines = stdinBuf.split('\n');
    stdinBuf = lines.pop();
    lines.forEach(function (line) {
        line = line.trim();
        if (!line) return;
        var msg;
        try { msg = JSON.parse(line); }
        catch (e) { logErr('parse error:', line.slice(0, 120)); return; }
        handleMessage(msg);
    });
});

function send(obj) {
    if (obj == null) return;
    process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handleMessage(msg) {
    if (msg.jsonrpc !== '2.0') return;
    var id = msg.id;
    var method = msg.method;
    var params = msg.params || {};

    try {
        var result;
        switch (method) {
            case 'initialize':
                await discover();
                result = {
                    protocolVersion: PROTOCOL_VERSION,
                    serverInfo: ROUTER_INFO,
                    capabilities: {
                        tools: { listChanged: true },
                        resources: {},
                        logging: {},
                    },
                };
                break;
            case 'initialized':
            case 'notifications/initialized':
                if (id == null) return;
                result = {};
                break;
            case 'ping':
                result = {};
                break;
            case 'tools/list':
                await discover();
                result = { tools: buildAggregatedToolList() };
                break;
            case 'resources/list':
                await discover();
                result = { resources: buildAggregatedResourceList() };
                break;
            case 'resources/read':
                result = await handleResourceRead(params.uri);
                break;
            case 'tools/call':
                result = await handleToolCall(params.name, params.arguments || {});
                break;
            default:
                throw Object.assign(new Error('method not found: ' + method), { code: -32601 });
        }
        if (id == null) return;
        send({ jsonrpc: '2.0', id: id, result: result });
    } catch (e) {
        if (id == null) return;
        send({ jsonrpc: '2.0', id: id, error: { code: e.code || -32603, message: e.message || 'internal error' } });
    }
}

async function handleToolCall(name, args) {
    // Router 自身的 meta tool
    if (name === 'router_list_editors') {
        await discover();
        var list = Array.from(editors.values()).map(function (ed) {
            return { shortName: ed.shortName, pid: ed.pid, url: ed.url, projectPath: ed.projectPath, toolCount: ed.tools.length };
        });
        return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
    }

    // Offline prefab tools（不需要编辑器运行，同进程调用 cli）
    if (offlineTools.isOfflineTool(name)) {
        return await offlineTools.handleOfflineToolCall(name, args);
    }

    // 编辑器进程管理 tools（spawn/kill/restart/wait_ready，router 本地执行，不走转发）
    if (editorControl.isEditorTool(name)) {
        return await editorControl.handleEditorToolCall(name, args);
    }

    var hit = findEditorByPrefixedTool(name);
    if (!hit) {
        // 可能是新增编辑器，re-discover 再试一次
        await discover();
        hit = findEditorByPrefixedTool(name);
    }
    if (!hit) {
        return { content: [{ type: 'text', text: 'unknown tool: ' + name + '\n可用编辑器: ' + Array.from(editors.values()).map(function(e){return e.shortName;}).join(', ') }], isError: true };
    }

    try {
        var forward = await httpJsonRpc(hit.editor.url, {
            jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
            params: { name: hit.originalName, arguments: args },
        });
        if (forward.error) {
            return { content: [{ type: 'text', text: 'editor error: ' + forward.error.message }], isError: true };
        }
        return forward.result;
    } catch (e) {
        // 编辑器可能关闭了，移除缓存
        editors.delete(hit.editor.url);
        return { content: [{ type: 'text', text: 'forward failed: ' + e.message }], isError: true };
    }
}

// ── 周期性重扫 ──
async function handleResourceRead(uri) {
    var decoded = decodeRouterResourceUri(uri);
    if (!decoded) {
        return { contents: [{ type: 'text', text: 'unknown router resource uri: ' + uri, mimeType: 'text/plain' }] };
    }
    await discover();
    var ed = findEditorByShortName(decoded.shortName);
    if (!ed) {
        return { contents: [{ type: 'text', text: 'editor not found for resource: ' + decoded.shortName, mimeType: 'text/plain' }] };
    }
    try {
        var forward = await httpJsonRpc(ed.url, {
            jsonrpc: '2.0', id: Date.now(), method: 'resources/read',
            params: { uri: decoded.uri },
        });
        if (forward.error) {
            return { contents: [{ type: 'text', text: 'editor error: ' + forward.error.message, mimeType: 'text/plain' }] };
        }
        return forward.result;
    } catch (e) {
        editors.delete(ed.url);
        return { contents: [{ type: 'text', text: 'forward failed: ' + e.message, mimeType: 'text/plain' }] };
    }
}

setInterval(function () { discover().catch(function () {}); }, DISCOVERY_INTERVAL_MS);

// 启动首次发现
discover().catch(function (e) { logErr('initial discover failed', e.message); });
logErr('cocos-mcp-router started (stdio)');
