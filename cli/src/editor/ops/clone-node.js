// clone-node: 深拷贝 source 及其整棵子树，挂到 parent 下
// op: { op: 'clone-node', source: string|{id:N}, parent: string|{id:N}, name: string }
//
// - 为每个新节点/组件分配新 __id__（push 到数组末尾）
// - 为每个新节点和组件生成新 fileId（deterministic，种子基于 source fileId + newName）
// - 更新所有内部 _parent 引用指向新副本
// - 新树挂到 parent._children（若 parent 是 stub 则走 mountedChildren）

'use strict';

const { isStub, resolveNode } = require('../helpers.js');
const { collectExistingFileIds, uniqueFileId } = require('../id-utils.js');

function execCloneNode(prefabData, op) {
  const { elements, rootId } = prefabData;
  const { source: sourceSelector, parent: parentSelector, name: newName } = op;

  if (typeof newName !== 'string') {
    throw new Error(`editPrefab [clone-node]: name 必须是字符串`);
  }

  const { node: sourceNode, nodeId: sourceId } = resolveNode(prefabData, sourceSelector, 'clone-node');
  const { node: parentNode, nodeId: parentId } = resolveNode(prefabData, parentSelector, 'clone-node');

  const oldToNew = new Map();

  function collectSubtreeNodeIds(nodeId) {
    const ids = [nodeId];
    const node = elements[nodeId];
    if (node && Array.isArray(node._children)) {
      for (const childRef of node._children) {
        if (typeof childRef.__id__ === 'number') {
          ids.push(...collectSubtreeNodeIds(childRef.__id__));
        }
      }
    }
    return ids;
  }

  const subtreeNodeIds = collectSubtreeNodeIds(sourceId);

  const allSourceIds = [];
  for (const nid of subtreeNodeIds) {
    allSourceIds.push(nid);
    const n = elements[nid];
    if (!n) continue;
    if (n._prefab && typeof n._prefab.__id__ === 'number') {
      allSourceIds.push(n._prefab.__id__);
    }
    if (Array.isArray(n._components)) {
      for (const cRef of n._components) {
        if (typeof cRef.__id__ === 'number') {
          const compId = cRef.__id__;
          allSourceIds.push(compId);
          const comp = elements[compId];
          if (comp && comp.__prefab && typeof comp.__prefab.__id__ === 'number') {
            allSourceIds.push(comp.__prefab.__id__);
          }
        }
      }
    }
  }

  const uniqueSourceIds = [...new Set(allSourceIds)];

  const insertStart = elements.length;
  for (let i = 0; i < uniqueSourceIds.length; i++) {
    oldToNew.set(uniqueSourceIds[i], insertStart + i);
    elements.push(null);
  }

  let sourceFileId = 'unknown';
  if (sourceNode._prefab && typeof sourceNode._prefab.__id__ === 'number') {
    const srcPInfo = elements[sourceNode._prefab.__id__];
    if (srcPInfo && srcPInfo.fileId) sourceFileId = srcPInfo.fileId;
  }
  const cloneBaseSeed = `${sourceFileId}#clone#${newName}`;
  const cloneExistingFileIds = collectExistingFileIds(elements);
  let cloneGenCounter = 0;
  function cloneGen() {
    const subSeed = `${cloneBaseSeed}#slot${cloneGenCounter++}`;
    return uniqueFileId(subSeed, cloneExistingFileIds);
  }

  function cloneObj(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(cloneObj);
    if (typeof obj.__id__ === 'number') {
      const newId = oldToNew.get(obj.__id__);
      if (newId !== undefined) return { __id__: newId };
      return { ...obj };
    }
    const result = {};
    for (const k of Object.keys(obj)) {
      result[k] = cloneObj(obj[k]);
    }
    return result;
  }

  for (const oldId of uniqueSourceIds) {
    const newId = oldToNew.get(oldId);
    const srcObj = elements[oldId];
    if (!srcObj) {
      elements[newId] = null;
      continue;
    }
    const cloned = cloneObj(srcObj);

    if (cloned.__type__ === 'cc.PrefabInfo') {
      cloned.fileId = cloneGen();
      cloned.root = { __id__: rootId };
      cloned.asset = { __id__: 0 };
      cloned.instance = null;
      cloned.targetOverrides = null;
      cloned.nestedPrefabInstanceRoots = null;
    }
    if (cloned.__type__ === 'cc.CompPrefabInfo') {
      cloned.fileId = cloneGen();
    }

    elements[newId] = cloned;
  }

  const newRootId = oldToNew.get(sourceId);
  const newRootNode = elements[newRootId];

  newRootNode._name = newName;
  newRootNode._parent = { __id__: parentId };

  if (isStub(elements, parentNode)) {
    const prefabRef = parentNode._prefab;
    const parentPrefabInfo = elements[prefabRef.__id__];
    const instanceRef = parentPrefabInfo.instance;
    const prefabInstance = elements[instanceRef.__id__];
    if (!Array.isArray(prefabInstance.mountedChildren)) {
      prefabInstance.mountedChildren = [];
    }
    prefabInstance.mountedChildren.push({ __id__: newRootId });
  } else {
    if (!Array.isArray(parentNode._children)) {
      parentNode._children = [];
    }
    parentNode._children.push({ __id__: newRootId });
  }

  return newRootId;
}

module.exports = { execCloneNode };
