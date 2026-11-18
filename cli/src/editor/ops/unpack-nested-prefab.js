// 解开一层嵌套实例，把挂载组件及引用迁到解包后的作用域。
'use strict';

const { parsePrefab } = require('../../parse.js');
const { resolveUuidToPath } = require('../../uuid-resolver.js');
const { findRootPrefabInfo, isStub, resolveNode } = require('../helpers.js');
const { syncNestedRoots } = require('../id-utils.js');

function fail(message) { throw new Error(`editPrefab [unpack-nested-prefab]: ${message}`); }

function deref(elements, value) {
  return Number.isInteger(value?.__id__) ? elements[value.__id__] : value;
}

function append(elements, value) {
  const ref = { __id__: elements.length };
  elements.push(value);
  return ref;
}

function setField(object, path, value) {
  for (const key of path.slice(0, -1)) {
    if (!object[key] || typeof object[key] !== 'object') fail('propertyPath 中间字段不存在');
    object = object[key];
  }
  object[path[path.length - 1]] = value;
}

function validatePath(path) {
  if (!Array.isArray(path) || !path.length || path.some(key =>
    (typeof key !== 'string' && !Number.isInteger(key)) || ['__proto__', 'prototype', 'constructor'].includes(key))) {
    fail('无效 propertyPath');
  }
}

function indexScope(elements, rootId, skipId) {
  const scope = new Map();
  const visited = new Set();
  function add(fileId, id, nested = false) {
    if (!fileId) return;
    if (scope.has(fileId)) fail(`同一作用域内 fileId 重复: ${fileId}`);
    scope.set(fileId, { id, nested });
  }
  function visit(id) {
    if (id === skipId) return;
    const node = elements[id];
    if (node?.__type__ !== 'cc.Node' || visited.has(id)) fail('无效的 Prefab 节点层级');
    visited.add(id);
    const info = deref(elements, node._prefab);
    if (isStub(elements, node)) {
      const instanceId = deref(elements, info.instance).fileId;
      if (!instanceId) fail('内层 Prefab 缺少实例 fileId');
      add(instanceId, id, true);
      return;
    }
    add(info?.fileId, id);
    for (const ref of node._components || []) {
      add(deref(elements, deref(elements, ref)?.__prefab)?.fileId, ref.__id__);
    }
    for (const ref of node._children || []) visit(ref.__id__);
  }
  visit(rootId);
  return scope;
}

function localId(elements, ref) {
  const chain = deref(elements, ref)?.localID;
  if (!Array.isArray(chain) || !chain.length || chain.some(id => typeof id !== 'string' || !id)) {
    fail('无效的 TargetInfo.localID');
  }
  return chain;
}

function instanceAt(elements, nodeId) {
  const info = deref(elements, elements[nodeId]?._prefab);
  const instance = deref(elements, info?.instance);
  if (instance?.__type__ !== 'cc.PrefabInstance') fail('目标缺少 PrefabInstance');
  return instance;
}

function appendPropertyOverride(elements, address, path, value) {
  const instance = instanceAt(elements, address.id);
  instance.propertyOverrides ??= [];
  instance.propertyOverrides.push(append(elements, {
    __type__: 'CCPropertyOverrideInfo',
    targetInfo: append(elements, { __type__: 'cc.TargetInfo', localID: address.chain }),
    propertyPath: path,
    value,
  }));
}

function copyTemplate(elements, rootId, nodeId, infoId, source) {
  const { elements: src, rootId: sourceRootId } = source;
  const sourceInfoId = src[sourceRootId]._prefab.__id__;
  const map = new Map([[0, 0], [sourceRootId, nodeId], [sourceInfoId, infoId]]);
  for (let i = 1; i < src.length; i++) {
    if (!map.has(i)) map.set(i, append(elements, null).__id__);
  }
  function clone(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clone);
    if (Number.isInteger(value.__id__)) {
      if (!map.has(value.__id__)) fail(`源引用越界: ${value.__id__}`);
      return { ...value, __id__: map.get(value.__id__) };
    }
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, clone(field)]));
  }
  for (let i = 1; i < src.length; i++) {
    const copy = clone(src[i]);
    if (copy?.__type__ === 'cc.PrefabInfo' && !copy.asset?.__uuid__) {
      copy.root = { __id__: rootId };
      copy.asset = { __id__: 0 };
      copy.nestedPrefabInstanceRoots = null;
    }
    if (copy?.__type__ === 'cc.PrefabInstance' && copy.prefabRootNode?.__id__ === nodeId) {
      copy.prefabRootNode = { __id__: rootId };
    }
    elements[map.get(i)] = copy;
  }
  return map;
}

function rebindOverrides(elements, hostInfo, outerId, resolveAddress, inheritedRefs) {
  const kept = [];
  function readAddress(id, info) {
    if (id === outerId && info) return resolveAddress(info);
    return { id, chain: info ? localId(elements, info) : undefined };
  }
  function keep(ref, source, path) {
    kept.push({ ref, key: JSON.stringify([source.id, source.chain, path]) });
  }
  for (const ref of inheritedRefs) {
    const row = deref(elements, ref);
    keep(ref, { id: row.source.__id__, chain: row.sourceInfo ? localId(elements, row.sourceInfo) : undefined }, row.propertyPath);
  }
  for (const ref of hostInfo.targetOverrides || []) {
    const row = deref(elements, ref);
    if (!row?.source || !row.target) {
      kept.push({ ref });
      continue;
    }
    const source = readAddress(row.source.__id__, row.sourceInfo);
    const path = row.propertyPath;
    if (row.source.__id__ !== outerId && row.target.__id__ !== outerId) {
      keep(ref, source, path);
      continue;
    }
    validatePath(path);
    const target = readAddress(row.target.__id__, row.targetInfo);
    if (target.chain) {
      row.source = { __id__: source.id };
      row.sourceInfo = source.chain ? append(elements, { __type__: 'cc.TargetInfo', localID: source.chain }) : null;
      row.target = { __id__: target.id };
      row.targetInfo = append(elements, { __type__: 'cc.TargetInfo', localID: target.chain });
      keep(ref, source, path);
      continue;
    }

    // 目标已内联。旧引用如果留在 targetOverrides，Creator 会试图从一个不存在的实例解析。
    const targetRef = { __id__: target.id };
    if (!source.chain && isStub(elements, elements[source.id])) {
      source.chain = [deref(elements, elements[source.id]._prefab).fileId];
    }
    if (source.chain) appendPropertyOverride(elements, source, path, targetRef);
    else setField(elements[source.id], path, targetRef);
    const key = JSON.stringify([source.id, source.chain, path]);
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i].key === key) kept.splice(i, 1);
    }
    row.source = null;
    row.target = null;
    row.targetInfo = null;
    row.sourceInfo = null;
  }
  // Creator 3.8 需要单字段 override 排在数组项 override 之前。
  const refs = kept.map(entry => entry.ref);
  const isArrayItem = ref => (deref(elements, ref)?.propertyPath?.length ?? 0) > 1;
  refs.sort((a, b) => Number(isArrayItem(a)) - Number(isArrayItem(b)));
  hostInfo.targetOverrides = refs.length ? refs : null;
}

function execUnpackNestedPrefab(prefabData, op) {
  const { elements, rootId } = prefabData;
  const { node, nodeId } = resolveNode(prefabData, op.node, 'unpack-nested-prefab');
  if (!isStub(elements, node) || !node._parent) fail('目标必须是有父节点的嵌套 Prefab');
  const infoId = node._prefab.__id__;
  const info = elements[infoId];
  const instance = instanceAt(elements, nodeId);
  for (const field of ['mountedChildren', 'removedComponents']) {
    if (instance[field]?.length) fail(`暂不支持 ${field}`);
  }
  const hostInfo = findRootPrefabInfo(elements, rootId);
  const source = parsePrefab(resolveUuidToPath(info.asset.__uuid__, prefabData.resolverStartPath));
  if (!hostInfo || !findRootPrefabInfo(source.elements, source.rootId)) fail('暂不支持 Prefab 变体');

  // 实例的作用域键是 PrefabInstance.fileId。多个实例可以带相同的模板根 fileId。
  const scope = indexScope(source.elements, source.rootId);
  const hostScope = indexScope(elements, rootId, nodeId);
  const claimed = new Set(hostScope.keys());
  function preserveId(fileId) {
    if (!fileId) return;
    if (claimed.has(fileId)) fail(`fileId 与宿主冲突: ${fileId}`);
    claimed.add(fileId);
  }
  preserveId(info.fileId);
  for (const [fileId, address] of scope) {
    if (address.id !== source.rootId) preserveId(fileId);
  }

  const map = copyTemplate(elements, rootId, nodeId, infoId, source);
  elements[nodeId]._parent = node._parent;
  elements[infoId].fileId = info.fileId;
  const inheritedRefs = elements[infoId].targetOverrides || [];
  elements[infoId].targetOverrides = null;

  function resolveAddress(ref) {
    const chain = localId(elements, ref);
    const address = scope.get(chain[0]);
    if (!address || address.nested !== (chain.length > 1)) fail(`无法定位跨层引用: ${chain.join('/')}`);
    return { id: map.get(address.id), chain: address.nested ? chain.slice(1) : undefined };
  }

  for (const ref of instance.mountedComponents || []) {
    const mount = deref(elements, ref);
    const address = resolveAddress(mount.targetInfo);
    const targetNode = elements[address.id];
    if (targetNode.__type__ !== 'cc.Node') fail('挂载组件的目标必须是节点');
    if (address.chain) {
      const inner = instanceAt(elements, address.id);
      inner.mountedComponents ??= [];
      inner.mountedComponents.push({
        ...mount, targetInfo: { __type__: 'cc.TargetInfo', localID: address.chain },
      });
      continue;
    }
    for (const componentRef of mount.components || []) {
      const component = deref(elements, componentRef);
      if (!component?.__type__) fail('挂载组件不存在');
      preserveId(deref(elements, component.__prefab)?.fileId);
      component.node = { __id__: address.id };
      targetNode._components.push(componentRef);
    }
  }

  for (const ref of instance.propertyOverrides || []) {
    const override = deref(elements, ref);
    const address = resolveAddress(override.targetInfo);
    const path = override.propertyPath;
    validatePath(path);
    if (['_children', '_components', '_prefab', '__prefab', '__type__', '_parent'].includes(path[0])) {
      fail('不支持结构字段 override');
    }
    if (address.chain) appendPropertyOverride(elements, address, path, override.value);
    else setField(elements[address.id], path, override.value);
  }
  rebindOverrides(elements, hostInfo, nodeId, resolveAddress, inheritedRefs);
  instance.mountedComponents = [];
  instance.propertyOverrides = [];
  syncNestedRoots(elements, rootId);
  return nodeId;
}

module.exports = { execUnpackNestedPrefab };
