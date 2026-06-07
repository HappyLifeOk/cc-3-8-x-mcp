'use strict';

// Cocos MCP 功能面板
// MCP 状态 / 编辑器状态 / 快捷动作 / Debug 注入 / 命令日志 / 同机 worktree

exports.template = /* html */ `
<div class="wrap">
  <section class="mcp">
    <header>MCP Server <span id="mcpDot" class="dot gray"></span></header>
    <div class="row"><label>状态</label><span id="mcpRunning">-</span></div>
    <div class="row"><label>端点</label><span id="mcpUrl">-</span></div>
    <div class="row"><label>Tools</label><span id="mcpTools">-</span></div>
    <div class="row"><label>请求数</label><span id="mcpReqCount">0</span></div>
    <div class="mcp-actions">
      <ui-button id="btnCopyMcpUrl">复制端点</ui-button>
      <ui-button id="btnCopyCli">复制 CLI 命令</ui-button>
      <ui-button id="btnRestartMcp" class="secondary">重启</ui-button>
    </div>
  </section>

  <section class="status">
    <header>编辑器 <span id="probeDot" class="dot gray" title="预览连通性"></span></header>
    <div class="row"><label>分支</label><span id="gitBranch">-</span></div>
    <div class="row"><label>HEAD</label><span id="gitHead">-</span></div>
    <div class="row"><label>预览地址</label><span id="previewUrl">-</span></div>
    <div class="row"><label>预览端口</label><span id="previewPort">-</span></div>
    <div class="row"><label>编辑器 PID</label><span id="editorPid">-</span></div>
    <div class="row"><label>Watchers</label><span id="watchers">-</span></div>
    <div class="row"><label>info 更新</label><span id="updatedAt">-</span></div>
  </section>

  <section class="actions">
    <header>快捷动作</header>
    <div class="btn-grid">
      <ui-button id="btnRefresh">刷新（资源+场景）</ui-button>
      <ui-button id="btnSoftReload">仅软重载场景</ui-button>
      <ui-button id="btnQueryUrl">查询预览地址</ui-button>
      <ui-button id="btnOpenDev">打开 .dev 目录</ui-button>
      <ui-button id="btnClean">清理 .dev 临时文件</ui-button>
      <ui-button id="btnRefreshStatus" class="secondary">刷新状态</ui-button>
    </div>

    <div class="reimport-row">
      <ui-input id="reimportInput" placeholder="db://assets/xxx 重新导入" class="grow"></ui-input>
      <ui-button id="btnReimport">导入</ui-button>
    </div>
  </section>

  <section class="worktrees">
    <header>同机 Worktree</header>
    <div id="worktreeList" class="wt-list">-</div>
  </section>

  <section class="log">
    <header>最近命令日志</header>
    <div id="logList" class="log-list">-</div>
  </section>

  <div id="toast" class="toast"></div>
</div>
`;

exports.style = /* css */ `
  :host { display: flex; flex: 1; }
  .wrap { display: flex; flex-direction: column; padding: 12px; gap: 14px; font-size: 12px; flex: 1; overflow: auto; position: relative; }
  section header { font-weight: bold; margin-bottom: 6px; opacity: 0.75; text-transform: uppercase; letter-spacing: 0.5px; font-size: 11px; display: flex; align-items: center; gap: 6px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
  .dot.gray { background: #888; }
  .dot.green { background: #3ddc84; }
  .dot.red { background: #e45; }
  .status .row { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px dashed rgba(255,255,255,0.08); }
  .status .row label { opacity: 0.6; }
  .status .row span { font-family: monospace; max-width: 65%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
  .btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .btn-grid ui-button { width: 100%; }
  .btn-grid .secondary { opacity: 0.7; grid-column: span 2; }
  .mcp-actions { display: flex; gap: 6px; margin-top: 8px; }
  .mcp-actions ui-button { flex: 1; }
  .mcp-actions .secondary { opacity: 0.75; }
  .reimport-row, .eval-row { display: flex; gap: 6px; margin-top: 6px; }
  .grow { flex: 1; }
  .eval-result { max-height: 120px; overflow: auto; background: rgba(0,0,0,0.3); padding: 6px 8px; border-radius: 3px; font-family: monospace; font-size: 11px; white-space: pre-wrap; word-break: break-all; margin: 6px 0 0; min-height: 0; }
  .eval-result:empty { display: none; }
  .debug-buttons { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .debug-buttons ui-button { font-size: 11px; }
  .hint-small { opacity: 0.55; font-size: 10px; margin-top: 4px; }
  .hint-small code { background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px; font-family: monospace; }
  .wt-list, .log-list { font-family: monospace; font-size: 11px; max-height: 140px; overflow: auto; background: rgba(0,0,0,0.2); padding: 6px 8px; border-radius: 3px; line-height: 1.5; }
  .wt-row { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
  .wt-row.self { color: #3ddc84; }
  .wt-row .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wt-row .port { opacity: 0.8; flex-shrink: 0; }
  .log-row { display: flex; gap: 8px; padding: 1px 0; }
  .log-row .time { opacity: 0.5; flex-shrink: 0; }
  .log-row .cmd { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toast { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.85); color: #fff; padding: 6px 12px; border-radius: 4px; font-size: 11px; opacity: 0; transition: opacity 0.2s; pointer-events: none; max-width: 80%; text-align: center; }
  .toast.show { opacity: 1; }
`;

exports.$ = {
    mcpDot: '#mcpDot',
    mcpRunning: '#mcpRunning',
    mcpUrl: '#mcpUrl',
    mcpTools: '#mcpTools',
    mcpReqCount: '#mcpReqCount',
    btnCopyMcpUrl: '#btnCopyMcpUrl',
    btnCopyCli: '#btnCopyCli',
    btnRestartMcp: '#btnRestartMcp',
    previewUrl: '#previewUrl',
    previewPort: '#previewPort',
    editorPid: '#editorPid',
    watchers: '#watchers',
    updatedAt: '#updatedAt',
    gitBranch: '#gitBranch',
    gitHead: '#gitHead',
    probeDot: '#probeDot',
    btnRefresh: '#btnRefresh',
    btnSoftReload: '#btnSoftReload',
    btnQueryUrl: '#btnQueryUrl',
    btnOpenDev: '#btnOpenDev',
    btnClean: '#btnClean',
    btnRefreshStatus: '#btnRefreshStatus',
    btnReimport: '#btnReimport',
    reimportInput: '#reimportInput',
    worktreeList: '#worktreeList',
    logList: '#logList',
    toast: '#toast',
};

let toastTimer = null;

function fmtTime(iso) {
    if (!iso) return '-';
    try { return iso.replace('T', ' ').replace(/\..+$/, '').split(' ')[1] || iso; } catch (e) { return iso; }
}

exports.methods = {
    showToast(msg) {
        this.$.toast.textContent = msg;
        this.$.toast.classList.add('show');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { this.$.toast.classList.remove('show'); }, 2200);
    },

    async refreshStatus() {
        try {
            const s = await Editor.Message.request('cc-3-8-x-mcp', 'get-status');
            if (!s) return;
            this.$.gitBranch.textContent = s.gitBranch || '-';
            this.$.gitHead.textContent = s.gitHead || '-';
            this.$.previewUrl.textContent = s.previewUrl || '-';
            this.$.previewPort.textContent = s.previewPort != null ? String(s.previewPort) : '-';
            this.$.editorPid.textContent = String(s.editorPid || '-');
            const w = s.watchers || {};
            this.$.watchers.textContent =
                (w.refresh ? '●refresh ' : '○refresh ') +
                (w.infoInterval ? '●info' : '○info');
            this.$.updatedAt.textContent = s.updatedAt ? s.updatedAt.replace('T', ' ').replace(/\..+$/, '') : '-';

            // MCP 区
            const mcp = s.mcpServer || {};
            if (mcp.running) {
                this.$.mcpDot.className = 'dot green';
                this.$.mcpRunning.textContent = 'running';
                this.$.mcpUrl.textContent = mcp.url || '-';
                this.$.mcpTools.textContent = (mcp.toolCount || 0) + ' tools / ' + (mcp.resourceCount || 0) + ' res';
                this.$.mcpReqCount.textContent = String((mcp.stats && mcp.stats.requestCount) || 0);
            } else {
                this.$.mcpDot.className = 'dot red';
                this.$.mcpRunning.textContent = 'stopped';
                this.$.mcpUrl.textContent = '-';
            }

            // 命令日志
            if (Array.isArray(s.commandLog)) {
                this.$.logList.innerHTML = s.commandLog.length
                    ? s.commandLog.map(e => `<div class="log-row"><span class="time">${fmtTime(e.t)}</span><span class="cmd">[${e.source}] ${escapeHtml(e.cmd)}</span></div>`).join('')
                    : '<div style="opacity:0.5">（暂无）</div>';
            }

            // 预览连通性探测
            this.probePreview(s.previewUrl);
        } catch (e) {
            this.showToast('状态获取失败: ' + (e.message || e));
        }
        this.refreshWorktrees();
    },

    async probePreview(url) {
        if (!url) { this.$.probeDot.className = 'dot gray'; return; }
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 1500);
            const resp = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
            clearTimeout(timer);
            this.$.probeDot.className = resp.ok ? 'dot green' : 'dot red';
            this.$.probeDot.title = '预览: HTTP ' + resp.status;
        } catch (e) {
            this.$.probeDot.className = 'dot red';
            this.$.probeDot.title = '预览: ' + (e.message || 'unreachable');
        }
    },

    async refreshWorktrees() {
        try {
            const list = await Editor.Message.request('cc-3-8-x-mcp', 'list-worktrees');
            if (!Array.isArray(list) || !list.length) {
                this.$.worktreeList.innerHTML = '<div style="opacity:0.5">（未发现其他 worktree）</div>';
                return;
            }
            this.$.worktreeList.innerHTML = list.map(w => {
                const name = (w.projectName || w.projectPath || '').split('/').slice(-2).join('/');
                const stale = w.staleSec > 90 ? ` ⚠${w.staleSec}s` : '';
                const selfCls = w.self ? 'wt-row self' : 'wt-row';
                return `<div class="${selfCls}"><span class="name">${escapeHtml(name)}${w.self ? ' (本)' : ''}</span><span class="port">:${w.previewPort || '?'} pid${w.editorPid}${stale}</span></div>`;
            }).join('');
        } catch (e) { /* ignore */ }
    },

    async onRefreshClick() {
        this.showToast('刷新中…');
        try {
            await Editor.Message.request('cc-3-8-x-mcp', 'trigger-refresh');
            this.showToast('已刷新资源+场景');
            this.refreshStatus();
        } catch (e) { this.showToast('失败: ' + (e.message || e)); }
    },
    async onSoftReloadClick() {
        try { await Editor.Message.request('cc-3-8-x-mcp', 'soft-reload-scene'); this.showToast('场景已软重载'); }
        catch (e) { this.showToast('失败: ' + (e.message || e)); }
    },
    async onQueryUrlClick() {
        try {
            const url = await Editor.Message.request('cc-3-8-x-mcp', 'query-preview-url');
            this.showToast('预览: ' + url);
            this.refreshStatus();
        } catch (e) { this.showToast('失败: ' + (e.message || e)); }
    },
    async onOpenDevClick() {
        try { await Editor.Message.request('cc-3-8-x-mcp', 'open-dev-dir'); this.showToast('已打开 .dev'); }
        catch (e) { this.showToast('失败: ' + (e.message || e)); }
    },
    async onCleanClick() {
        try {
            const removed = await Editor.Message.request('cc-3-8-x-mcp', 'clean-dev-dir');
            this.showToast('已清理 ' + (removed ? removed.length : 0) + ' 个文件');
        } catch (e) { this.showToast('失败: ' + (e.message || e)); }
    },
    async onReimportClick() {
        const url = (this.$.reimportInput.value || '').trim();
        if (!url) { this.showToast('请输入 assetUrl'); return; }
        try {
            await Editor.Message.request('cc-3-8-x-mcp', 'trigger-reimport', url);
            this.showToast('已重新导入: ' + url);
        } catch (e) { this.showToast('失败: ' + (e.message || e)); }
    },
    async onCopyMcpUrl() {
        try {
            const cfg = await Editor.Message.request('cc-3-8-x-mcp', 'get-mcp-config');
            if (!cfg || !cfg.url) { this.showToast('MCP 未运行'); return; }
            await navigator.clipboard.writeText(cfg.url);
            this.showToast('已复制: ' + cfg.url);
        } catch (e) { this.showToast('失败: ' + (e.message || e)); }
    },
    async onCopyCli() {
        try {
            const cfg = await Editor.Message.request('cc-3-8-x-mcp', 'get-mcp-config');
            if (!cfg || !cfg.cliAddCommand) { this.showToast('MCP 未运行'); return; }
            await navigator.clipboard.writeText(cfg.cliAddCommand);
            this.showToast('已复制 CLI 命令');
        } catch (e) { this.showToast('失败: ' + (e.message || e)); }
    },
    async onRestartMcp() {
        this.showToast('重启 MCP…');
        try {
            await Editor.Message.request('cc-3-8-x-mcp', 'restart-server');
            this.showToast('MCP 已重启');
            this.refreshStatus();
        } catch (e) { this.showToast('失败: ' + (e.message || e)); }
    },
};

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

exports.ready = function () {
    this.$.btnRefresh.addEventListener('confirm', () => this.onRefreshClick());
    this.$.btnSoftReload.addEventListener('confirm', () => this.onSoftReloadClick());
    this.$.btnQueryUrl.addEventListener('confirm', () => this.onQueryUrlClick());
    this.$.btnOpenDev.addEventListener('confirm', () => this.onOpenDevClick());
    this.$.btnClean.addEventListener('confirm', () => this.onCleanClick());
    this.$.btnRefreshStatus.addEventListener('confirm', () => this.refreshStatus());
    this.$.btnReimport.addEventListener('confirm', () => this.onReimportClick());
    this.$.btnCopyMcpUrl.addEventListener('confirm', () => this.onCopyMcpUrl());
    this.$.btnCopyCli.addEventListener('confirm', () => this.onCopyCli());
    this.$.btnRestartMcp.addEventListener('confirm', () => this.onRestartMcp());
    this.refreshStatus();
    // 每 10s 自动刷状态
    this._statusTimer = setInterval(() => this.refreshStatus(), 10000);
};

exports.close = function () {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (this._statusTimer) { clearInterval(this._statusTimer); this._statusTimer = null; }
};
