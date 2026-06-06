// set-anchor: cc.UITransform 锚点便捷写法 + 自动补偿 lpos
// op: { op:'set-anchor', node, x?, y?, compensatePosition? }
//
// - x / y 为新 anchor 值（0~1），任一缺省则保留原值
// - compensatePosition: true 时按 anchor 差值 * 节点 size 自动补偿 lpos
//   补偿公式：lpos.x += width * (newAnchorX - oldAnchorX)
//             lpos.y += height * (newAnchorY - oldAnchorY)
//   场景：改 anchor 又想保持节点视觉位置不动
// - stub 节点：_anchorPoint 走 PrefabInstance.propertyOverrides 写嵌套 UITransform；
//   compensate 时 _lpos 走 stub 节点自身的 propertyOverrides（节点字段）。
//   oldA / size 从嵌套 prefab 默认值读（不查 propertyOverrides 历史值）。

'use strict';

const { isStub, resolveNode, findComponent } = require('../helpers.js');
const { getNestedCompFileId, setStubCompOverride } = require('../nested.js');
const { setOverrideProperty } = require('../../overrides.js');
const { parsePrefab } = require('../../parse.js');
const { resolveUuidToPath } = require('../../uuid-resolver.js');

// 从嵌套 prefab 内读 root UITransform 的 _anchorPoint / _contentSize（默认值）
function _readNestedUITransform(hostPath, elements, stubNodeId) {
  const stub = elements[stubNodeId];
  const pi = elements[stub._prefab.__id__];
  const nestedUuid = pi.asset.__uuid__;
  const nestedPath = resolveUuidToPath(nestedUuid, hostPath);
  const nestedData = parsePrefab(nestedPath);
  const nEls = nestedData.elements;
  for (const el of nEls) {
    if (el && el.__type__ === 'cc.UITransform') {
      const a = el._anchorPoint || { x: 0.5, y: 0.5 };
      const s = el._contentSize || { width: 0, height: 0 };
      return {
        anchor: { x: a.x || 0, y: a.y || 0 },
        size:   { width: s.width || 0, height: s.height || 0 },
      };
    }
  }
  return { anchor: { x: 0.5, y: 0.5 }, size: { width: 0, height: 0 } };
}

function execSetAnchor(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector, x, y, compensatePosition = false } = op;

  if (x === undefined && y === undefined) {
    throw new Error(`editPrefab [set-anchor]: 至少提供 x 或 y 之一`);
  }
  if (x !== undefined && (typeof x !== 'number' || x < 0 || x > 1)) {
    throw new Error(`editPrefab [set-anchor]: x 必须是 0~1 数字`);
  }
  if (y !== undefined && (typeof y !== 'number' || y < 0 || y > 1)) {
    throw new Error(`editPrefab [set-anchor]: y 必须是 0~1 数字`);
  }

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'set-anchor');

  if (isStub(elements, node)) {
    const { anchor: oldA, size } = _readNestedUITransform(
      prefabData.resolverStartPath, elements, nodeId
    );
    const newA = {
      __type__: 'cc.Vec2',
      x: x === undefined ? oldA.x : x,
      y: y === undefined ? oldA.y : y,
    };
    const compFileId = getNestedCompFileId(
      prefabData.resolverStartPath, elements, nodeId, 'cc.UITransform', null
    );
    setStubCompOverride(prefabData, nodeId, compFileId, ['_anchorPoint'], newA);

    if (compensatePosition) {
      // stub 节点 _lpos 改值走自身 propertyOverrides（节点字段，不是组件字段）
      const lpos = node._lpos || { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 };
      const dx = size.width * (newA.x - oldA.x);
      const dy = size.height * (newA.y - oldA.y);
      const newLpos = {
        __type__: 'cc.Vec3',
        x: (lpos.x || 0) + dx,
        y: (lpos.y || 0) + dy,
        z: lpos.z || 0,
      };
      setOverrideProperty(prefabData, nodeId, ['_lpos'], newLpos);
    }
    return nodeId;
  }

  const ut = findComponent(elements, node, 'cc.UITransform');
  if (!ut) {
    throw new Error(`editPrefab [set-anchor]: 节点 "${node._name}" 上没有 cc.UITransform`);
  }

  const oldA = ut._anchorPoint || { x: 0.5, y: 0.5 };
  const newA = {
    __type__: 'cc.Vec2',
    x: x === undefined ? oldA.x : x,
    y: y === undefined ? oldA.y : y,
  };
  ut._anchorPoint = newA;

  if (compensatePosition) {
    const size = ut._contentSize || { width: 0, height: 0 };
    const lpos = node._lpos || { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 };
    const dx = (size.width || 0) * (newA.x - oldA.x);
    const dy = (size.height || 0) * (newA.y - oldA.y);
    node._lpos = {
      __type__: 'cc.Vec3',
      x: (lpos.x || 0) + dx,
      y: (lpos.y || 0) + dy,
      z: lpos.z || 0,
    };
  }

  return nodeId;
}

module.exports = { execSetAnchor };
