// 解开一层嵌套实例，保留其内部独立子 Prefab 及跨 Prefab 引用。
// 暂不支持增删组件/子节点的实例和跨多层的宿主 override；遇到这些情况先拒绝。
'use strict';

const { parsePrefab } = require('../../parse.js');
const { resolveUuidToPath } = require('../../uuid-resolver.js');
const { isStub, resolveNode } = require('../helpers.js');
const { collectExistingFileIds, syncNestedRoots } = require('../id-utils.js');

function fail(message) { throw new Error(`editPrefab [unpack-nested-prefab]: ${message}`); }
function setField(object, parts, value) {
  if (!Array.isArray(parts) || !parts.length || parts.some(k => ['__proto__', 'prototype', 'constructor'].includes(k))) fail('无效 propertyPath');
  for (let i = 0; i < parts.length - 1; i++) {
    if (!object[parts[i]] || typeof object[parts[i]] !== 'object') fail('propertyPath 中间字段不存在');
    object = object[parts[i]];
  }
  object[parts[parts.length - 1]] = value;
}

function execUnpackNestedPrefab(prefabData, op) {
  const { elements, rootId } = prefabData;
  const { node, nodeId } = resolveNode(prefabData, op.node, 'unpack-nested-prefab');
  if (!isStub(elements, node) || !node._parent) fail('目标必须是有父节点的嵌套 Prefab');
  const piId = node._prefab.__id__, pi = elements[piId], instance = elements[pi.instance?.__id__];
  if (!instance) fail('缺少 PrefabInstance');
  for (const field of ['mountedChildren', 'mountedComponents', 'removedComponents']) {
    if (instance[field]?.length) fail(`暂不支持 ${field}`);
  }
  const source = parsePrefab(resolveUuidToPath(pi.asset.__uuid__, prefabData.resolverStartPath));
  const src = source.elements, srcRoot = src[source.rootId], srcPiId = srcRoot._prefab?.__id__, srcPi = src[srcPiId];
  if (isStub(src, srcRoot) || !srcPi || srcPi.instance) fail('暂不支持 Prefab 变体');

  // 只在当前 Prefab 的作用域解析 fileId，内层实例的相同 fileId 不参与匹配。
  const byFileId = new Map();
  for (let i = 0; i < src.length; i++) {
    const item = src[i];
    const info = src[item?._prefab?.__id__ ?? item?.__prefab?.__id__];
    if (!info?.fileId || (info.root && info.root.__id__ !== source.rootId)) continue;
    if (byFileId.has(info.fileId)) fail(`源文件中有歧义 fileId: ${info.fileId}`);
    byFileId.set(info.fileId, i);
  }
  function resolveDirect(info) {
    const chain = info?.localID;
    if (!Array.isArray(chain) || chain.length !== 1 || !byFileId.has(chain[0])) fail('暂不支持宿主跨多层 override 或目标不存在');
    return byFileId.get(chain[0]);
  }
  const properties = (instance.propertyOverrides || []).map(ref => {
    const override = elements[ref.__id__];
    const id = resolveDirect(elements[override?.targetInfo?.__id__]);
    if (['_children', '_components', '_prefab', '__prefab', '__type__', '_parent'].includes(override.propertyPath?.[0])) fail('不支持结构字段 override');
    return { id, path: override.propertyPath, value: override.value };
  });
  const hostPi = elements[elements[rootId]._prefab.__id__];
  const bindings = [];
  for (const ref of hostPi.targetOverrides || []) {
    const binding = elements[ref.__id__];
    if (binding?.source?.__id__ === nodeId) fail('暂不支持以待解开实例为 source 的 override');
    if (binding?.target?.__id__ !== nodeId) continue;
    if (binding.sourceInfo || !elements[binding.source?.__id__]) fail('暂不支持嵌套 sourceInfo');
    bindings.push({ ref, binding, id: resolveDirect(elements[binding.targetInfo?.__id__]) });
  }

  // 保留宿主节点和 PrefabInfo 的槽位与 fileId，其余身份没有冲突时原样保留。
  const existing = collectExistingFileIds(elements);
  for (let i = 1; i < src.length; i++) {
    const item = src[i];
    if (i === srcPiId || !item?.fileId) continue;
    if (existing.has(item.fileId)) fail(`fileId 与宿主冲突: ${item.fileId}`);
    existing.add(item.fileId);
  }
  const map = new Map([[0, 0], [source.rootId, nodeId], [srcPiId, piId]]);
  for (let i = 1; i < src.length; i++) if (!map.has(i)) { map.set(i, elements.length); elements.push(null); }
  function clone(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clone);
    if (Number.isInteger(value.__id__)) {
      if (!map.has(value.__id__)) fail(`源引用越界: ${value.__id__}`);
      return { ...value, __id__: map.get(value.__id__) };
    }
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = clone(value[key]);
    return copy;
  }
  for (let i = 1; i < src.length; i++) {
    const copy = clone(src[i]);
    if (copy?.__type__ === 'cc.PrefabInfo' && !copy.asset?.__uuid__) {
      copy.root = { __id__: rootId };
      copy.asset = { __id__: 0 };
      copy.nestedPrefabInstanceRoots = null;
    }
    if (copy?.__type__ === 'cc.PrefabInstance' && copy.prefabRootNode?.__id__ === nodeId) copy.prefabRootNode = { __id__: rootId };
    elements[map.get(i)] = copy;
  }
  elements[nodeId]._parent = node._parent;
  elements[piId].fileId = pi.fileId;
  elements[piId].instance = null;
  const importedBindings = elements[piId].targetOverrides || [];
  elements[piId].targetOverrides = null;
  for (const property of properties) setField(elements[map.get(property.id)], property.path, property.value);
  for (const { binding, id } of bindings) {
    setField(elements[binding.source.__id__], binding.propertyPath, { __id__: map.get(id) });
    binding.source = null; binding.target = null; binding.targetInfo = null;
  }
  hostPi.targetOverrides = (hostPi.targetOverrides || []).filter(ref => !bindings.some(b => b.ref.__id__ === ref.__id__)).concat(importedBindings);
  instance.propertyOverrides = [];
  syncNestedRoots(elements, rootId);
  return nodeId;
}

module.exports = { execUnpackNestedPrefab };
