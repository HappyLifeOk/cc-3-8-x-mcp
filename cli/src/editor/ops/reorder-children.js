// reorder-children: 调整节点的 _children 顺序（影响 UI 渲染层级）
// op: { op:'reorder-children', node, order }
//
// order：子节点名字数组（必须包含全部 _children 的 name），按这个顺序重排
//        或 __id__ 数组：[{id:N}, {id:M}, ...]
//
// stub 节点暂不支持（mountedChildren 顺序场景少见）

'use strict';

const { isStub, resolveNode } = require('../helpers.js');

function execReorderChildren(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector, order } = op;

  if (!Array.isArray(order) || order.length === 0) {
    throw new Error(`editPrefab [reorder-children]: order 必须是非空数组`);
  }

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'reorder-children');
  if (isStub(elements, node)) {
    throw new Error(
      `editPrefab [reorder-children]: 节点 "${node._name}" 是 stub，stub 子节点重排暂不支持`
    );
  }

  if (!Array.isArray(node._children)) {
    throw new Error(`editPrefab [reorder-children]: 节点 "${node._name}" 没有 _children`);
  }

  const childMap = new Map(); // key (name 或 id) -> child ref
  for (const cref of node._children) {
    if (typeof cref.__id__ !== 'number') continue;
    const child = elements[cref.__id__];
    if (!child) continue;
    childMap.set(cref.__id__, cref);
    if (typeof child._name === 'string' && child._name.length > 0) {
      childMap.set(child._name, cref);
    }
  }

  if (order.length !== node._children.length) {
    throw new Error(
      `editPrefab [reorder-children]: order 长度 ${order.length} ≠ _children 长度 ${node._children.length}（必须包含所有子节点）`
    );
  }

  const newChildren = [];
  const seen = new Set();
  for (const item of order) {
    let key;
    if (typeof item === 'string') {
      key = item;
    } else if (item && typeof item.id === 'number') {
      key = item.id;
    } else {
      throw new Error(`editPrefab [reorder-children]: order 元素必须是字符串名或 {id:N}，收到 ${JSON.stringify(item)}`);
    }
    const ref = childMap.get(key);
    if (!ref) {
      throw new Error(`editPrefab [reorder-children]: order 中的 "${key}" 不在 _children 内`);
    }
    if (seen.has(ref.__id__)) {
      throw new Error(`editPrefab [reorder-children]: order 中重复出现 "${key}"`);
    }
    seen.add(ref.__id__);
    newChildren.push(ref);
  }

  node._children = newChildren;
  return nodeId;
}

module.exports = { execReorderChildren };
