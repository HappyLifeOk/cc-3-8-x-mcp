// set-node-color: 设置节点的 _color（cc.Node 自身颜色，影响整棵子树透明度和染色）
// op: {
//   op: 'set-node-color',
//   node,
//   r?: number (0-255)
//   g?: number (0-255)
//   b?: number (0-255)
//   a?: number (0-255)
// }
//
// 示例：{ op:'set-node-color', node:'btnClose', a:0 }   // 全透明
//       { op:'set-node-color', node:'bg', r:255, g:200, b:100, a:255 }

'use strict';

const { resolveNode, isStub } = require('../helpers.js');

function execSetNodeColor(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector, r, g, b, a } = op;

  if (r === undefined && g === undefined && b === undefined && a === undefined) {
    throw new Error(`editPrefab [set-node-color]: 至少提供一个分量（r/g/b/a）`);
  }

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'set-node-color');
  if (isStub(elements, node)) {
    throw new Error(`editPrefab [set-node-color]: 节点是 stub，请用 set-nested-component-field 改节点颜色分量`);
  }

  if (!node._color || typeof node._color !== 'object') {
    node._color = { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 };
  }
  if (r !== undefined) node._color.r = r;
  if (g !== undefined) node._color.g = g;
  if (b !== undefined) node._color.b = b;
  if (a !== undefined) node._color.a = a;

  return nodeId;
}

module.exports = { execSetNodeColor };
