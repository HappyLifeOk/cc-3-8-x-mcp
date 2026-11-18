'use strict';

var fs = require('fs');
var path = require('path');
var { exec } = require('child_process');
var localStatus = require('./server/local-status');

var DEV_DIR = '.dev';
var TEMP_DIR = 'temp';

// 缓存预览地址
var _previewUrl = '';
// Gateway 注册心跳 interval handle；不再周期性重写 dev-reload-info.json
var _registryHeartbeatInterval = null;
// `temp/refresh` 命令文件 watcher（唯一保留的 watcher）
var _refreshWatcher = null;

// dev-reload-info.json 输出路径（被 listWorktrees / getStatus / panel 读取，必须保留）
var INFO_FILE = 'temp/dev-reload-info.json';
// 信号文件：外部脚本写命令到此文件，插件读后执行（每行一条命令，读完清空）
var REFRESH_FILE = 'temp/refresh';
// 自定义按钮配置（用户可在 .dev/cc-mcp-panel.json 或旧名 .dev/dev-reload-panel.json 里维护）
var PANEL_CONFIG_FILE = '.dev/dev-reload-panel.json';

// 最近命令日志环形缓冲（供面板展示）
var _commandLog = [];
var COMMAND_LOG_MAX = 30;
function pushCommandLog(source, cmd) {
    _commandLog.push({ t: new Date().toISOString(), source: source, cmd: cmd });
    if (_commandLog.length > COMMAND_LOG_MAX) _commandLog.shift();
}

/**
 * 把当前预览状态写入 temp/dev-reload-info.json。
 * 外部脚本（playwright/designer）通过此文件反查"本 worktree 对应哪个预览端口"。
 * 只在 previewUrl 已知时写入；previewUrl 为空则跳过，等待首次 getPreviewUrl 成功。
 * @param {string} previewUrl  已知的预览 URL（非空）
 */
function writeDevReloadInfo(previewUrl) {
    if (!previewUrl) return false;
    var portMatch = previewUrl.match(/:(\d+)/);
    var previewPort = portMatch ? parseInt(portMatch[1], 10) : null;
    // 读取项目名（package.json name 字段）
    var projectName = '';
    try {
        var pkgPath = path.join(Editor.Project.path, 'package.json');
        if (fs.existsSync(pkgPath)) {
            var pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            projectName = pkg.name || '';
        }
    } catch (e) { /* ignore */ }
    var info = {
        projectPath: Editor.Project.path,
        projectName: projectName,
        editorPid: process.pid,
        editorVersion: (Editor.App && Editor.App.version) ? Editor.App.version : '',
        previewUrl: previewUrl,
        previewPort: previewPort,
    };
    try {
        var tempDir = path.join(Editor.Project.path, TEMP_DIR);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        var infoPath = path.join(Editor.Project.path, INFO_FILE);
        if (fs.existsSync(infoPath)) {
            try {
                var previous = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
                if (localStatus.isSameDevReloadInfo(previous, info)) return false;
            } catch (e) { /* 文件损坏时覆盖重写 */ }
        }
        info.updatedAt = new Date().toISOString();
        fs.writeFileSync(
            infoPath,
            JSON.stringify(info, null, 2),
            'utf-8'
        );
        log('dev-reload-info.json updated — port:' + (previewPort || 'null'));
        return true;
    } catch (e) {
        console.warn('[dev-reload] writeDevReloadInfo failed:', e.message || e);
        return false;
    }
}

/** 启动 30s Gateway 注册心跳；预览信息由启动/主动查询触发检查，仅实际变化时写入 */
function startRegistryHeartbeat() {
    if (_registryHeartbeatInterval) clearInterval(_registryHeartbeatInterval);
    _registryHeartbeatInterval = setInterval(function () {
        if (typeof writeRegistry === 'function') writeRegistry();
    }, 30000);
}

/** 停止 Gateway 注册心跳 */
function stopRegistryHeartbeat() {
    if (_registryHeartbeatInterval) {
        clearInterval(_registryHeartbeatInterval);
        _registryHeartbeatInterval = null;
    }
}

function log(msg) {
    console.log('[dev-reload] ' + msg);
}

function getFilePath(filename) {
    return path.join(Editor.Project.path, filename);
}

/**
 * 获取当前编辑器预览地址。
 * 每次都重新向 preview 扩展查询，避免首次预览未启动时缓存旧值。
 * 成功拿到 URL 后才更新 _previewUrl 缓存（供 writeDevReloadInfo 等用）。
 */
async function getPreviewUrl() {
    try {
        // CC3.8.x preview 扩展正式消息名：query-preview-url（见 builtin/preview/package.json contributions.messages）
        var url = await Editor.Message.request('preview', 'query-preview-url');
        if (url && typeof url === 'string' && url.startsWith('http')) {
            // host 规范化为 loopback：编辑器用 os.networkInterfaces() 挑的网卡 IP，在多网卡 /
            // 切换网络（家↔公司）时会指向当前不通的网卡。本机访问统一走 127.0.0.1，预览 server
            // 监听 0.0.0.0，loopback 永远通且与网卡/环境无关。写信号文件、open、返回值都用它。
            url = url.replace(/^(https?:\/\/)[^:\/]+/, '$1127.0.0.1');
            if (url !== _previewUrl) {
                log('preview url updated: ' + url);
            }
            _previewUrl = url;
            return _previewUrl;
        }
    } catch (e) {
        // Editor.Message.request 失败（消息不存在、preview 扩展未启动等）必须打印，不能静默
        console.error('[dev-reload] getPreviewUrl: Editor.Message.request failed —', e && (e.stack || e.message) || e);
    }

    // 降级：如果已有缓存（上次成功查到的），直接复用
    if (_previewUrl) return _previewUrl;

    // 无缓存、无法从编辑器获取，返回未知标记而非错误的硬编码端口
    log('preview url: unable to query from editor — preview may not be running');
    return 'http://localhost:unknown-port';
}

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function doReimport(url) {
    log('reimporting: ' + url);
    await Editor.Message.request('asset-db', 'reimport-asset', url);
    log('reimported: ' + url);
}

async function doRefreshAssets() {
    log('refreshing assets...');
    await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/');
    log('assets refreshed.');
}

async function doReloadScene() {
    log('reloading scene...');
    await Editor.Message.request('scene', 'soft-reload');
    log('scene reloaded.');
}

// ── 消息处理（支持从其他扩展或命令行调用） ──

exports.methods = {
    async refreshAssets() {
        await doRefreshAssets();
        await doReloadScene();
    },
    async queryPreviewUrl() {
        var url = await getPreviewUrl();
        // 顺便刷新 dev-reload-info.json，让外部脚本拿到最新端口
        writeDevReloadInfo(url);
        return url;
    },
    async openPanel() {
        await Editor.Panel.open('cc-3-8-x-mcp');
    },
    async restartBridge() {
        await stopEditorBridge();
        await startEditorBridge();
        return { port: _editorBridge ? _editorBridge.port : null };
    },
    async getBridgeConfig() {
        return buildBridgeConfig();
    },
    /** Panel 使用：刷新资源 + 重载场景 */
    async triggerRefresh() {
        await doRefreshAssets();
        await doReloadScene();
        return true;
    },
    /** Panel 使用：重新导入指定 assetUrl */
    async triggerReimport(url) {
        if (!url) return false;
        await doReimport(url);
        return true;
    },
    /** Panel 使用：打开 .dev 目录 */
    openDevDir() {
        var devDir = path.join(Editor.Project.path, DEV_DIR);
        if (!fs.existsSync(devDir)) fs.mkdirSync(devDir, { recursive: true });
        // 跨平台在系统文件管理器打开：mac=open / win=explorer / linux=xdg-open
        var opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
        exec(opener + ' "' + devDir + '"');
        return devDir;
    },
    /** Panel 使用：只做场景软重载 */
    async softReloadScene() {
        pushCommandLog('panel', 'reload-scene');
        await doReloadScene();
        return true;
    },
    /** Panel 使用：清理 .dev 临时产物（保留 dev-reload-panel.json / cc-mcp-panel.json） */
    cleanDevDir() {
        pushCommandLog('panel', 'clean-dev');
        var devDir = path.join(Editor.Project.path, DEV_DIR);
        var keep = { 'dev-reload-panel.json': 1, 'cc-mcp-panel.json': 1 };
        var removed = [];
        try {
            var entries = fs.readdirSync(devDir);
            entries.forEach(function (name) {
                if (keep[name]) return;
                var full = path.join(devDir, name);
                try {
                    var st = fs.statSync(full);
                    if (st.isFile()) { fs.unlinkSync(full); removed.push(name); }
                } catch (e) { /* ignore */ }
            });
        } catch (e) { /* ignore */ }
        return removed;
    },
    /** Panel 使用：扫同机其他 worktree 的 dev-reload-info.json */
    listWorktrees() {
        var results = [];
        // 扫当前项目同级目录里其它含 temp/dev-reload-info.json 的项目实例（不假设目录命名）
        var cur = Editor.Project.path;
        var roots = [];
        try {
            var siblingDir = path.dirname(cur);
            fs.readdirSync(siblingDir).forEach(function (name) {
                var p = path.join(siblingDir, name);
                if (p !== cur && fs.existsSync(path.join(p, INFO_FILE))) {
                    roots.push(p);
                }
            });
        } catch (e) { /* ignore */ }
        // 再扫 worktree：`git worktree list` 输出的路径
        try {
            var wtOut = require('child_process').execSync('git -C "' + cur + '" worktree list --porcelain', { encoding: 'utf-8' });
            wtOut.split('\n').forEach(function (line) {
                if (line.indexOf('worktree ') === 0) {
                    var p = line.substring('worktree '.length).trim();
                    if (p && roots.indexOf(p) < 0) roots.push(p);
                }
            });
        } catch (e) { /* ignore */ }

        roots.forEach(function (root) {
            var candidates = [
                path.join(root, INFO_FILE),
            ];
            candidates.forEach(function (infoPath) {
                if (!fs.existsSync(infoPath)) return;
                try {
                    var info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
                    results.push({
                        projectPath: info.projectPath,
                        projectName: info.projectName,
                        previewPort: info.previewPort,
                        previewUrl: info.previewUrl,
                        editorPid: info.editorPid,
                        updatedAt: info.updatedAt,
                        alive: localStatus.isProcessAlive(info.editorPid),
                        self: info.projectPath === Editor.Project.path,
                    });
                } catch (e) { /* ignore */ }
            });
        });
        return results;
    },
    /** Panel 使用：返回当前插件状态快照 */
    async getStatus() {
        var url = await getPreviewUrl();
        writeDevReloadInfo(url);
        var portMatch = url ? url.match(/:(\d+)/) : null;
        var infoPath = path.join(Editor.Project.path, INFO_FILE);
        var updatedAt = '';
        try {
            if (fs.existsSync(infoPath)) {
                var info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
                updatedAt = info.updatedAt || '';
            }
        } catch (e) { /* ignore */ }
        // git 分支/commit
        var gitBranch = '', gitHead = '';
        try {
            var execSync = require('child_process').execSync;
            gitBranch = execSync('git -C "' + Editor.Project.path + '" rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
            gitHead = execSync('git -C "' + Editor.Project.path + '" rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
        } catch (e) { /* ignore */ }
        return {
            previewUrl: url,
            previewPort: portMatch ? parseInt(portMatch[1], 10) : null,
            editorPid: process.pid,
            editorVersion: (Editor.App && Editor.App.version) ? Editor.App.version : '',
            editorVersionRange: '>=3.8.0 <3.9.0',
            projectPath: Editor.Project.path,
            updatedAt: updatedAt,
            infoFile: INFO_FILE,
            watchers: {
                refresh: !!_refreshWatcher,
                registryHeartbeat: !!_registryHeartbeatInterval,
            },
            gitBranch: gitBranch,
            gitHead: gitHead,
            commandLog: _commandLog.slice().reverse(),
            editorBridge: _editorBridge ? {
                running: _editorBridge.started,
                url: 'http://' + _editorBridge.host + ':' + _editorBridge.port + '/bridge',
                port: _editorBridge.port,
                bridgeApiVersion: _editorBridge.bridgeApiVersion,
                toolCount: _editorBridge.toolCount,
                resourceCount: _editorBridge.resourceCount,
                stats: _editorBridge.stats,
            } : { running: false },
        };
    }
};

// ── Editor Bridge（仅供全局 cocos-mcp-gateway 调用，不是 MCP Server）──

var _editorBridge = null;
var BRIDGE_DEFAULT_PORT = 7523;
var GATEWAY_API_VERSION = 2;
var REGISTRY_DIR = path.join(require('os').homedir(), '.cocos-mcp', 'editors');

function buildBridgeConfig() {
    if (!_editorBridge) return { running: false, gatewayManaged: true };
    return {
        running: _editorBridge.started,
        gatewayManaged: true,
        transport: 'editor-bridge',
        bridgeApiVersion: _editorBridge.bridgeApiVersion,
        url: 'http://' + _editorBridge.host + ':' + _editorBridge.port + '/bridge',
        port: _editorBridge.port,
        host: _editorBridge.host,
        toolCount: _editorBridge.toolCount,
        resourceCount: _editorBridge.resourceCount,
        stats: _editorBridge.stats,
        clientEntry: 'cocos-mcp-gateway',
        note: '这是 Gateway 私有端点，不要直接注册为 MCP Server。',
    };
}

/**
 * 计算项目短名（MCP 工具名前缀，需能区分不同项目）。
 * 禁 worktree（cocos 不支持同一项目多 worktree 同开），故不再为 worktree 做 parent 启发式；
 * base 是常见通用名（client/game/app/src）时取 parent 段区分不同项目，否则直接用 base。
 */
function getProjectShortName() {
    var p = Editor.Project.path || '';
    var parent = path.basename(path.dirname(p));
    var base = path.basename(p);
    if (base === 'client' || base === 'game' || base === 'app' || base === 'src') {
        return parent || base;
    }
    return base;
}

/**
 * 解析 Cocos 编辑器主进程可执行路径，写进注册文件供 Gateway 的 editor_restart 拉起用。
 * 取 process.argv[0] / process.execPath（编辑器主进程可执行，跨平台）。
 * 排除 Helper（渲染/GPU 子进程），解析不到返回空串。
 */
function getEditorExecPath() {
    var candidates = [];
    try { if (process.argv && process.argv[0]) candidates.push(process.argv[0]); } catch (e) { /* ignore */ }
    try { if (process.execPath) candidates.push(process.execPath); } catch (e) { /* ignore */ }
    for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (c && /CocosCreator/.test(c) && c.indexOf('Helper') < 0) {
            try { if (fs.existsSync(c)) return c; } catch (e) { /* ignore */ }
        }
    }
    return '';
}

function writeRegistry() {
    if (!_editorBridge || !_editorBridge.started) return;
    try {
        if (!fs.existsSync(REGISTRY_DIR)) fs.mkdirSync(REGISTRY_DIR, { recursive: true, mode: 0o700 });
        try { fs.chmodSync(REGISTRY_DIR, 0o700); } catch (e) { /* Windows / restricted FS */ }
        var entry = {
            pid: process.pid,
            projectPath: Editor.Project.path,
            projectShortName: getProjectShortName(),
            host: _editorBridge.host,
            port: _editorBridge.port,
            url: 'http://' + _editorBridge.host + ':' + _editorBridge.port + '/bridge',
            transport: 'editor-bridge',
            editorVersion: (Editor.App && Editor.App.version) ? Editor.App.version : '',
            execPath: getEditorExecPath(),
            extensionVersion: require('./package.json').version,
            gatewayApiVersion: GATEWAY_API_VERSION,
            bridgeApiVersion: _editorBridge.bridgeApiVersion,
            authToken: _editorBridge.authToken,
            startedAt: _editorBridge.stats.startedAt,
            updatedAt: new Date().toISOString(),
        };
        var registryFile = path.join(REGISTRY_DIR, process.pid + '.json');
        var tempFile = registryFile + '.' + Date.now() + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(entry, null, 2), { encoding: 'utf-8', mode: 0o600 });
        fs.renameSync(tempFile, registryFile);
        try { fs.chmodSync(registryFile, 0o600); } catch (e) { /* Windows / restricted FS */ }
    } catch (e) {
        console.warn('[cc-mcp] writeRegistry failed:', e.message || e);
    }
}

function removeRegistry() {
    try {
        var f = path.join(REGISTRY_DIR, process.pid + '.json');
        if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (e) { /* ignore */ }
}

/** 分配可用端口：先试 DEFAULT，如果被占用递增 */
function findFreePort(startPort) {
    var net = require('net');
    return new Promise(function (resolve) {
        function tryPort(p) {
            var tester = net.createServer()
                .once('error', function () { tryPort(p + 1); })
                .once('listening', function () {
                    tester.close(function () { resolve(p); });
                })
                .listen(p, '127.0.0.1');
        }
        tryPort(startPort);
    });
}

async function startEditorBridge() {
    if (_editorBridge && _editorBridge.started) return;
    var port = await findFreePort(BRIDGE_DEFAULT_PORT);
    var authToken = require('crypto').randomBytes(32).toString('hex');

    var tdef = require('./server/tools');
    var ctx = buildToolCtx();
    var toolDefs = tdef.defineTools(ctx);
    var resourceDefs = tdef.defineResources(ctx);

    // 只计真实的工具调用 / 资源读取，不计 Gateway 每 15s 的 bridge/describe 探活——
    // 否则计数永远在涨，无法用于判断「业务指令到没到编辑器」。
    // lastRequestAt/lastTool 是判活主信号（曾因 requestCount 初始化后无人自增、恒 0，被当成转发断裂误诊）。
    var stats = { startedAt: new Date().toISOString(), requestCount: 0, lastRequestAt: null, lastTool: null };
    function countCall(name, fn) {
        return function () {
            stats.requestCount++;
            stats.lastRequestAt = new Date().toISOString();
            stats.lastTool = name;
            return fn.apply(this, arguments);
        };
    }

    var bridgeModule = require('./server/editor-bridge');
    var bridge = bridgeModule.createEditorBridge({
        name: 'cocos-creator-3-8-x-editor-bridge',
        version: require('./package.json').version,
        host: '127.0.0.1',
        port: port,
        authToken: authToken,
        tools: toolDefs.map(function (t) {
            return {
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
                handler: countCall(t.name, t.handler),
            };
        }),
        resources: resourceDefs.map(function (r) {
            return {
                uri: r.uri,
                name: r.name,
                description: r.description,
                mimeType: r.mimeType,
                read: countCall('resource:' + r.uri, r.read),
            };
        }),
    });

    await bridge.start();
    _editorBridge = {
        started: true,
        host: bridge.host,
        port: bridge.port,
        bridgeApiVersion: bridge.bridgeApiVersion,
        authToken: authToken,
        toolCount: toolDefs.length,
        resourceCount: resourceDefs.length,
        stats: stats,
        stop: function () { return bridge.stop(); },
    };
    writeRegistry();
    log('Editor Bridge up — http://127.0.0.1:' + bridge.port + '/bridge  (tools:' + toolDefs.length + ') shortName=' + getProjectShortName());
}

/**
 * 构建 tool/resource 的 ctx。
 */
function buildToolCtx() {
    return {
        msg: function (target, name /*, ...args */) {
            var args = Array.prototype.slice.call(arguments, 2);
            return Editor.Message.request.apply(Editor.Message, [target, name].concat(args));
        },
        local: {
            getPreviewUrl: getPreviewUrl,
            doReimport: doReimport,
            doRefreshAssets: doRefreshAssets,
            doReloadScene: doReloadScene,
            listWorktrees: function () { return exports.methods.listWorktrees(); },
            openDevDir: function () { return exports.methods.openDevDir(); },
            cleanDevDir: function () { return exports.methods.cleanDevDir(); },
            getStatus: function () { return exports.methods.getStatus(); },
            reloadPackage: doRestartSelf,
        },
    };
}

async function stopEditorBridge() {
    if (!_editorBridge) return;
    removeRegistry();
    try {
        if (_editorBridge.stop) await _editorBridge.stop();
    } catch (e) { /* ignore */ }
    _editorBridge = null;
}

// ── temp/refresh 文件命令协议 ──

/**
 * 打开 prefab 到编辑器场景视图（等价于双击 prefab）。
 * @param {string} urlOrPath  db:// 路径 或 绝对路径
 */
async function doOpenPrefab(urlOrPath) {
    var dbUrl = urlOrPath;
    // 绝对路径 → 先通过 asset-db 反查 db:// url，再走统一路径
    if (!urlOrPath.startsWith('db://')) {
        var info = await Editor.Message.request('asset-db', 'query-asset-info', urlOrPath);
        if (!info || !info.url) throw new Error('open-prefab: cannot find db:// url for ' + urlOrPath);
        dbUrl = info.url;
    }
    var uuid = await Editor.Message.request('asset-db', 'query-uuid', dbUrl);
    if (!uuid) throw new Error('open-prefab: cannot resolve uuid for ' + dbUrl);
    await Editor.Message.request('asset-db', 'open-asset', uuid);
    log('open-prefab: opened ' + dbUrl + ' (uuid=' + uuid + ')');
}

/** 重启指定插件（disable → enable）让其 JS 代码改动生效；name 缺省为本插件 cc-3-8-x-mcp。
 *  注意：reload 本插件自身时，本函数处于即将被卸载的 main.js 上下文，必须 fire-and-forget。
 *  Editor.Package.disable 是 host 进程 API，扩展沙箱卸载后仍然有效；
 *  enable 在 disable 完成后用 setTimeout 触发，给 unload 收尾留窗口。
 *  ⚠️ disable/enable 的参数是扩展**绝对路径**不是 name（typings: enable(path) /
 *  disable(path, options)）——传 name 会 disable 静默不生效 + enable 报
 *  "[Package] Unknown and unable to start"，必须先用 getPackages 反查注册路径。
 */
function doRestartSelf(name) {
    name = name || 'cc-3-8-x-mcp';
    log('restart-package: scheduling disable → enable for ' + name);
    setImmediate(function () {
        Promise.resolve()
            .then(function () {
                if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) return name;   // 已是路径直接用
                var list = (Editor.Package.getPackages() || []).filter(function (p) {
                    return p && (p.name === name || (p.info && p.info.name === name));
                });
                if (!list.length || !list[0].path) {
                    throw new Error('找不到扩展 "' + name + '" 的注册路径（getPackages 匹配 ' + list.length + ' 条）');
                }
                return list[0].path;
            })
            .then(function (pkgPath) {
                return Promise.resolve(Editor.Package.disable(pkgPath))
                    // 200ms 给 unload 钩子（stopRefreshWatcher / stopEditorBridge）跑完
                    .then(function () { return new Promise(function (r) { setTimeout(r, 200); }); })
                    .then(function () { return Editor.Package.enable(pkgPath); });
            })
            .catch(function (err) {
                console.error('[restart-package] failed:', err && (err.stack || err.message) || err);
            });
    });
}

/**
 * 分发单条 refresh 命令。
 *
 * 协议：`restart-package [name]`（disable→enable 指定扩展让 JS 改动生效；缺省 name 重启本插件自身）。
 * 资源刷新 / 场景重载 / 预览刷新 / 截图等走 MCP tool（preview_refresh_and_reload /
 * asset_reimport 等）或面板按钮，不再通过文件协议触发。
 */
async function handleRefreshCommand(cmd) {
    if (!cmd) return;
    pushCommandLog('refresh', cmd);
    var parts = cmd.split(/\s+/);
    if (parts[0] === 'restart-package') {
        doRestartSelf(parts[1]);   // parts[1] 可选：缺省重启自身，指定则 reload 该扩展
        return;
    }
    log('refresh: unknown command — ' + cmd + '（仅支持 restart-package [name]）');
}

/** 启动 temp/refresh 文件 watcher（写入命令 → 读取 → 执行 → 清空） */
function startRefreshWatcher() {
    if (_refreshWatcher) return;
    var filePath = path.join(Editor.Project.path, REFRESH_FILE);
    // 确保文件存在，供 fs.watch 注册
    if (!fs.existsSync(filePath)) {
        try { fs.writeFileSync(filePath, '', 'utf-8'); } catch (e) { /* ignore */ }
    }
    var _debounceTimer = null;
    try {
        _refreshWatcher = fs.watch(filePath, function (event) {
            if (event !== 'change' && event !== 'rename') return;
            // debounce：macOS 下单次 write 可能触发多次事件
            clearTimeout(_debounceTimer);
            _debounceTimer = setTimeout(function () {
                var content = '';
                try { content = fs.readFileSync(filePath, 'utf-8').trim(); } catch (e) { return; }
                if (!content) return;
                // 清空信号文件，防止重复执行
                try { fs.writeFileSync(filePath, '', 'utf-8'); } catch (e) { /* ignore */ }
                var lines = content.split('\n');
                // 逐条串行执行（前一条完成再执行下一条）
                lines.reduce(function (chain, line) {
                    return chain.then(function () { return handleRefreshCommand(line.trim()); });
                }, Promise.resolve());
            }, 80);
        });
        log('refresh watcher started → ' + REFRESH_FILE);
    } catch (e) {
        console.error('[dev-reload] startRefreshWatcher failed:', e && (e.stack || e.message) || e);
    }
}

/** 停止 temp/refresh 文件 watcher */
function stopRefreshWatcher() {
    if (_refreshWatcher) { try { _refreshWatcher.close(); } catch (e) { /* ignore */ } _refreshWatcher = null; }
}

// ── 插件生命周期 ──

exports.load = async function () {
    // 确保运行时文件所在的 temp 目录存在；.dev 仅在使用用户配置时创建
    var tempDir = path.join(Editor.Project.path, TEMP_DIR);
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    log('loaded');
    // 启动 temp/refresh 文件 watcher
    startRefreshWatcher();
    // 异步拿预览地址；仅实际变化时写 dev-reload-info.json，并启动 Gateway 注册心跳
    getPreviewUrl().then(function(url) {
        if (url) writeDevReloadInfo(url);
        startRegistryHeartbeat();
    }).catch(function(e) {
        console.error('[dev-reload] load: getPreviewUrl failed —', e && (e.stack || e.message) || e);
        startRegistryHeartbeat();
    });
    // 启动 Editor Bridge（失败打完整栈，不阻断扩展 load）
    startEditorBridge().catch(function(e) {
        console.error('[cc-mcp] Editor Bridge failed to start:', e && (e.stack || e.message) || e);
    });
};

exports.unload = async function () {
    stopRefreshWatcher();
    stopRegistryHeartbeat();
    await stopEditorBridge();
    log('unloaded');
};
