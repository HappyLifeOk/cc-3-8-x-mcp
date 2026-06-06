// set-position: 设置节点本地位置
// op: { op, node, x, y, z? }

'use strict';

const { setOverrideProperty } = require('../../overrides.js');
const { isStub, resolveNode } = require('../helpers.js');

function execSetPosition(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeId, x, y, z = 0 } = op;

  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new Error(`editPrefab [set-position]: x/y 必须是数字`);
  }

  const { node, nodeId: id } = resolveNode(prefabData, nodeId, 'set-position');
  const newLpos = { __type__: 'cc.Vec3', x, y, z };

  if (isStub(elements, node)) {
    setOverrideProperty(prefabData, id, ['_lpos'], newLpos);
  } else {
    node._lpos = newLpos;
  }

  return id;
}

module.exports = { execSetPosition };
