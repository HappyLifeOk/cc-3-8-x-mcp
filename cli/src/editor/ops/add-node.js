// add-node: 在指定父节点下新增一个 cc.Node
// op: { op: 'add-node', parent: string|{id:N}, node: { name, lpos?, components? } }
//
// 支持：
// - 普通父节点：新节点进入 parent._children
// - stub 父节点（嵌套 prefab 实例）：新节点进入 PrefabInstance.mountedChildren
// 若 node.components 包含 'UITransform'，自动创建 cc.UITransform（默认 100×100）

'use strict';

const { ref, makeNode, makePrefabInfo, makeCompPrefabInfo, makeUITransform } = require('../../primitives.js');
const { isStub, resolveNode } = require('../helpers.js');
const { collectExistingFileIds, uniqueFileId } = require('../id-utils.js');

const SUPPORTED_COMPONENTS = ['UITransform'];

function execAddNode(prefabData, op) {
  const { elements, rootId } = prefabData;
  const { parent: parentSelector, node: nodeSpec } = op;

  if (!nodeSpec || typeof nodeSpec.name !== 'string') {
    throw new Error(`editPrefab [add-node]: node.name 必须是字符串`);
  }

  const { node: parentNode, nodeId: parentId } = resolveNode(prefabData, parentSelector, 'add-node');

  if (Array.isArray(nodeSpec.components)) {
    for (const comp of nodeSpec.components) {
      if (typeof comp === 'string' && !SUPPORTED_COMPONENTS.includes(comp)) {
        throw new Error(
          `editPrefab [add-node]: unknown component type: ${comp}（已支持: ${SUPPORTED_COMPONENTS.join(', ')}）`
        );
      }
    }
  }

  const newNodeId = elements.length;

  // 父节点 fileId 用作 deterministic 种子
  let parentFileId = 'unknown';
  if (parentNode._prefab && typeof parentNode._prefab.__id__ === 'number') {
    const parentPrefabInfo = elements[parentNode._prefab.__id__];
    if (parentPrefabInfo && parentPrefabInfo.fileId) {
      parentFileId = parentPrefabInfo.fileId;
    }
  }
  const baseSeed = `${parentFileId}#addNode#${nodeSpec.name}`;

  const existingFileIds = collectExistingFileIds(elements);
  const nodeFileId = uniqueFileId(baseSeed, existingFileIds);
  const uitFileId = uniqueFileId(`${baseSeed}#uit`, existingFileIds);

  const prefabInfoId = newNodeId + 1;
  let componentIds = [];
  const newObjects = [];

  if (Array.isArray(nodeSpec.components) && nodeSpec.components.includes('UITransform')) {
    const uitId = newNodeId + 2;
    const uitPrefabInfoId = newNodeId + 3;
    componentIds = [uitId];

    const uitObj = makeUITransform({
      nodeId: newNodeId,
      width: nodeSpec.width || 100,
      height: nodeSpec.height || 100,
      anchor: nodeSpec.anchor || [0.5, 0.5],
      prefabInfoId: uitPrefabInfoId,
    });
    const uitCpi = makeCompPrefabInfo(uitFileId);

    newObjects.push(uitObj);
    newObjects.push(uitCpi);
  }

  const lpos = nodeSpec.lpos || [0, 0, 0];
  const newNodeObj = makeNode({
    name: nodeSpec.name,
    pos: lpos,
    active: nodeSpec.active !== undefined ? nodeSpec.active : true,
    parentId,
    childIds: [],
    componentIds,
    prefabId: prefabInfoId,
  });

  const newPrefabInfoObj = makePrefabInfo({
    rootId,
    fileId: nodeFileId,
    assetId: 0,
    nestedPrefabInstanceRoots: null,
  });

  elements.push(newNodeObj);
  elements.push(newPrefabInfoObj);
  for (const o of newObjects) elements.push(o);

  if (isStub(elements, parentNode)) {
    const prefabRef = parentNode._prefab;
    const parentPrefabInfo = elements[prefabRef.__id__];
    const instanceRef = parentPrefabInfo.instance;
    const prefabInstance = elements[instanceRef.__id__];
    if (!Array.isArray(prefabInstance.mountedChildren)) {
      prefabInstance.mountedChildren = [];
    }
    prefabInstance.mountedChildren.push({ __id__: newNodeId });
  } else {
    if (!Array.isArray(parentNode._children)) {
      parentNode._children = [];
    }
    parentNode._children.push({ __id__: newNodeId });
  }

  // ref 在此模块虽然没直接用，但保留 import 以便上层调试时一致；
  // 实际节点对象的子引用全在 makeNode/makePrefabInfo/makeUITransform 内部生成。
  void ref;

  return newNodeId;
}

module.exports = { execAddNode };
