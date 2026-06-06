'use strict';

/**
 * router/src/offline-tools.js
 *
 * Router 级 offline prefab tool 定义。
 * 这些 tool 直接调用 cli/src/index.js 的 editPrefab / queryPrefab，
 * 同进程执行，无需 Cocos 编辑器运行。
 *
 * [offline] tool 命名不加 shortName 前缀（router 全局工具）。
 */

var fs = require('fs');
var path = require('path');

// 延迟 require，避免 bin.js 加载时 cli 路径不对
// __dirname = router/src/，cli 相对路径为 ../../cli/src/index.js
var CLI_INDEX = path.resolve(__dirname, '../../cli/src/index.js');

function getCli() {
    return require(CLI_INDEX);
}

// ── 工具：绝对路径校验 ──────────────────────────────────────────

/**
 * 校验 filePath 是否为绝对路径，否则抛错。
 * 原因：router 以 stdio 方式运行，cwd 不确定，相对路径有歧义。
 *
 * @param {string} filePath
 * @param {string} toolName
 */
function requireAbsolutePath(filePath, toolName) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
        throw new Error(
            '[' + toolName + '] filePath 必须是绝对路径，收到: ' + JSON.stringify(filePath) +
            '\n原因：router 以 stdio 模式运行，cwd 不确定，相对路径会产生歧义。'
        );
    }
}

// ── Tool 定义 ───────────────────────────────────────────────────

/**
 * offline tool 定义列表（与 router 自身 buildAggregatedToolList 合并）
 * 格式与编辑器 tool 相同，供 handleOfflineToolCall 分发。
 */
var OFFLINE_TOOLS = [
    {
        name: 'prefab_query',
        description: '[offline] 不需要 Cocos 编辑器运行。查询 prefab 文件节点树或单节点详情。\n' +
            'selector.type 可选：\n' +
            '  tree（默认）→ 精简节点树\n' +
            '  node → { name } 按名称查单节点详情\n' +
            '  find → { nodeType } 返回所有匹配 __type__ 的元素 id 列表',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'prefab 文件的绝对路径，如 /path/to/HomeUI.prefab',
                },
                selector: {
                    type: 'object',
                    description: '查询选择器，不传时默认 type="tree"',
                    properties: {
                        type: { type: 'string', enum: ['tree', 'node', 'find'] },
                        name: { type: 'string', description: 'selector.type="node" 时必填' },
                        nodeType: { type: 'string', description: 'selector.type="find" 时必填，如 "cc.Label"' },
                    },
                },
            },
            required: ['filePath'],
        },
    },
    {
        name: 'prefab_edit',
        description: '[offline] 不需要 Cocos 编辑器运行。声明式批量编辑 prefab 文件，全部 op 成功后一次性落盘。\n' +
            '支持的 op.op 类型：set-position / set-label-text / set-sprite-frame / set-active / add-node / remove-node / clone-node / add-component / set-component-ref\n' +
            'op.node / op.parent / op.refNode 可以是节点名称字符串，或 { id: N } 按 __id__ 定位。',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'prefab 文件的绝对路径',
                },
                ops: {
                    type: 'array',
                    description: 'op 描述数组，参考 cli editPrefab 文档',
                    items: {
                        type: 'object',
                        properties: {
                            op: { type: 'string' },
                            node: {},
                        },
                        required: ['op', 'node'],
                    },
                },
            },
            required: ['filePath', 'ops'],
        },
    },
    {
        name: 'prefab_batch',
        description: '[offline] 不需要 Cocos 编辑器运行。从 JSON 文件读取 ops 后批量编辑 prefab。\n' +
            'opsJsonPath 指向一个 JSON 文件，内容为 op 数组（与 prefab_edit 的 ops 格式相同）。\n' +
            '两个路径均必须为绝对路径。',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'prefab 文件的绝对路径',
                },
                opsJsonPath: {
                    type: 'string',
                    description: 'ops JSON 文件的绝对路径',
                },
            },
            required: ['filePath', 'opsJsonPath'],
        },
    },
];

// ── Tool 名称集合（用于快速判断是否是 offline tool）──────────────

var OFFLINE_TOOL_NAMES = new Set(OFFLINE_TOOLS.map(function (t) { return t.name; }));

/**
 * 判断 name 是否是 offline tool
 * @param {string} name
 * @returns {boolean}
 */
function isOfflineTool(name) {
    return OFFLINE_TOOL_NAMES.has(name);
}

// ── Tool 调用处理 ───────────────────────────────────────────────

/**
 * 处理 offline tool 调用，返回 MCP content 对象。
 *
 * @param {string} name   tool 名称
 * @param {object} args   tool 参数
 * @returns {{ content: Array }}
 */
async function handleOfflineToolCall(name, args) {
    var cli = getCli();

    if (name === 'prefab_query') {
        requireAbsolutePath(args.filePath, 'prefab_query');
        var result = cli.queryPrefab(args.filePath, args.selector);
        return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
    }

    if (name === 'prefab_edit') {
        requireAbsolutePath(args.filePath, 'prefab_edit');
        if (!Array.isArray(args.ops) || args.ops.length === 0) {
            throw new Error('[prefab_edit] ops 必须是非空数组');
        }
        var editResult = cli.editPrefab(args.filePath, args.ops);
        return {
            content: [{ type: 'text', text: JSON.stringify(editResult, null, 2) }],
        };
    }

    if (name === 'prefab_batch') {
        requireAbsolutePath(args.filePath, 'prefab_batch');
        requireAbsolutePath(args.opsJsonPath, 'prefab_batch');
        var opsRaw = fs.readFileSync(args.opsJsonPath, 'utf-8');
        var ops;
        try {
            ops = JSON.parse(opsRaw);
        } catch (e) {
            throw new Error('[prefab_batch] opsJsonPath 解析失败: ' + e.message);
        }
        if (!Array.isArray(ops) || ops.length === 0) {
            throw new Error('[prefab_batch] opsJsonPath 文件内容必须是非空数组');
        }
        var batchResult = cli.editPrefab(args.filePath, ops);
        return {
            content: [{ type: 'text', text: JSON.stringify(batchResult, null, 2) }],
        };
    }

    throw new Error('offline-tools: 未知 tool "' + name + '"');
}

module.exports = {
    OFFLINE_TOOLS: OFFLINE_TOOLS,
    isOfflineTool: isOfflineTool,
    handleOfflineToolCall: handleOfflineToolCall,
    requireAbsolutePath: requireAbsolutePath,
};
