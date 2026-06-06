// remove-node: 从父 _children（或 stub 的 mountedChildren）移除节点引用，
// 并递归断开整棵子树所有节点/组件的 _parent 引用。
// 节点元素本身保留在数组（保持其他 __id__ 稳定）。
// op: { op: 'remove-node', target: string|{id:N} }

'use strict';

const { isStub, resolveNode } = require('../helpers.js');
const { disconnectSubtree, cleanupRootTargetOverrides, syncNestedRoots } = require('../id-utils.js');

function execRemoveNode(prefabData, op) {
  const { elements, rootId } = prefabData;
  const { target: targetSelector } = op;

  const { node: targetNode, nodeId: targetId } = resolveNode(prefabData, targetSelector, 'remove-node');

  if (!targetNode._parent || typeof targetNode._parent.__id__ !== 'number') {
    throw new Error(`editPrefab [remove-node]: 目标节点没有父节点，无法移除（根节点不能删除）`);
  }
  const parentId = targetNode._parent.__id__;
  const parentNode = elements[parentId];
  if (!parentNode || parentNode.__type__ !== 'cc.Node') {
    throw new Error(`editPrefab [remove-node]: 父节点 __id__=${parentId} 不是有效 cc.Node`);
  }

  if (isStub(elements, parentNode)) {
    const prefabRef = parentNode._prefab;
    const parentPrefabInfo = elements[prefabRef.__id__];
    const instanceRef = parentPrefabInfo.instance;
    const prefabInstance = elements[instanceRef.__id__];
    if (Array.isArray(prefabInstance.mountedChildren)) {
      prefabInstance.mountedChildren = prefabInstance.mountedChildren.filter(
        (r) => r.__id__ !== targetId
      );
    }
  } else {
    if (Array.isArray(parentNode._children)) {
      parentNode._children = parentNode._children.filter(
        (r) => r.__id__ !== targetId
      );
    }
  }

  // 收集整棵子树的所有 __id__（节点/组件/PrefabInfo/PrefabInstance）。
  // 必须在 disconnectSubtree 之前——后者会清空 mountedChildren、置 pi.instance=null，
  // 之后就拿不到嵌套实例的关联对象了。
  const subtreeIds = collectSubtreeIds(elements, targetId);

  disconnectSubtree(elements, targetId);

  // 软删后同步外层 PrefabInfo.nestedPrefabInstanceRoots，清掉孤儿 stub 引用
  syncNestedRoots(elements, rootId);

  // 清掉根 PrefabInfo.targetOverrides 中 source/target 指向被删子树的悬空条目。
  // 外层脚本对嵌套 stub 内部组件/节点的引用（如 _passScoreView → scoreView）走 targetOverride，
  // 删了 stub 后这条 override 仍被根 PrefabInfo 引用 → 可达悬空引用，运行时解析会报错。
  cleanupRootTargetOverrides(elements, rootId, subtreeIds);

  return targetId;
}

// 收集子树所有相关 __id__：节点、其组件、_prefab(PrefabInfo)、instance(PrefabInstance)、
// 以及 mountedChildren 指向的嵌套子树。供 targetOverride 悬空判断用。
function collectSubtreeIds(elements, nodeId, acc) {
  acc = acc || new Set();
  const node = elements[nodeId];
  if (!node || node.__type__ !== 'cc.Node' || acc.has(nodeId)) return acc;
  acc.add(nodeId);

  if (Array.isArray(node._children)) {
    for (const c of node._children) {
      if (c && typeof c.__id__ === 'number') collectSubtreeIds(elements, c.__id__, acc);
    }
  }

  if (node._prefab && typeof node._prefab.__id__ === 'number') {
    acc.add(node._prefab.__id__);
    const pi = elements[node._prefab.__id__];
    if (pi && pi.instance && typeof pi.instance.__id__ === 'number') {
      acc.add(pi.instance.__id__);
      const inst = elements[pi.instance.__id__];
      if (inst && Array.isArray(inst.mountedChildren)) {
        for (const mc of inst.mountedChildren) {
          if (mc && typeof mc.__id__ === 'number') collectSubtreeIds(elements, mc.__id__, acc);
        }
      }
    }
  }

  if (Array.isArray(node._components)) {
    for (const c of node._components) {
      if (c && typeof c.__id__ === 'number') acc.add(c.__id__);
    }
  }
  return acc;
}

module.exports = { execRemoveNode };
