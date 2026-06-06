// replace-nested-prefab: 替换 stub 节点（嵌套 prefab 实例）引用的外部 prefab asset。
// 改 PrefabInfo.asset.__uuid__；可选清空 PrefabInstance.propertyOverrides。
//
// 适用场景：
//   想把 ListItem.prefab 里某个嵌套子 prefab 从 OldPrefab 换成 NewPrefab，但
//   保留 stub 节点的父子关系、_prefab fileId 不变（即 ListItem 内的 __id__
//   引用稳定）。
//
// 注意：
//   - propertyOverrides 里的 targetFileId 是按老 prefab 内部 fileId 写的，新
//     prefab 通常没有对应 fileId。默认保留 overrides（编辑器加载时 skip 找不
//     到的 override，不报错）；clearOverrides=true 显式清空更干净。
//   - 不修改 PrefabInstance.fileId（这个是 stub 在外层 prefab 内的稳定标识，
//     跟外部 prefab 的 fileId 无关）。
//
// op: { op: 'replace-nested-prefab', target: string|{id:N}, prefabUuid: string, clearOverrides?: boolean }

'use strict';

const { isStub, resolveNode } = require('../helpers.js');

function execReplaceNestedPrefab(prefabData, op) {
  const { elements } = prefabData;
  const { target: targetSelector, prefabUuid, clearOverrides } = op;

  if (typeof prefabUuid !== 'string' || prefabUuid.trim() === '') {
    throw new Error(`editPrefab [replace-nested-prefab]: prefabUuid 必须是非空字符串`);
  }

  const { node: targetNode, nodeId: targetId } = resolveNode(prefabData, targetSelector, 'replace-nested-prefab');

  if (!isStub(elements, targetNode)) {
    throw new Error(`editPrefab [replace-nested-prefab]: 目标节点 [${targetId}] 不是嵌套 prefab stub（无 _prefab.instance）`);
  }

  if (!targetNode._prefab || typeof targetNode._prefab.__id__ !== 'number') {
    throw new Error(`editPrefab [replace-nested-prefab]: stub 节点 [${targetId}] 没有 _prefab 引用`);
  }
  const prefabInfo = elements[targetNode._prefab.__id__];
  if (!prefabInfo || prefabInfo.__type__ !== 'cc.PrefabInfo') {
    throw new Error(`editPrefab [replace-nested-prefab]: _prefab 指向的不是 cc.PrefabInfo`);
  }
  if (!prefabInfo.asset || typeof prefabInfo.asset !== 'object') {
    throw new Error(`editPrefab [replace-nested-prefab]: PrefabInfo 缺 asset 字段`);
  }

  prefabInfo.asset.__uuid__ = prefabUuid.trim();

  if (clearOverrides === true && prefabInfo.instance && typeof prefabInfo.instance.__id__ === 'number') {
    const prefabInstance = elements[prefabInfo.instance.__id__];
    if (prefabInstance && Array.isArray(prefabInstance.propertyOverrides)) {
      prefabInstance.propertyOverrides = [];
    }
  }
}

module.exports = { execReplaceNestedPrefab };
