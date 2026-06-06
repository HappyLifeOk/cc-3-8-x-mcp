// set-size: 改 cc.UITransform 内容尺寸
// op: { op:'set-size', node, width?, height? }
//
// width / height 任一缺省则保留原值
// stub 节点：走 PrefabInstance.propertyOverrides 写嵌套 UITransform._contentSize
//   - 任一缺省时从嵌套 prefab 读默认值补齐
//   - 不读 propertyOverrides 里的历史 override（少见且增加复杂度）

'use strict';

const { isStub, resolveNode, findComponent } = require('../helpers.js');
const { getNestedCompFileId, setStubCompOverride } = require('../nested.js');
const { parsePrefab } = require('../../parse.js');
const { resolveUuidToPath } = require('../../uuid-resolver.js');

// 从嵌套 prefab 内读 root UITransform 默认 _contentSize（用作 stub set-size 的缺省补齐）
function _readNestedUITransformSize(hostPath, elements, stubNodeId) {
  const stub = elements[stubNodeId];
  const pi = elements[stub._prefab.__id__];
  const nestedUuid = pi.asset.__uuid__;
  const nestedPath = resolveUuidToPath(nestedUuid, hostPath);
  const nestedData = parsePrefab(nestedPath);
  const nEls = nestedData.elements;
  for (const el of nEls) {
    if (el && el.__type__ === 'cc.UITransform') {
      const s = el._contentSize || { width: 0, height: 0 };
      return { width: s.width || 0, height: s.height || 0 };
    }
  }
  return { width: 0, height: 0 };
}

function execSetSize(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector, width, height } = op;

  if (width === undefined && height === undefined) {
    throw new Error(`editPrefab [set-size]: 至少提供 width 或 height 之一`);
  }
  if (width !== undefined && (typeof width !== 'number' || width < 0)) {
    throw new Error(`editPrefab [set-size]: width 必须是非负数字`);
  }
  if (height !== undefined && (typeof height !== 'number' || height < 0)) {
    throw new Error(`editPrefab [set-size]: height 必须是非负数字`);
  }

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'set-size');

  if (isStub(elements, node)) {
    const oldSize = _readNestedUITransformSize(prefabData.resolverStartPath, elements, nodeId);
    const newSize = {
      __type__: 'cc.Size',
      width: width === undefined ? oldSize.width : width,
      height: height === undefined ? oldSize.height : height,
    };
    const compFileId = getNestedCompFileId(
      prefabData.resolverStartPath, elements, nodeId, 'cc.UITransform', null
    );
    setStubCompOverride(prefabData, nodeId, compFileId, ['_contentSize'], newSize);
    return nodeId;
  }

  const ut = findComponent(elements, node, 'cc.UITransform');
  if (!ut) {
    throw new Error(`editPrefab [set-size]: 节点 "${node._name}" 上没有 cc.UITransform`);
  }

  const oldSize = ut._contentSize || { width: 0, height: 0 };
  ut._contentSize = {
    __type__: 'cc.Size',
    width: width === undefined ? oldSize.width : width,
    height: height === undefined ? oldSize.height : height,
  };

  return nodeId;
}

module.exports = { execSetSize };
