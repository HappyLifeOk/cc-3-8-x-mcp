// query/overrides.js — 列出 stub 节点当前所有 propertyOverrides + 关联的 root targetOverrides
//
// 输出：每条 override 标注落点（stub 自身节点字段 / 嵌套内某组件字段 / 嵌套内某节点字段），
// 配合 reset-overrides op 调试/回滚。
//
// args:
//   - node: 节点 selector（name / id / {id} / {path}）；必须是 stub
//
// 输出结构：
// {
//   stubNodeId, stubFileId, nestedPrefab,
//   propertyOverrides: [
//     { target: { kind, ...}, propertyPath, value }
//   ],
//   rootTargetOverrides: [
//     { source: {id}, propertyPath, target: {...}, localIDChain }
//   ]
// }

'use strict';

const { parsePrefab } = require('../parse.js');
const { resolveUuidToPath } = require('../uuid-resolver.js');
const { resolveNode, isStub } = require('../editor/helpers.js');

function _buildFileIdIndex(nestedElements) {
  const index = new Map();
  for (let i = 0; i < nestedElements.length; i++) {
    const el = nestedElements[i];
    if (!el) continue;

    // 节点 PrefabInfo.fileId
    if (el.__type__ === 'cc.Node' && el._prefab && typeof el._prefab.__id__ === 'number') {
      const pi = nestedElements[el._prefab.__id__];
      if (pi && pi.__type__ === 'cc.PrefabInfo' && typeof pi.fileId === 'string') {
        index.set(pi.fileId, {
          kind: 'nested-node',
          nodeName: el._name || (el._parent ? null : '(root)'),
          nodeId: i,
        });
      }
    }

    // 组件 CompPrefabInfo.fileId
    if (el.__type__ && el.__prefab && typeof el.__prefab.__id__ === 'number') {
      const cpi = nestedElements[el.__prefab.__id__];
      if (cpi && cpi.__type__ === 'cc.CompPrefabInfo' && typeof cpi.fileId === 'string') {
        const ownerNode = el.node && typeof el.node.__id__ === 'number'
          ? nestedElements[el.node.__id__] : null;
        index.set(cpi.fileId, {
          kind: 'nested-component',
          componentType: el.__type__,
          ownerNodeName: ownerNode ? (ownerNode._name || '(root)') : null,
          ownerNodeId: ownerNode ? el.node.__id__ : null,
        });
      }
    }
  }
  return index;
}

function queryOverrides(prefabData, args) {
  const { elements } = prefabData;
  const nodeSelector = args && args.node;
  if (nodeSelector === undefined || nodeSelector === null) {
    throw new Error('queryPrefab[overrides]: 必须提供 node');
  }

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'overrides');
  if (!isStub(elements, node)) {
    throw new Error(`queryPrefab[overrides]: 节点 [${nodeId}] 不是 stub（无嵌套 prefab）`);
  }

  const prefabInfo = elements[node._prefab.__id__];
  const stubFileId = prefabInfo.fileId;
  const prefabInstance = elements[prefabInfo.instance.__id__];

  // 加载嵌套 prefab，建 fileId 反查索引
  const nestedUuid = prefabInfo.asset && prefabInfo.asset.__uuid__;
  let nestedPath = null;
  let fileIdIndex = new Map();
  if (typeof nestedUuid === 'string') {
    try {
      nestedPath = resolveUuidToPath(nestedUuid, prefabData.resolverStartPath);
      const nestedData = parsePrefab(nestedPath);
      fileIdIndex = _buildFileIdIndex(nestedData.elements);
    } catch (_) {
      // 嵌套 prefab 加载失败不阻断查询，target 会被标 unknown
    }
  }

  const propertyOverrides = [];
  if (Array.isArray(prefabInstance.propertyOverrides)) {
    for (const ref of prefabInstance.propertyOverrides) {
      if (!ref || typeof ref.__id__ !== 'number') continue;
      const info = elements[ref.__id__];
      if (!info || info.__type__ !== 'CCPropertyOverrideInfo') continue;
      const tiRef = info.targetInfo;
      const ti = tiRef && typeof tiRef.__id__ === 'number' ? elements[tiRef.__id__] : null;
      const localID = ti && Array.isArray(ti.localID) ? ti.localID : [];
      const fid = localID[0];

      let target;
      if (fid === stubFileId) {
        target = { kind: 'stub-node-field', nodeName: node._name || null };
      } else {
        const entry = fileIdIndex.get(fid);
        target = entry ? { ...entry, fileId: fid } : { kind: 'unknown', fileId: fid };
      }
      if (localID.length > 1) {
        target.localIDChain = [...localID];
      }

      propertyOverrides.push({
        target,
        propertyPath: [...(info.propertyPath || [])],
        value: info.value,
      });
    }
  }

  // 关联此 stub 的 root targetOverrides（cc.TargetOverrideInfo）
  const rootTargetOverrides = [];
  const rootNode = elements[prefabData.rootId];
  if (rootNode && rootNode._prefab && typeof rootNode._prefab.__id__ === 'number') {
    const rootPi = elements[rootNode._prefab.__id__];
    if (rootPi && Array.isArray(rootPi.targetOverrides)) {
      for (const r of rootPi.targetOverrides) {
        if (!r || typeof r.__id__ !== 'number') continue;
        const ov = elements[r.__id__];
        if (!ov || ov.__type__ !== 'cc.TargetOverrideInfo') continue;
        if (!ov.target || ov.target.__id__ !== nodeId) continue;
        const ti = ov.targetInfo && typeof ov.targetInfo.__id__ === 'number'
          ? elements[ov.targetInfo.__id__] : null;
        const localID = ti && Array.isArray(ti.localID) ? [...ti.localID] : [];
        const fid = localID[0];
        const entry = fileIdIndex.get(fid);
        const target = entry ? { ...entry, fileId: fid } : { kind: 'unknown', fileId: fid };
        rootTargetOverrides.push({
          source: { compId: ov.source ? ov.source.__id__ : null },
          propertyPath: [...(ov.propertyPath || [])],
          target,
          localIDChain: localID,
        });
      }
    }
  }

  return {
    stubNodeId: nodeId,
    stubFileId,
    nestedPrefab: nestedPath,
    propertyOverrides,
    rootTargetOverrides,
  };
}

module.exports = { queryOverrides };
