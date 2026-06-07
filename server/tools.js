'use strict';

/**
 * MCP Tools 注册表
 * 每个 tool 透传到对应的 Editor.Message.request 或本地 helper。
 * ctx 提供：editor message 封装、本地辅助函数。
 */

function defineTools(ctx) {
    var msg = ctx.msg;   // async (target, name, ...args) => result
    var local = ctx.local; // { getPreviewUrl, doReimport, doRefreshAssets, doReloadScene, listWorktrees, openDevDir, cleanDevDir, getStatus }

    return [
        // ── scene 域 ──
        {
            name: 'scene_query_node_tree',
            description: '查询当前场景节点树。传 uuid 查子树，不传查根。',
            inputSchema: {
                type: 'object',
                properties: { uuid: { type: 'string', description: '可选：节点 uuid' } },
            },
            handler: async function (args) {
                return await msg('scene', 'query-node-tree', args.uuid);
            },
        },
        {
            name: 'scene_query_node',
            description: '查询单个节点完整 dump（含所有组件属性）',
            inputSchema: {
                type: 'object',
                properties: { uuid: { type: 'string' } },
                required: ['uuid'],
            },
            handler: async function (args) {
                return await msg('scene', 'query-node', args.uuid);
            },
        },
        {
            name: 'scene_set_property',
            description: '设置节点/组件属性。path 是 dump path（如 "position" 或 "__comps__.0.string"），dump 是 {type,value}。\n⚠️ 注意：若目的是修改 prefab 资源文件的属性，建议改用 prefab_edit（offline，不需要编辑器运行，直接读写 .prefab 文件，支持嵌套 prefab override）；scene_set_property 仅适用于修改运行时场景节点或需要编辑器上下文的场景。',
            inputSchema: {
                type: 'object',
                properties: {
                    uuid: { type: 'string' },
                    path: { type: 'string' },
                    dump: { type: 'object' },
                },
                required: ['uuid', 'path', 'dump'],
            },
            handler: async function (args) {
                return await msg('scene', 'set-property', {
                    uuid: args.uuid,
                    path: args.path,
                    dump: args.dump,
                });
            },
        },
        {
            name: 'scene_open_scene',
            description: '打开场景',
            inputSchema: {
                type: 'object',
                properties: { uuid: { type: 'string', description: '场景资源 uuid' } },
                required: ['uuid'],
            },
            handler: async function (args) {
                return await msg('scene', 'open-scene', args.uuid);
            },
        },
        {
            name: 'scene_save_scene',
            description: '保存当前场景',
            inputSchema: { type: 'object', properties: {} },
            handler: async function () {
                return await msg('scene', 'save-scene');
            },
        },
        {
            name: 'scene_soft_reload',
            description: '软重载场景（不清编辑器状态）',
            inputSchema: { type: 'object', properties: {} },
            handler: async function () {
                return await msg('scene', 'soft-reload');
            },
        },
        {
            name: 'scene_execute_component_method',
            description: '调用指定节点组件上的方法',
            inputSchema: {
                type: 'object',
                properties: {
                    uuid: { type: 'string' },
                    name: { type: 'string', description: '方法名' },
                    args: { type: 'array', items: {} },
                },
                required: ['uuid', 'name'],
            },
            handler: async function (args) {
                return await msg('scene', 'execute-component-method', {
                    uuid: args.uuid,
                    name: args.name,
                    args: args.args || [],
                });
            },
        },

        // ── asset-db 域 ──
        {
            name: 'asset_query_assets',
            description: '按 pattern 列出资源（glob，如 db://assets/**/*.prefab）',
            inputSchema: {
                type: 'object',
                properties: {
                    pattern: { type: 'string' },
                    ccType: { type: 'string', description: '可选：cc 类型过滤，如 cc.Prefab' },
                },
            },
            handler: async function (args) {
                return await msg('asset-db', 'query-assets', {
                    pattern: args.pattern,
                    ccType: args.ccType,
                });
            },
        },
        {
            name: 'asset_query_info',
            description: '按 url 或 uuid 查询资源元数据',
            inputSchema: {
                type: 'object',
                properties: {
                    urlOrUUID: { type: 'string' },
                },
                required: ['urlOrUUID'],
            },
            handler: async function (args) {
                return await msg('asset-db', 'query-asset-info', args.urlOrUUID);
            },
        },
        {
            name: 'asset_query_url',
            description: '由 uuid 反查 url',
            inputSchema: {
                type: 'object',
                properties: { uuid: { type: 'string' } },
                required: ['uuid'],
            },
            handler: async function (args) {
                return await msg('asset-db', 'query-url', args.uuid);
            },
        },
        {
            name: 'asset_query_uuid',
            description: '由 url 反查 uuid',
            inputSchema: {
                type: 'object',
                properties: { url: { type: 'string' } },
                required: ['url'],
            },
            handler: async function (args) {
                return await msg('asset-db', 'query-uuid', args.url);
            },
        },
        {
            name: 'asset_refresh',
            description: '刷新资源（可指定子目录）',
            inputSchema: {
                type: 'object',
                properties: { url: { type: 'string', description: '默认 db://assets/' } },
            },
            handler: async function (args) {
                return await msg('asset-db', 'refresh-asset', args.url || 'db://assets/');
            },
        },
        {
            name: 'asset_reimport',
            description: '重新导入指定资源',
            inputSchema: {
                type: 'object',
                properties: { url: { type: 'string' } },
                required: ['url'],
            },
            handler: async function (args) {
                return await msg('asset-db', 'reimport-asset', args.url);
            },
        },
        {
            name: 'asset_create',
            description: '创建资源（文本内容）',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string' },
                    content: { type: 'string' },
                    overwrite: { type: 'boolean' },
                },
                required: ['url', 'content'],
            },
            handler: async function (args) {
                return await msg('asset-db', 'create-asset', args.url, args.content, { overwrite: !!args.overwrite });
            },
        },
        {
            name: 'asset_save',
            description: '保存已有资源内容',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string' },
                    content: { type: 'string' },
                },
                required: ['url', 'content'],
            },
            handler: async function (args) {
                return await msg('asset-db', 'save-asset', args.url, args.content);
            },
        },
        {
            name: 'asset_delete',
            description: '删除资源',
            inputSchema: {
                type: 'object',
                properties: { url: { type: 'string' } },
                required: ['url'],
            },
            handler: async function (args) {
                return await msg('asset-db', 'delete-asset', args.url);
            },
        },
        {
            name: 'asset_move',
            description: '移动资源',
            inputSchema: {
                type: 'object',
                properties: {
                    source: { type: 'string' },
                    target: { type: 'string' },
                },
                required: ['source', 'target'],
            },
            handler: async function (args) {
                return await msg('asset-db', 'move-asset', args.source, args.target);
            },
        },

        // ── preview 域 ──
        {
            name: 'preview_query_url',
            description: '查询当前预览地址',
            inputSchema: { type: 'object', properties: {} },
            handler: async function () {
                return { url: await local.getPreviewUrl() };
            },
        },
        {
            name: 'preview_refresh_and_reload',
            description: '一键：刷新资源 + 软重载场景',
            inputSchema: { type: 'object', properties: {} },
            handler: async function () {
                await local.doRefreshAssets();
                await local.doReloadScene();
                return 'ok';
            },
        },

        // ── local 域 ──
        {
            name: 'local_reload_package',
            description: 'reload（disable→enable）指定编辑器扩展，让其 JS 代码改动生效，无需重启编辑器。本质 Editor.Package.disable→enable，fire-and-forget 立即返回。',
            inputSchema: {
                type: 'object',
                properties: { name: { type: 'string', description: '扩展名（package.json 的 name，如 state-ctrl-gen）' } },
                required: ['name'],
            },
            handler: async function (args) {
                local.reloadPackage(args.name);
                return { ok: true, reloaded: args.name };
            },
        },
        {
            name: 'local_get_status',
            description: '获取插件本地状态（git 分支/HEAD、watchers、预览、命令日志）',
            inputSchema: { type: 'object', properties: {} },
            handler: async function () {
                return await local.getStatus();
            },
        },
        {
            name: 'local_list_worktrees',
            description: '扫描同机其他 worktree 的 dev-reload-info.json',
            inputSchema: { type: 'object', properties: {} },
            handler: async function () {
                return local.listWorktrees();
            },
        },
        {
            name: 'local_open_dev_dir',
            description: '在 Finder 打开 .dev 目录',
            inputSchema: { type: 'object', properties: {} },
            handler: async function () {
                return local.openDevDir();
            },
        },
        {
            name: 'local_clean_dev_dir',
            description: '清理 .dev 临时产物',
            inputSchema: { type: 'object', properties: {} },
            handler: async function () {
                return local.cleanDevDir();
            },
        },
        {
            name: 'meta_fix_reset_border',
            description: '清理 Cocos 重启造成的图片 meta 噪音：① 纯 key 顺序/格式变化（值没变只 git diff 噪音）还原成 git 原文；② 九宫格 border（subMetas.*.userData.border*）被重置成 0 的精准还原 git 的值。靠 git 对比、正确处理中文路径。dryRun=true 只预览不写。',
            inputSchema: {
                type: 'object',
                properties: { dryRun: { type: 'boolean', description: 'true=只预览不写文件，列出将还原的 meta' } },
            },
            handler: async function (args) {
                return local.fixResetBorders({ dryRun: !!(args && args.dryRun) });
            },
        },
    ];
}

function defineResources(ctx) {
    var msg = ctx.msg;
    var local = ctx.local;
    return [
        {
            uri: 'cocos://project/info',
            name: 'Project Info',
            description: '项目路径、名称、引擎版本',
            mimeType: 'application/json',
            read: async function () {
                return await local.getStatus();
            },
        },
        {
            uri: 'cocos://scene/tree',
            name: 'Current Scene Tree',
            description: '当前场景节点树 dump',
            mimeType: 'application/json',
            read: async function () {
                return await msg('scene', 'query-node-tree');
            },
        },
        {
            uri: 'cocos://preview/url',
            name: 'Preview URL',
            description: '当前预览地址',
            mimeType: 'text/plain',
            read: async function () {
                return await local.getPreviewUrl();
            },
        },
    ];
}

module.exports = { defineTools: defineTools, defineResources: defineResources };
