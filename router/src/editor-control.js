'use strict';

/**
 * router/src/editor-control.js
 *
 * Router 级编辑器进程管理 tool。spawn / kill / wait_ready / restart Cocos 编辑器进程。
 *
 * 为什么挂在 router（而不是编辑器内 server）：
 *   编辑器内的 MCP server 寄生在编辑器进程里，kill 编辑器 = kill server 自己，自杀后没法
 *   再把自己拉起来。router 是进程外的常驻 stdio 进程，编辑器死了它还活着，所以「关 / 重启 /
 *   等就绪」这类要跨越编辑器进程生死的能力只能放这里，跟 offline prefab tools 同类，不走转发。
 *
 * 定位机制：直接读注册目录 ~/.cocos-mcp/editors/<pid>.json（与 bin.js scanRegistry 同源），
 *   不依赖 bin.js 的 editors Map —— 因为要管理「还没就绪」和「已被 kill」的实例，那些不在 Map 里。
 *
 * [editor] tool 命名不加 shortName 前缀（router 全局工具）。
 *
 * 跨平台：execPath 优先用注册表（编辑器写入）/ 运行进程查询，不硬编码平台安装路径。
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');
var cp = require('child_process');

var REGISTRY_DIR = path.join(os.homedir(), '.cocos-mcp', 'editors');
var STALE_MS = 120 * 1000;          // 与 bin.js 对齐：2 分钟没心跳视为死
var PROTOCOL_VERSION = '2024-11-05';

// ── 通用小工具 ──────────────────────────────────────────────────

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/** MCP tool 名只允许 [a-zA-Z0-9_-]，与 bin.js sanitizeShortName 保持一致 */
function sanitize(name) {
    return String(name || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function jsonContent(obj, isError) {
    var r = { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
    if (isError) r.isError = true;
    return r;
}

/** 进程是否存活：kill(pid, 0) 不抛 = 活；EPERM = 存在但无权限（仍算活） */
function isAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; }
    catch (e) { return e.code === 'EPERM'; }
}

// ── 注册表读取 ──────────────────────────────────────────────────

/**
 * 读注册目录全部 entry，附带 stale 标记和 mtime。
 * 不删 stale 文件（删由 bin.js scanRegistry 负责，这里只读，避免和 bin.js 抢删竞态）。
 */
function readRegistryEntries() {
    var out = [];
    try {
        if (!fs.existsSync(REGISTRY_DIR)) return out;
        var now = Date.now();
        fs.readdirSync(REGISTRY_DIR).forEach(function (name) {
            if (!name.endsWith('.json')) return;
            var full = path.join(REGISTRY_DIR, name);
            try {
                var st = fs.statSync(full);
                var info = JSON.parse(fs.readFileSync(full, 'utf-8'));
                if (!info) return;
                info.stale = (now - st.mtimeMs > STALE_MS);
                info.mtimeMs = st.mtimeMs;
                out.push(info);
            } catch (e) { /* 单个坏文件跳过 */ }
        });
    } catch (e) { /* ignore */ }
    return out;
}

/**
 * 真正可用的编辑器实例。除 stale / url 外，必须 isAlive(pid) —— 关键：
 * 进程崩溃 / 被重启但没走优雅退出时，注册文件会残留到 120s stale 才被清，这段窗口内
 * 仅按 mtime 会把「已死实例」误判为活跃，污染 resolveTarget 的多实例判断（曾误拦无参 restart）。
 */
function activeEditors() {
    return readRegistryEntries().filter(function (e) { return !e.stale && e.url && isAlive(e.pid); });
}

function removeRegistryFile(pid) {
    try {
        var f = path.join(REGISTRY_DIR, pid + '.json');
        if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (e) { /* ignore */ }
}

// ── 目标解析 ────────────────────────────────────────────────────

/** 把活跃 entry 列成简短描述，给报错用 */
function describeActive() {
    var list = activeEditors().map(function (e) {
        return sanitize(e.projectShortName) + '(pid=' + e.pid + ')';
    });
    return list.length ? list.join(', ') : '无';
}

/**
 * 在「活跃」实例里按 shortName / projectPath / pid 定位唯一目标。
 * 无任何指定且只有一个活跃实例时默认它；零个或多个都报错要求显式指定。
 * 用于 kill / restart —— 它们都作用于「当前还活着的编辑器」。
 */
function resolveTarget(args) {
    args = args || {};
    var entries = activeEditors();

    if (args.pid) {
        var byPid = entries.filter(function (e) { return e.pid === args.pid; });
        if (byPid.length) return byPid[0];
        throw new Error('editor-control: 没有 pid=' + args.pid + ' 的活跃编辑器。当前活跃：' + describeActive());
    }
    if (args.projectPath) {
        var byPath = entries.filter(function (e) { return e.projectPath === args.projectPath; });
        if (byPath.length) return byPath[0];
        throw new Error('editor-control: 没有 projectPath=' + args.projectPath + ' 的活跃编辑器。当前活跃：' + describeActive());
    }
    if (args.shortName) {
        var want = sanitize(args.shortName);
        var byName = entries.filter(function (e) { return sanitize(e.projectShortName) === want; });
        if (byName.length) return byName[0];
        throw new Error('editor-control: 没有 shortName=' + args.shortName + ' 的活跃编辑器。当前活跃：' + describeActive());
    }
    // 无指定
    if (entries.length === 1) return entries[0];
    if (entries.length === 0) {
        throw new Error('editor-control: 没有活跃的 Cocos 编辑器。若编辑器未运行，请用 editor_restart 并显式传 projectPath（无法从空注册表推断项目路径）。');
    }
    throw new Error('editor-control: 有多个活跃编辑器，请用 shortName / projectPath / pid 指定。当前活跃：' + describeActive());
}

// ── execPath 解析（三级 fallback）───────────────────────────────

/** 从运行中进程的命令行抓可执行路径（编辑器启动命令首段，--project 之前） */
function execPathFromPs(pid) {
    try {
        if (process.platform === 'win32') {
            // TODO[win-verify]: Win 没有 ps。下面用 wmic 拿可执行路径，需在 Win 上实测确认（新版 Win 可能要改 PowerShell Get-CimInstance）
            var winOut = cp.execFileSync('wmic', ['process', 'where', 'processid=' + pid, 'get', 'ExecutablePath', '/value'], { encoding: 'utf-8' });
            var wm = winOut.match(/ExecutablePath=(.+)/);
            return wm ? wm[1].trim() : '';
        }
        // mac / linux: ps 抓命令行首段（--project 之前）
        var out = cp.execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf-8' }).trim();
        if (!out) return '';
        var idx = out.indexOf(' --');
        return (idx >= 0 ? out.slice(0, idx) : out.split(/\s+/)[0]).trim();
    } catch (e) { return ''; }
}

/**
 * 解析编辑器可执行路径，两级 fallback：
 *   1. 注册文件 execPath 字段（main.js 写入，最准）
 *   2. 从活进程命令行抓（编辑器还活着时）—— restart 会在 kill 前调用，此时旧进程还在
 * 全部失败抛错。
 */
function resolveExecPath(entry) {
    if (entry.execPath && fs.existsSync(entry.execPath)) return entry.execPath;

    if (entry.pid && isAlive(entry.pid)) {
        var fromPs = execPathFromPs(entry.pid);
        if (fromPs && fs.existsSync(fromPs)) return fromPs;
    }

    throw new Error(
        'editor-control: 无法解析 Cocos 编辑器可执行路径。\n' +
        '  注册文件 execPath: ' + (entry.execPath || '(无)') + '\n' +
        '  editorVersion: ' + (entry.editorVersion || '(无)') + '\n' +
        '请重启编辑器让扩展写入 execPath 字段，或用 editor_spawn 显式传 execPath。'
    );
}

// ── 进程操作 ────────────────────────────────────────────────────

/**
 * kill 指定编辑器：先 SIGTERM 优雅退，graceMs 内没退再 SIGKILL，最后主动删注册文件。
 * 主动删的原因：强杀 / 崩溃不会走 main.js removeRegistry，靠 router 120s stale 清理太慢，
 *   会导致 wait_ready 误匹配到「已死但文件还新鲜」的旧 entry。
 */
async function killEditor(pid, opts) {
    opts = opts || {};
    var graceMs = opts.graceMs || 6000;

    if (!isAlive(pid)) {
        removeRegistryFile(pid);
        return { killed: false, reason: 'not running', pid: pid };
    }

    var signal = opts.hard ? 'SIGKILL' : 'SIGTERM';
    try { process.kill(pid, signal); } catch (e) { /* 可能刚好退了 */ }

    var start = Date.now();
    while (Date.now() - start < graceMs) {
        await sleep(150);
        if (!isAlive(pid)) break;
    }

    var escalated = false;
    if (isAlive(pid)) {
        escalated = true;
        try { process.kill(pid, 'SIGKILL'); } catch (e) { /* ignore */ }
        await sleep(400);
    }

    removeRegistryFile(pid);
    return {
        killed: !isAlive(pid),
        pid: pid,
        signal: signal,
        escalatedToSigkill: escalated,
        waitedMs: Date.now() - start,
    };
}

/**
 * 冷启动场景解析 execPath：进程已不在，没有活进程可 ps 抓，靠两级 fallback：
 *   1. args.execPath 显式
 *   2. 借任意一条注册 entry 的 execPath —— execPath 是机器级安装路径，跨项目通用、跨平台，
 *      哪怕那条 entry 是别的项目 / 已 stale 也能用
 */
function resolveExecPathForSpawn(args, projectPath) {
    if (args.execPath && fs.existsSync(args.execPath)) return args.execPath;

    // 借任意一条注册 entry 的 execPath（机器级安装路径，跨项目通用、跨平台）
    var borrowed = readRegistryEntries().filter(function (e) { return e.execPath && fs.existsSync(e.execPath); })[0];
    if (borrowed) return borrowed.execPath;

    throw new Error('editor_spawn: 无法解析 Cocos 可执行路径。请传 execPath（注册表无可借项时无法推断安装路径）。');
}

/**
 * detached 拉起编辑器，立即与 router 解耦（router 退出不带走编辑器）。
 * 返回的是 launcher pid，不一定等于编辑器主进程最终 pid —— 真实 pid 以 wait_ready
 * 扫注册表拿到的为准，这里的 pid 仅供日志参考。
 */
function buildEditorSpawnArgs(projectPath, opts) {
    opts = opts || {};
    var args = ['--project', projectPath];
    if (opts.noLogin !== false) args.push('--nologin');
    return args;
}

function spawnEditor(execPath, projectPath, opts) {
    var child = cp.spawn(execPath, buildEditorSpawnArgs(projectPath, opts), {
        detached: true,
        stdio: 'ignore',
    });
    child.unref();
    return child.pid;
}

// ── 就绪探测 ────────────────────────────────────────────────────

/** 通用 HTTP MCP 调用，返回完整 JSON-RPC 响应（失败返回 null）。probeReady/probeProjectReady 共用。 */
function httpMcp(url, method, params, timeoutMs) {
    return new Promise(function (resolve) {
        try {
            var u = new URL(url);
            var body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params || {} });
            var req = http.request({
                hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                timeout: timeoutMs || 4000,
            }, function (res) {
                var chunks = [];
                res.on('data', function (c) { chunks.push(c); });
                res.on('end', function () {
                    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
                    catch (e) { resolve(null); }
                });
            });
            req.on('error', function () { resolve(null); });
            req.on('timeout', function () { req.destroy(); resolve(null); });
            req.write(body);
            req.end();
        } catch (e) { resolve(null); }
    });
}

/** MCP initialize 探活：能 initialize = MCP server 起来了（但不代表进了项目，登录页态也能起）。 */
function probeReady(url) {
    return httpMcp(url, 'initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'editor-control', version: '0' },
        capabilities: {},
    }).then(function (r) { return !!(r && !r.error); });
}

/**
 * 项目就绪探测：MCP initialize 成功 ≠ 进了项目 —— 实测激进清登录态后 initialize 仍 ready，
 * 但编辑器 UI 卡在登录页。用 asset_query_assets 查 db://assets/* 探 asset-db 是否就绪：
 * 项目真打开才加载 asset-db、返回非空顶层资源；登录页 / 项目加载中则空或失败。
 * 正向（进项目非空）已实测；负向（登录页态返回啥）按逻辑推断，未在登录页态实测。
 */
function probeProjectReady(url) {
    return httpMcp(url, 'tools/call', {
        name: 'asset_query_assets', arguments: { pattern: 'db://assets/*' },
    }, 6000).then(function (r) {
        return hasReadyAssetResult(r);
    });
}

function hasReadyAssetResult(r) {
    if (!r || r.error || !r.result || r.result.isError) return false;

    var content = r.result.content;
    if (Array.isArray(content)) {
        if (content.length === 0) return false;
        if (content[0] && content[0].type === 'text') {
            return hasReadyAssetText(content[0].text);
        }
        return true;
    }

    if (Array.isArray(r.result)) return r.result.length > 0;
    return false;
}

function hasReadyAssetText(txt) {
    if (!txt) return false;
    try {
        var parsed = JSON.parse(txt);
        if (Array.isArray(parsed)) return parsed.length > 0;
        if (parsed && Array.isArray(parsed.content)) return parsed.content.length > 0;
    } catch (e) {
        return false;
    }
    return false;
}

/**
 * 轮询等指定项目的编辑器就绪。
 *   就绪判定：注册表有 projectPath 匹配、非 stale、pid≠excludePid 的 entry，且 probeReady 成功。
 *   excludePid：restart 时传被 kill 的旧 pid，避免匹配到尚未删净的旧注册。
 * 返回 { ready, entry?, reason?, waitedMs }。
 */
async function waitReady(projectPath, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs || 90000;   // 大项目冷启动慢，默认 90s
    var excludePid = opts.excludePid || 0;
    var requireProject = opts.requireProject !== false;   // 默认要求项目就绪（区分登录页/加载中），传 false 退回只看 MCP
    var start = Date.now();
    var lastReason = 'still waiting';
    var sawMcp = false;

    while (Date.now() - start < timeoutMs) {
        var hit = activeEditors().filter(function (e) {
            return e.projectPath === projectPath && e.pid !== excludePid;
        })[0];

        if (hit) {
            var mcpOk = await probeReady(hit.url);
            if (mcpOk) {
                sawMcp = true;
                var projOk = requireProject ? await probeProjectReady(hit.url) : true;
                if (projOk) {
                    return {
                        ready: true, mcpReady: true, projectReady: projOk,
                        entry: {
                            shortName: sanitize(hit.projectShortName),
                            pid: hit.pid, url: hit.url, port: hit.port,
                            projectPath: hit.projectPath, editorVersion: hit.editorVersion,
                        },
                        waitedMs: Date.now() - start,
                    };
                }
                lastReason = 'MCP up (pid=' + hit.pid + ') 但 asset-db 未就绪，可能卡在 Cocos Developer Login 或项目加载中';
            } else {
                lastReason = 'registered (pid=' + hit.pid + ') but MCP server not responding yet';
            }
        } else {
            lastReason = 'no fresh registry entry for project yet (editor still booting)';
        }
        await sleep(1000);
    }
    var res = { ready: false, mcpReady: sawMcp, projectReady: false, reason: lastReason, waitedMs: Date.now() - start };
    if (sawMcp) {
        res.hint = '⚠️ MCP server 起来了但项目没就绪。若是 router 拉起/重启编辑器，请确认 spawnArgs 包含 --nologin；若是手动拉起，可能卡在 Cocos Developer Login 或仍在加载项目。';
    }
    return res;
}

// ── Tool 定义 ───────────────────────────────────────────────────

var COMMON_TARGET_PROPS = {
    shortName: { type: 'string', description: '编辑器短名（工具前缀名，如 my-project）。只有一个编辑器时可省略。' },
    projectPath: { type: 'string', description: '项目绝对路径，定位最精确。编辑器未运行时（restart/wait_ready）必须用它。' },
    noLogin: { type: 'boolean', description: '拉起/重启编辑器时追加 Cocos 内置 --nologin，默认 true；传 false 禁用。' },
};

var EDITOR_TOOLS = [
    {
        name: 'editor_restart',
        description: '[editor] 重启 Cocos 编辑器进程（kill 旧实例 → 重新拉起 → 等就绪）。' +
            '不需要编辑器在运行也能调（挂 router 进程）。' +
            '返回 oldPid / launchedPid / kill 结果 / ready 状态（含新 pid·port·url）。',
        inputSchema: {
            type: 'object',
            properties: {
                shortName: COMMON_TARGET_PROPS.shortName,
                projectPath: COMMON_TARGET_PROPS.projectPath,
                pid: { type: 'number', description: '直接按 pid 定位要重启的编辑器。' },
                hard: { type: 'boolean', description: 'true=直接 SIGKILL，不给优雅退出窗口。默认 false（先 SIGTERM）。' },
                timeoutMs: { type: 'number', description: '等新实例就绪的超时（毫秒），默认 90000。' },
                noLogin: COMMON_TARGET_PROPS.noLogin,
            },
        },
    },
    {
        name: 'editor_wait_ready',
        description: '[editor] 等指定项目的 Cocos 编辑器就绪（注册文件出现且 MCP server 能 initialize）。' +
            '用于「拉起编辑器后等它起来再操作」。已就绪则立即返回。' +
            '编辑器尚未运行时必须传 projectPath（空注册表无法从 shortName 反推路径）。',
        inputSchema: {
            type: 'object',
            properties: {
                shortName: COMMON_TARGET_PROPS.shortName,
                projectPath: COMMON_TARGET_PROPS.projectPath,
                timeoutMs: { type: 'number', description: '超时（毫秒），默认 90000。' },
                excludePid: { type: 'number', description: '排除某个 pid（如刚被 kill 的旧实例），避免误判旧注册为就绪。' },
            },
        },
    },
    {
        name: 'editor_kill',
        description: '[editor] 关闭 Cocos 编辑器进程（SIGTERM，超时升级 SIGKILL，并清理注册文件）。' +
            '不需要编辑器内 server 配合（挂 router 进程）。',
        inputSchema: {
            type: 'object',
            properties: {
                shortName: COMMON_TARGET_PROPS.shortName,
                projectPath: COMMON_TARGET_PROPS.projectPath,
                pid: { type: 'number', description: '直接按 pid 定位。' },
                hard: { type: 'boolean', description: 'true=直接 SIGKILL。默认 false。' },
                graceMs: { type: 'number', description: 'SIGTERM 后等待优雅退出的时长（毫秒），默认 6000，超时强杀。' },
            },
        },
    },
    {
        name: 'editor_spawn',
        description: '[editor] 从零启动一个 Cocos 编辑器（进程完全不在时用，如崩溃后恢复）。' +
            '同项目已有活跃实例则直接返回不重复开（Cocos 不支持同项目多开）。',
        inputSchema: {
            type: 'object',
            properties: {
                projectPath: { type: 'string', description: '项目绝对路径（必填）。' },
                version: { type: 'string', description: 'Cocos 版本号（如 3.8.8），用于拼可执行路径。不传则从注册表借或扫唯一安装。' },
                execPath: { type: 'string', description: '直接指定可执行路径，优先级最高。' },
                timeoutMs: { type: 'number', description: '等就绪超时（毫秒），默认 90000。' },
                noLogin: COMMON_TARGET_PROPS.noLogin,
            },
            required: ['projectPath'],
        },
    },
];

var EDITOR_TOOL_NAMES = new Set(EDITOR_TOOLS.map(function (t) { return t.name; }));

function isEditorTool(name) {
    return EDITOR_TOOL_NAMES.has(name);
}

// ── Tool 调用处理 ───────────────────────────────────────────────

async function handleEditorToolCall(name, args) {
    args = args || {};

    if (name === 'editor_restart') {
        var target;
        try {
            target = resolveTarget(args);
        } catch (e) {
            // 无活跃实例但给了 projectPath → 进程崩溃/消失了，降级为冷启动 spawn（崩溃恢复闭环）
            if (args.projectPath) return await handleEditorToolCall('editor_spawn', args);
            throw e;
        }
        var execPath = resolveExecPath(target);     // kill 前解析，此时旧进程还活着，ps 兜底有效
        var projectPath = target.projectPath;
        var oldPid = target.pid;

        var killRes = await killEditor(oldPid, { hard: args.hard });
        var spawnArgs = buildEditorSpawnArgs(projectPath, { noLogin: args.noLogin });
        var launchedPid = spawnEditor(execPath, projectPath, { noLogin: args.noLogin });
        var ready = await waitReady(projectPath, { timeoutMs: args.timeoutMs, excludePid: oldPid });

        return jsonContent({
            action: 'restart',
            shortName: sanitize(target.projectShortName),
            projectPath: projectPath,
            execPath: execPath,
            spawnArgs: spawnArgs,
            oldPid: oldPid,
            launchedPid: launchedPid,
            kill: killRes,
            ready: ready,
        }, !ready.ready);
    }

    if (name === 'editor_wait_ready') {
        var pp = args.projectPath;
        if (!pp) {
            // 没给 projectPath：尝试从活跃实例（可选 shortName 过滤）推断
            var act = activeEditors();
            if (args.shortName) {
                var want = sanitize(args.shortName);
                act = act.filter(function (e) { return sanitize(e.projectShortName) === want; });
            }
            if (act.length === 1) pp = act[0].projectPath;
            else if (act.length === 0) {
                throw new Error('editor_wait_ready: 没有活跃编辑器可推断 projectPath。编辑器尚未就绪时必须显式传 projectPath（指定等待哪个项目）。');
            } else {
                throw new Error('editor_wait_ready: 有多个活跃编辑器，请传 projectPath 或 shortName 指定。当前活跃：' + describeActive());
            }
        }
        var r = await waitReady(pp, { timeoutMs: args.timeoutMs, excludePid: args.excludePid });
        return jsonContent({ action: 'wait_ready', projectPath: pp, result: r }, !r.ready);
    }

    if (name === 'editor_kill') {
        var t = resolveTarget(args);
        var res = await killEditor(t.pid, { hard: args.hard, graceMs: args.graceMs });
        return jsonContent({
            action: 'kill',
            shortName: sanitize(t.projectShortName),
            projectPath: t.projectPath,
            result: res,
        }, !res.killed);
    }

    if (name === 'editor_spawn') {
        var spProject = args.projectPath;
        if (!spProject || !path.isAbsolute(spProject)) {
            throw new Error('editor_spawn: projectPath 必填且必须是绝对路径，收到 ' + JSON.stringify(spProject));
        }
        // 幂等：同项目已有活跃实例直接返回（Cocos 不支持同项目多开）
        var spRunning = activeEditors().filter(function (e) { return e.projectPath === spProject; })[0];
        if (spRunning) {
            return jsonContent({
                action: 'spawn', alreadyRunning: true,
                entry: {
                    shortName: sanitize(spRunning.projectShortName), pid: spRunning.pid,
                    url: spRunning.url, port: spRunning.port, projectPath: spRunning.projectPath,
                },
            });
        }
        var spExec = resolveExecPathForSpawn(args, spProject);
        var spSpawnArgs = buildEditorSpawnArgs(spProject, { noLogin: args.noLogin });
        var spPid = spawnEditor(spExec, spProject, { noLogin: args.noLogin });
        var spReady = await waitReady(spProject, { timeoutMs: args.timeoutMs });
        return jsonContent({
            action: 'spawn', execPath: spExec, spawnArgs: spSpawnArgs, launchedPid: spPid, ready: spReady,
        }, !spReady.ready);
    }

    throw new Error('editor-control: 未知 tool "' + name + '"');
}

module.exports = {
    EDITOR_TOOLS: EDITOR_TOOLS,
    isEditorTool: isEditorTool,
    handleEditorToolCall: handleEditorToolCall,
    // 导出内部函数供测试 / bin.js 复用
    readRegistryEntries: readRegistryEntries,
    activeEditors: activeEditors,
    resolveTarget: resolveTarget,
    resolveExecPath: resolveExecPath,
    resolveExecPathForSpawn: resolveExecPathForSpawn,
    buildEditorSpawnArgs: buildEditorSpawnArgs,
    waitReady: waitReady,
    probeReady: probeReady,
    probeProjectReady: probeProjectReady,
    hasReadyAssetResult: hasReadyAssetResult,
    isAlive: isAlive,
};
