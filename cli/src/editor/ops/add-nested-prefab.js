// add-nested-prefab: 在指定父节点下嵌入一个外部 prefab 实例（stub）。
//
// 等效于在 Cocos 编辑器把某个 prefab 文件拖入当前 prefab 树。生成三个对象：
//   - 一个 stub cc.Node（_name/_active 留空，由子 prefab 默认或 override 决定）
//   - 一个 cc.PrefabInfo（asset.__uuid__ = prefabUuid，instance 指向 PrefabInstance）
//   - 一个 cc.PrefabInstance（prefabRootNode 指向外层 prefab 根 = rootId）
//
// 可选 name / lpos 通过 propertyOverrides 写到 PrefabInstance 上（targetInfo.localID
// 用子 prefab 内根节点的 PrefabInfo.fileId，需读外部 prefab 文件解析）。
//
// op: { op: 'add-nested-prefab', parent: string|{id:N}, prefabUuid: string, name?: string, lpos?: [x,y,z] }
//
// 协议背景：参 doc/nested-prefab-protocol.md；与 replace-nested-prefab 互补
//   (replace 替换 asset uuid 不动节点结构，add 是从零生成嵌套实例)。

'use strict';

const { resolveNode } = require('../helpers.js');
const { collectExistingFileIds, uniqueFileId } = require('../id-utils.js');

function execAddNestedPrefab(prefabData, op) {
  const { elements, rootId } = prefabData;
  const { parent: parentSelector, prefabUuid, name, lpos } = op;

  if (typeof prefabUuid !== 'string' || prefabUuid.trim() === '') {
    throw new Error(`editPrefab [add-nested-prefab]: prefabUuid 必须是非空字符串`);
  }
  const cleanUuid = prefabUuid.trim();

  const { node: parentNode, nodeId: parentId } = resolveNode(prefabData, parentSelector, 'add-nested-prefab');

  // 父 prefab fileId 作 deterministic 种子
  let parentFileId = 'unknown';
  if (parentNode._prefab && typeof parentNode._prefab.__id__ === 'number') {
    const parentPi = elements[parentNode._prefab.__id__];
    if (parentPi && parentPi.fileId) parentFileId = parentPi.fileId;
  }
  const existingFileIds = collectExistingFileIds(elements);
  const baseSeed = `${parentFileId}#addNested#${cleanUuid}#${name ?? ''}`;
  const stubFileId = uniqueFileId(baseSeed, existingFileIds);
  const instanceFileId = uniqueFileId(`${baseSeed}#instance`, existingFileIds);

  // 分配 id：stubNode → prefabInfo → prefabInstance → [TargetInfo + OverrideInfo] × N
  const stubNodeId = elements.length;
  const prefabInfoId = stubNodeId + 1;
  const instanceId = stubNodeId + 2;
  let nextId = instanceId + 1;

  const propertyOverrideRefs = [];
  const overrideElements = [];

  // PropertyOverride 的 targetInfo.localID 用 stub 自己在外层 prefab 内的 PrefabInfo.fileId
  // （而不是子 prefab 内根节点 fileId）。CC3 协议：targetInfo 定位 override 应用的「目标对象」,
  // 对于 stub Node 自己的 _name/_lpos 这类字段，目标对象就是 stub 在外层 prefab 内的标识。
  function pushOverride(propertyPath, value) {
    const tiId = nextId++;
    const oiId = nextId++;
    overrideElements.push({
      __type__: 'cc.TargetInfo',
      localID: [stubFileId],
    });
    overrideElements.push({
      __type__: 'CCPropertyOverrideInfo',
      targetInfo: { __id__: tiId },
      propertyPath,
      value,
    });
    propertyOverrideRefs.push({ __id__: oiId });
  }

  if (name !== undefined) pushOverride(['_name'], name);
  if (lpos !== undefined) {
    pushOverride(['_lpos'], {
      __type__: 'cc.Vec3',
      x: lpos[0] || 0,
      y: lpos[1] || 0,
      z: lpos[2] || 0,
    });
  }

  const stubNode = {
    __type__: 'cc.Node',
    _objFlags: 0,
    _parent: { __id__: parentId },
    _prefab: { __id__: prefabInfoId },
    __editorExtras__: {},
  };

  const stubPrefabInfo = {
    __type__: 'cc.PrefabInfo',
    root: { __id__: stubNodeId },
    asset: { __uuid__: cleanUuid, __expectedType__: 'cc.Prefab' },
    fileId: stubFileId,
    instance: { __id__: instanceId },
    targetOverrides: null,
  };

  const prefabInstance = {
    __type__: 'cc.PrefabInstance',
    fileId: instanceFileId,
    prefabRootNode: { __id__: rootId },
    mountedChildren: [],
    mountedComponents: [],
    propertyOverrides: propertyOverrideRefs,
    removedComponents: [],
  };

  elements.push(stubNode);
  elements.push(stubPrefabInfo);
  elements.push(prefabInstance);
  for (const o of overrideElements) elements.push(o);

  if (!Array.isArray(parentNode._children)) parentNode._children = [];
  parentNode._children.push({ __id__: stubNodeId });

  // 同步外层 prefab 根 PrefabInfo.nestedPrefabInstanceRoots（cocos 加载嵌套实例的入口列表）。
  // 缺这一步运行时 stub 节点不会被解析渲染，子 prefab 内容看不到。
  syncNestedRoots(elements, rootId);

  return stubNodeId;
}

/**
 * 重建外层 prefab 根 PrefabInfo.nestedPrefabInstanceRoots，包含所有 _parent 非 null 的活 stub 节点。
 * 软删（remove-node）留下的孤儿 stub 自动排除。
 */
function syncNestedRoots(elements, rootId) {
  const rootNode = elements[rootId];
  if (!rootNode || !rootNode._prefab) return;
  const rootPrefabInfo = elements[rootNode._prefab.__id__];
  if (!rootPrefabInfo || rootPrefabInfo.__type__ !== 'cc.PrefabInfo') return;

  const stubIds = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || el.__type__ !== 'cc.Node') continue;
    if (!el._parent || typeof el._parent.__id__ !== 'number') continue;
    if (!el._prefab || typeof el._prefab.__id__ !== 'number') continue;
    const pi = elements[el._prefab.__id__];
    if (!pi || pi.__type__ !== 'cc.PrefabInfo') continue;
    if (!pi.instance) continue;
    const inst = elements[pi.instance.__id__];
    if (!inst || inst.__type__ !== 'cc.PrefabInstance') continue;
    stubIds.push(i);
  }
  rootPrefabInfo.nestedPrefabInstanceRoots = stubIds.map((id) => ({ __id__: id }));
}

module.exports = { execAddNestedPrefab };
