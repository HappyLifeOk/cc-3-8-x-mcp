// sync-nested-roots: 重建根 PrefabInfo.nestedPrefabInstanceRoots，剔除「删了一半」
// 残留的悬空嵌套实例根——节点的父引用已被移除（_parent=null）但根 PrefabInfo 里
// 对它的登记还在，导致残留嵌套 prefab 的 asset 仍被当依赖加载（运行时 404 / 加载失败）。
//
// 只重写 nestedPrefabInstanceRoots 数组（依据当前「有父 + 有 PrefabInfo + instance」的
// 实际 stub 节点），不删 elements、不动其他 __id__、不产生 null 槽；被孤立的残留对象
// 成为不可达 orphan（软删策略，无害）。
//
// op: { op: 'sync-nested-roots' }  无参数，作用于 prefab 根。
'use strict';

const { syncNestedRoots } = require('../id-utils.js');

function execSyncNestedRoots(prefabData) {
  const { elements, rootId } = prefabData;
  syncNestedRoots(elements, rootId);
  return rootId;
}

module.exports = { execSyncNestedRoots };
