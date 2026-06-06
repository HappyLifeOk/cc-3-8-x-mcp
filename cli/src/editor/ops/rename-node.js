// rename-node: 改节点 _name
// op: { op:'rename-node', node, name }
//
// 普通节点：直接改 node._name
// stub 节点：name 存在 PrefabInstance.propertyOverrides 而不是 node._name
//   走 setOverrideProperty(['_name']) 与 set-active 同模式

'use strict';

const { setOverrideProperty } = require('../../overrides.js');
const { isStub, resolveNode } = require('../helpers.js');

function execRenameNode(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector, name } = op;

  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`editPrefab [rename-node]: name 必须是非空字符串`);
  }

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'rename-node');

  if (isStub(elements, node)) {
    setOverrideProperty(prefabData, nodeId, ['_name'], name);
  } else {
    node._name = name;
  }

  return nodeId;
}

module.exports = { execRenameNode };
