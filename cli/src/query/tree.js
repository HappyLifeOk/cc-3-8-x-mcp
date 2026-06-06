// query/tree.js — 精简节点树（递归 DFS）

'use strict';

const { listOverrides } = require('../overrides.js');
const { isStub, componentTypes, componentDetails } = require('./comp-fields.js');

function buildTree(prefabData, nodeId, visited, opts) {
  const { elements } = prefabData;
  const node = elements[nodeId];

  const stub = isStub(elements, node);
  const withComps = !!(opts && opts.withComps);

  // stub 节点真实 _name 字段为 null，需要从 propertyOverrides 里反查 _name override
  let resolvedName = node._name !== undefined ? node._name : null;
  if (stub) {
    try {
      const ovs = listOverrides(prefabData, nodeId);
      const nameOv = ovs.find((o) => o.propertyPath.length === 1 && o.propertyPath[0] === '_name');
      if (nameOv) resolvedName = nameOv.value;
    } catch (_) {
      // ignore
    }
  }
  // stub 节点 name 加 (stub) 后缀，肉眼一眼区分嵌套实例和普通节点
  // stub 无 _name override 时 resolvedName 为 null，显示纯 "(stub)" 字面值
  let displayName;
  if (stub) {
    displayName = resolvedName !== null ? `${resolvedName} (stub)` : '(stub)';
  } else {
    displayName = resolvedName;
  }

  const treeNode = {
    id: nodeId,
    name: displayName,
    type: node.__type__,
    active: node._active !== undefined ? node._active : null,
    isStub: stub,
  };
  if (stub) {
    const prefabInfo = elements[node._prefab.__id__];
    treeNode.stubAsset = prefabInfo && prefabInfo.asset && prefabInfo.asset.__uuid__
      ? prefabInfo.asset.__uuid__
      : null;
    try {
      treeNode.overrides = listOverrides(prefabData, nodeId);
    } catch (_) {
      treeNode.overrides = [];
    }
  }
  treeNode.children = [];
  if (withComps) {
    treeNode.components = componentDetails(elements, node);
  } else {
    treeNode.componentTypes = componentTypes(elements, node);
  }

  if (Array.isArray(node._children)) {
    for (const childRef of node._children) {
      if (typeof childRef.__id__ !== 'number') continue;
      const cid = childRef.__id__;
      if (visited.has(cid)) continue;
      visited.add(cid);
      treeNode.children.push(buildTree(prefabData, cid, visited, opts));
    }
  }

  return treeNode;
}

function queryTree(prefabData, opts) {
  const { rootId } = prefabData;
  const visited = new Set([rootId]);
  return buildTree(prefabData, rootId, visited, opts);
}

module.exports = { queryTree };
