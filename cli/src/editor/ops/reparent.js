// reparent: 把节点从原父节点下移到新父节点下（不复制，原节点搬家）
// op: { op:'reparent', node, parent, index? }
//
// 行为：
//   1. 从原 parent._children 数组里移除 node 引用
//   2. 把 node 引用 push 到新 parent._children（或按 index 插入指定位置）
//   3. 改 node._parent 指向新 parent
//
// 限制：
//   - 不支持 stub 节点（嵌套 prefab 实例）作为 source 或 target
//     stub 的父子关系存在 PrefabInstance.mountedChildren / nestedPrefabInstanceRoots，
//     需要独立的 nested-reparent op，本 op 仅处理普通 inline 节点
//   - node 不能是 prefab 根节点（rootId=1），根节点 _parent 必须为 null
//   - parent 不能是 node 的后代（避免循环）
//   - 不修改 PrefabInfo.fileId（节点身份不变，外部引用仍然有效）

'use strict';

const { isStub, resolveNode } = require('../helpers.js');

/** node 是否是 parent（或其后代）的祖先 → 循环检测 */
function isAncestorOf(elements, ancestorId, candidateId) {
  let cur = candidateId;
  let safety = 0;
  while (cur != null && safety++ < 10000) {
    if (cur === ancestorId) return true;
    const node = elements[cur];
    if (!node || !node._parent) return false;
    cur = node._parent.__id__;
  }
  return false;
}

function execReparent(prefabData, op) {
  const { elements, rootId } = prefabData;
  const { node: nodeSelector, parent: parentSelector, index } = op;

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'reparent');
  const { node: newParent, nodeId: newParentId } = resolveNode(prefabData, parentSelector, 'reparent');

  // 根节点不能搬家
  if (nodeId === rootId) {
    throw new Error(`editPrefab [reparent]: 根节点（id=${rootId}）不能 reparent，其 _parent 必须为 null`);
  }

  // stub 检查
  if (isStub(elements, node)) {
    throw new Error(`editPrefab [reparent]: source 是 stub 节点（嵌套 prefab 实例），不支持，需独立 op`);
  }
  if (isStub(elements, newParent)) {
    throw new Error(`editPrefab [reparent]: target parent 是 stub 节点（嵌套 prefab 实例），不支持，需独立 op`);
  }

  // 同一节点不动
  const oldParentId = node._parent ? node._parent.__id__ : null;
  if (oldParentId === newParentId) {
    // 仅 index 调整 → 走 reorder-children 更清晰；这里允许只换位（reorder 调整）
    if (index === undefined) return nodeId;
  }

  // 循环检测：newParent 不能是 node 的后代
  if (isAncestorOf(elements, nodeId, newParentId)) {
    throw new Error(`editPrefab [reparent]: 循环引用——新父节点（id=${newParentId}）是源节点（id=${nodeId}）的后代`);
  }

  // 1. 从原 parent._children 移除
  if (oldParentId != null) {
    const oldParent = elements[oldParentId];
    if (oldParent && Array.isArray(oldParent._children)) {
      oldParent._children = oldParent._children.filter(
        (c) => !c || c.__id__ !== nodeId
      );
    }
  }

  // 2. 加到新 parent._children
  if (!Array.isArray(newParent._children)) newParent._children = [];
  const ref = { __id__: nodeId };
  if (typeof index === 'number' && index >= 0 && index < newParent._children.length) {
    newParent._children.splice(index, 0, ref);
  } else {
    newParent._children.push(ref);
  }

  // 3. 改 node._parent
  node._parent = { __id__: newParentId };

  return nodeId;
}

module.exports = { execReparent };
