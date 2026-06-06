// ============================================================
// editor/index.js — 声明式批量编辑 prefab 主入口
//
// editPrefab(filePath, ops[], options?)
//   - 内存内依次执行所有 op
//   - 自动判别 stub vs 普通节点
//   - 任一 op 失败抛错、不落盘
//   - dryRun: 跑完不写盘，返回字段级 diff
// ============================================================

'use strict';

const { parsePrefab } = require('../parse.js');
const { writePrefab } = require('../write.js');
const { computeDiff } = require('./diff.js');

// 各 op handler
const { execSetPosition } = require('./ops/set-position.js');
const { execSetLabelText } = require('./ops/set-label-text.js');
const { execSetSpriteFrame } = require('./ops/set-sprite-frame.js');
const { execSetActive } = require('./ops/set-active.js');
const { execSetComponentField } = require('./ops/set-component-field.js');
const { execSetComponentEnabled } = require('./ops/set-component-enabled.js');
const { execSetAnchor } = require('./ops/set-anchor.js');
const { execSetSize } = require('./ops/set-size.js');
const { execAdjustPosition } = require('./ops/adjust-position.js');
const { execRenameNode } = require('./ops/rename-node.js');
const { execReparent } = require('./ops/reparent.js');
const { execReorderChildren } = require('./ops/reorder-children.js');
const { execAddNode } = require('./ops/add-node.js');
const { execRemoveNode } = require('./ops/remove-node.js');
const { execCloneNode } = require('./ops/clone-node.js');
const { execAddComponent } = require('./ops/add-component.js');
const { execRemoveComponent } = require('./ops/remove-component.js');
const { execSetComponentRef } = require('./ops/set-component-ref.js');
const { execSetNestedComponentField } = require('./ops/set-nested-component-field.js');
const { execBulkSet } = require('./ops/bulk-set.js');
const { execDedupeComponent } = require('./ops/dedupe-component.js');
const { execSetEditBox } = require('./ops/set-editbox.js');
const { execSetLabel } = require('./ops/set-label.js');
const { execSetButton } = require('./ops/set-button.js');
const { execSetLayout } = require('./ops/set-layout.js');
const { execSetRichText } = require('./ops/set-richtext.js');
const { execSetSprite } = require('./ops/set-sprite.js');
const { execSetNodeColor } = require('./ops/set-node-color.js');
const { execReplaceNestedPrefab } = require('./ops/replace-nested-prefab.js');
const { execAddNestedPrefab } = require('./ops/add-nested-prefab.js');
const { execResetOverrides } = require('./ops/reset-overrides.js');
const { execEnsureMeta } = require('./ops/ensure-meta.js');
const { execSyncNestedRoots } = require('./ops/sync-nested-roots.js');
const { validateOps } = require('./op-schema.js');

const OP_HANDLERS = {
  'set-position': execSetPosition,
  'set-label-text': execSetLabelText,
  'set-sprite-frame': execSetSpriteFrame,
  'set-active': execSetActive,
  'set-component-field': execSetComponentField,
  'set-component-enabled': execSetComponentEnabled,
  'set-anchor': execSetAnchor,
  'set-size': execSetSize,
  'adjust-position': execAdjustPosition,
  'rename-node': execRenameNode,
  'reparent': execReparent,
  'reorder-children': execReorderChildren,
  'add-node': execAddNode,
  'remove-node': execRemoveNode,
  'clone-node': execCloneNode,
  'add-component': execAddComponent,
  'remove-component': execRemoveComponent,
  'set-component-ref': execSetComponentRef,
  'set-nested-component-field': execSetNestedComponentField,
  'bulk-set': execBulkSet,
  'dedupe-component': execDedupeComponent,
  'set-editbox': execSetEditBox,
  'set-label': execSetLabel,
  'set-button': execSetButton,
  'set-layout': execSetLayout,
  'set-richtext': execSetRichText,
  'set-sprite': execSetSprite,
  'set-node-color': execSetNodeColor,
  'replace-nested-prefab': execReplaceNestedPrefab,
  'add-nested-prefab': execAddNestedPrefab,
  'reset-overrides': execResetOverrides,
  'ensure-meta': execEnsureMeta,
  'sync-nested-roots': execSyncNestedRoots,
};

/**
 * 声明式批量编辑 prefab
 *
 * @param {string}   filePath     prefab 文件路径（读取 + 写回同一路径）
 * @param {object[]} ops          op 描述数组
 * @param {object}   [options]
 * @param {string}   [options.projectRoot]  项目根目录（含 assets/），默认从 filePath 向上推断。
 * @param {boolean}  [options.dryRun]       true 时不写盘，仅返回模拟结果（含 diff）。
 * @returns {{ changed: boolean, opsApplied: number, nodesAffected: (string|number)[], dryRun?: boolean, diff?: object[] }}
 *
 * @throws 任一 op 失败时抛错，不落盘
 */
function editPrefab(filePath, ops, options) {
  if (typeof filePath !== 'string') {
    throw new Error('editPrefab: filePath 必须是字符串');
  }
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error('editPrefab: ops 必须是非空数组');
  }

  // schema 预校验：跑前发现拼错的字段（comp / ref / 拼漏 op 等），不到 handler 才报错
  validateOps(ops, Object.keys(OP_HANDLERS));

  const opts = options || {};

  const prefabData = parsePrefab(filePath);
  prefabData.resolverStartPath = opts.projectRoot || filePath;

  const dryRun = !!opts.dryRun;
  prefabData.dryRun = dryRun;
  const beforeSnapshot = dryRun
    ? JSON.parse(JSON.stringify(prefabData.elements))
    : null;

  const affectedIds = new Set();
  const affectedNames = [];

  let opsApplied = 0;
  for (const op of ops) {
    if (!op || typeof op.op !== 'string') {
      throw new Error(`editPrefab: op 格式错误（缺少 op 字段）: ${JSON.stringify(op)}`);
    }

    const handler = OP_HANDLERS[op.op];
    if (!handler) {
      throw new Error(
        `editPrefab: 不支持的 op 类型 "${op.op}"，支持: ${Object.keys(OP_HANDLERS).join(', ')}`
      );
    }

    const nodeId = handler(prefabData, op);
    if (typeof nodeId === 'number' && nodeId >= 0) {
      affectedIds.add(nodeId);
    }
    // bulk-set 0 匹配时返回 -1，跳过 affectedIds
    opsApplied++;
  }

  if (!dryRun) {
    writePrefab(filePath, prefabData.elements, prefabData.raw);
  }

  for (const id of affectedIds) {
    const node = prefabData.elements[id];
    if (node && node._name) {
      affectedNames.push(node._name);
    } else {
      affectedNames.push(id);
    }
  }

  const result = {
    changed: !dryRun,
    opsApplied,
    nodesAffected: affectedNames,
  };

  if (dryRun) {
    result.dryRun = true;
    result.diff = computeDiff(beforeSnapshot, prefabData.elements);
  }

  return result;
}

module.exports = { editPrefab, OP_HANDLERS };
