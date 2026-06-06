// set-active: 设置节点 _active
// op: { op, node, active }

'use strict';

const { setOverrideProperty } = require('../../overrides.js');
const { isStub, resolveNode } = require('../helpers.js');

function execSetActive(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector, active } = op;

  if (typeof active !== 'boolean') {
    throw new Error(`editPrefab [set-active]: active 必须是布尔值`);
  }

  const { node, nodeId: id } = resolveNode(prefabData, nodeSelector, 'set-active');

  if (isStub(elements, node)) {
    setOverrideProperty(prefabData, id, ['_active'], active);
  } else {
    node._active = active;
  }

  return id;
}

module.exports = { execSetActive };
