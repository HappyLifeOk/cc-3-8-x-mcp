// adjust-position: lpos 相对偏移
// op: { op:'adjust-position', node, dx?, dy?, dz? }
//
// 适合"在原位置基础上挪 N 像素"场景，免去先 query 取原值。
// 任一轴缺省视为 0。stub 节点走 setOverrideProperty，与 set-position 一致。

'use strict';

const { setOverrideProperty } = require('../../overrides.js');
const { isStub, resolveNode } = require('../helpers.js');

function execAdjustPosition(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector, dx = 0, dy = 0, dz = 0 } = op;

  if (typeof dx !== 'number' || typeof dy !== 'number' || typeof dz !== 'number') {
    throw new Error(`editPrefab [adjust-position]: dx/dy/dz 必须是数字`);
  }
  if (dx === 0 && dy === 0 && dz === 0) {
    throw new Error(`editPrefab [adjust-position]: dx/dy/dz 至少一个非零`);
  }

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'adjust-position');
  const lpos = node._lpos || { x: 0, y: 0, z: 0 };
  const newLpos = {
    __type__: 'cc.Vec3',
    x: (lpos.x || 0) + dx,
    y: (lpos.y || 0) + dy,
    z: (lpos.z || 0) + dz,
  };

  if (isStub(elements, node)) {
    setOverrideProperty(prefabData, nodeId, ['_lpos'], newLpos);
  } else {
    node._lpos = newLpos;
  }

  return nodeId;
}

module.exports = { execAdjustPosition };
