'use strict';

/**
 * 最小 MCP Server 实现（JSON-RPC 2.0 over HTTP）
 *
 * 协议参考：https://modelcontextprotocol.io/
 * 只实现 MCP 客户端常用的方法，够 Claude Code / Cursor 调用即可：
 *   - initialize
 *   - tools/list
 *   - tools/call
 *   - resources/list
 *   - resources/read
 *   - ping
 *
 * 传输：streamable HTTP 子集
 *   - 唯一端点 POST /mcp，body 是 JSON-RPC 请求，response 是 JSON-RPC 响应
 *   - 不处理 SSE / session resumption（第一版足够）
 *   - 额外暴露 GET /status 用于面板自检
 */

var http = require('http');
var url = require('url');

var SERVER_INFO = {
    name: 'cc-3-8-x-mcp',
    version: '2.0.0',
};

var PROTOCOL_VERSION = '2024-11-05';

/**
 * @typedef {Object} ToolDef
 * @property {string} name
 * @property {string} description
 * @property {object} inputSchema  JSON Schema
 * @property {(args: object) => Promise<any>} handler
 */

function createServer(options) {
    options = options || {};
    var port = options.port || 7523;
    var host = options.host || '127.0.0.1';
    var logger = options.logger || console;

    /** @type {Map<string, ToolDef>} */
    var tools = new Map();
    /** @type {Map<string, {uri:string, name:string, description:string, mimeType:string, read:()=>Promise<any>}>} */
    var resources = new Map();

    var httpServer = null;
    var started = false;
    var stats = {
        startedAt: null,
        requestCount: 0,
        lastRequest: null,
        lastError: null,
    };

    function registerTool(def) {
        if (!def || !def.name || typeof def.handler !== 'function') {
            throw new Error('invalid tool def');
        }
        tools.set(def.name, def);
    }

    function registerResource(def) {
        if (!def || !def.uri || typeof def.read !== 'function') {
            throw new Error('invalid resource def');
        }
        resources.set(def.uri, def);
    }

    /** 把 tool handler 抛错统一转成 JSON-RPC error payload */
    async function callTool(name, args) {
        var tool = tools.get(name);
        if (!tool) {
            var err = new Error('unknown tool: ' + name);
            err.code = -32601;
            throw err;
        }
        try {
            var result = await tool.handler(args || {});
            // MCP tools/call result shape: { content: [{type:'text', text:...}], isError?: boolean }
            if (result && result.content) return result;
            return {
                content: [{
                    type: 'text',
                    text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                }],
            };
        } catch (e) {
            return {
                content: [{
                    type: 'text',
                    text: 'Error: ' + (e && (e.stack || e.message) || String(e)),
                }],
                isError: true,
            };
        }
    }

    async function handleJsonRpc(req) {
        // 批量请求
        if (Array.isArray(req)) {
            var out = [];
            for (var i = 0; i < req.length; i++) {
                var r = await handleJsonRpc(req[i]);
                if (r) out.push(r);
            }
            return out;
        }
        if (!req || req.jsonrpc !== '2.0') {
            return { jsonrpc: '2.0', id: (req && req.id) || null, error: { code: -32600, message: 'invalid request' } };
        }

        var id = req.id;
        var method = req.method;
        var params = req.params || {};

        try {
            var result;
            switch (method) {
                case 'initialize':
                    result = {
                        protocolVersion: PROTOCOL_VERSION,
                        serverInfo: SERVER_INFO,
                        capabilities: {
                            tools: { listChanged: false },
                            resources: { subscribe: false, listChanged: false },
                            logging: {},
                        },
                    };
                    break;
                case 'initialized':
                case 'notifications/initialized':
                    // notification, no response
                    if (id == null) return null;
                    result = {};
                    break;
                case 'ping':
                    result = {};
                    break;
                case 'tools/list':
                    result = {
                        tools: Array.from(tools.values()).map(function (t) {
                            return {
                                name: t.name,
                                description: t.description || '',
                                inputSchema: t.inputSchema || { type: 'object', properties: {} },
                            };
                        }),
                    };
                    break;
                case 'tools/call':
                    result = await callTool(params.name, params.arguments);
                    break;
                case 'resources/list':
                    result = {
                        resources: Array.from(resources.values()).map(function (r) {
                            return {
                                uri: r.uri,
                                name: r.name || r.uri,
                                description: r.description || '',
                                mimeType: r.mimeType || 'application/json',
                            };
                        }),
                    };
                    break;
                case 'resources/read':
                    var uri = params.uri;
                    var res = resources.get(uri);
                    if (!res) {
                        throw Object.assign(new Error('unknown resource: ' + uri), { code: -32602 });
                    }
                    var content = await res.read();
                    result = {
                        contents: [{
                            uri: res.uri,
                            mimeType: res.mimeType || 'application/json',
                            text: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
                        }],
                    };
                    break;
                default:
                    throw Object.assign(new Error('method not found: ' + method), { code: -32601 });
            }

            // notification: id 缺失，不返回
            if (id == null) return null;
            return { jsonrpc: '2.0', id: id, result: result };
        } catch (e) {
            stats.lastError = { at: new Date().toISOString(), method: method, message: e.message };
            if (id == null) return null;
            return {
                jsonrpc: '2.0',
                id: id,
                error: {
                    code: e.code || -32603,
                    message: e.message || 'internal error',
                },
            };
        }
    }

    function handleHttp(httpReq, httpRes) {
        var parsed = url.parse(httpReq.url, true);
        var pathname = parsed.pathname || '/';

        // CORS / 允许任意来源本机调试
        httpRes.setHeader('Access-Control-Allow-Origin', '*');
        httpRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        httpRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id');
        if (httpReq.method === 'OPTIONS') {
            httpRes.writeHead(204);
            httpRes.end();
            return;
        }

        if (pathname === '/status' && httpReq.method === 'GET') {
            httpRes.writeHead(200, { 'Content-Type': 'application/json' });
            httpRes.end(JSON.stringify({
                server: SERVER_INFO,
                protocolVersion: PROTOCOL_VERSION,
                toolCount: tools.size,
                resourceCount: resources.size,
                stats: stats,
            }));
            return;
        }

        if (pathname === '/mcp' && httpReq.method === 'POST') {
            var chunks = [];
            httpReq.on('data', function (c) { chunks.push(c); });
            httpReq.on('end', async function () {
                var raw = Buffer.concat(chunks).toString('utf-8');
                var body;
                try { body = JSON.parse(raw); }
                catch (e) {
                    httpRes.writeHead(400, { 'Content-Type': 'application/json' });
                    httpRes.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }));
                    return;
                }
                stats.requestCount++;
                stats.lastRequest = {
                    at: new Date().toISOString(),
                    method: body && body.method,
                };
                var response = await handleJsonRpc(body);
                httpRes.writeHead(response == null ? 204 : 200, { 'Content-Type': 'application/json' });
                httpRes.end(response == null ? '' : JSON.stringify(response));
            });
            return;
        }

        httpRes.writeHead(404, { 'Content-Type': 'text/plain' });
        httpRes.end('not found');
    }

    function start() {
        if (started) return Promise.resolve({ port: port, host: host });
        return new Promise(function (resolve, reject) {
            httpServer = http.createServer(handleHttp);
            httpServer.on('error', function (e) {
                if (!started) reject(e);
                else logger.warn('[cc-mcp] server error:', e.message);
            });
            httpServer.listen(port, host, function () {
                started = true;
                stats.startedAt = new Date().toISOString();
                logger.log('[cc-mcp] MCP server listening http://' + host + ':' + port + '/mcp');
                resolve({ port: port, host: host });
            });
        });
    }

    function stop() {
        if (!started || !httpServer) return Promise.resolve();
        return new Promise(function (resolve) {
            httpServer.close(function () {
                started = false;
                httpServer = null;
                logger.log('[cc-mcp] MCP server stopped');
                resolve();
            });
        });
    }

    return {
        registerTool: registerTool,
        registerResource: registerResource,
        start: start,
        stop: stop,
        get started() { return started; },
        get port() { return port; },
        get host() { return host; },
        get toolCount() { return tools.size; },
        get resourceCount() { return resources.size; },
        get stats() { return stats; },
    };
}

module.exports = { createServer: createServer, PROTOCOL_VERSION: PROTOCOL_VERSION };
