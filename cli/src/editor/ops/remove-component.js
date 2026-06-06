// remove-component: 从普通节点 `_components` 数组移除指定组件的引用，
// 组件元素本身保留为 orphan（保持其他 __id__ 稳定，与 remove-node 同策略）。
// 关联的 cc.CompPrefabInfo 也随之 orphan（它只被 component._ _prefab 引用）。
//
// 同步清根 PrefabInfo.targetOverrides 中 source 指向被删组件的悬空条目：
// 外层脚本通过 targetOverride 把嵌套 stub 内部组件/节点挂到自己 @property 字段时，
// 删组件后这些 override 仍被根 PrefabInfo 引用 → 可达悬空引用 → cocos 解析时
// 反序列化 source.__id__ 触发 missing-class 报错。
//
// op: { op: 'remove-component', node, componentType }
//
// 不支持 stub 节点：嵌套 prefab 的组件由子 prefab 拥有，外层无法删除，
// 只能 set-component-enabled 禁用。stub 上调用本 op 会抛错。

'use strict';

const { normalizeComponentType, isStub, resolveNode } = require('../helpers.js');
const { cleanupRootTargetOverrides } = require('../id-utils.js');

function execRemoveComponent(prefabData, op) {
  const { elements, rootId } = prefabData;
  const { node: nodeSelector, componentType: rawCompType } = op;

  if (typeof rawCompType !== 'string' || rawCompType.length === 0) {
    throw new Error(`editPrefab [remove-component]: componentType 必须是非空字符串`);
  }

  const componentType = normalizeComponentType(rawCompType, prefabData.resolverStartPath);
  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'remove-component');

  if (isStub(elements, node)) {
    throw new Error(
      `editPrefab [remove-component]: 节点 "${node._name || nodeId}" 是 stub（嵌套 prefab 根），无法删除其内部组件；改用 set-component-enabled 禁用`
    );
  }

  if (!Array.isArray(node._components) || node._components.length === 0) {
    throw new Error(
      `editPrefab [remove-component]: 节点 "${node._name || nodeId}" 没有 _components 数组`
    );
  }

  let matchedCompId = -1;
  const next = [];
  for (const ref of node._components) {
    if (!ref || typeof ref.__id__ !== 'number') {
      next.push(ref);
      continue;
    }
    const comp = elements[ref.__id__];
    if (matchedCompId < 0 && comp && comp.__type__ === componentType) {
      matchedCompId = ref.__id__;
      continue; // 丢弃这条引用
    }
    next.push(ref);
  }

  if (matchedCompId < 0) {
    throw new Error(
      `editPrefab [remove-component]: 节点 "${node._name || nodeId}" 上找不到 ${rawCompType} 组件`
    );
  }

  node._components = next;

  // 收集被删组件相关 __id__：组件本身 + 它的 cc.CompPrefabInfo（__prefab 字段）。
  // targetOverride 的 source 一般指向组件本身；带上 CompPrefabInfo 为防御性兜底。
  const removedIds = new Set([matchedCompId]);
  const matchedComp = elements[matchedCompId];
  if (matchedComp && matchedComp.__prefab && typeof matchedComp.__prefab.__id__ === 'number') {
    removedIds.add(matchedComp.__prefab.__id__);
  }
  cleanupRootTargetOverrides(elements, rootId, removedIds);

  return nodeId;
}

module.exports = { execRemoveComponent };
