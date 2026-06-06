// ============================================================
// CC3 Prefab PrefabInstance Override 读写（纯 CJS，零三方依赖）
//
// 三个已知地雷：
//   地雷 1：stub 节点（嵌套 prefab 根节点）本身的字段写入无效。
//           必须走 PrefabInstance.propertyOverrides，以 CCPropertyOverrideInfo
//           + TargetInfo 结构写入，才能被 Cocos 编辑器识别。
//   地雷 2：新增嵌套 stub 节点后，宿主 prefab 根节点的 cc.PrefabInfo
//           的 nestedPrefabInstanceRoots 必须同步追加该 stub 节点的 __id__，
//           否则 Cocos 加载时会忽略该嵌套实例的 override。
//   地雷 3：propertyOverride.targetInfo.localID 必须是
//           「嵌套 prefab 内根节点的 cc.PrefabInfo.fileId」，
//           不是「外层 stub 的 cc.PrefabInfo.fileId」。
//           Cocos 运行时按嵌套 prefab 内部 fileId 建 targetMap，
//           外层 stub fileId 在 targetMap 里查不到。
//           早期 fgui→cc3 转出的 prefab 设计上让这两个 fileId 一致，
//           所以本工具早期版本用 stubFileId 巧合工作；新写或手编的
//           嵌套 prefab 一般两个 fileId 不同，必须读嵌套 prefab 拿真值。
//
//           本工具当前行为（2026-05-20 修后）：
//           - 写入：强制读嵌套 prefab 拿真值，解析失败抛错。
//           - 自动矫正：识别旧 cli 写入的 stubFileId 条目，命中同
//             propertyPath 时把 localID 改写为真值（一次性迁移）。
//             迁移完成后旧条目不复存在，listOverrides / reset-overrides
//             只识别真值，不再兼容历史格式。
// ============================================================

'use strict';

const { parsePrefab } = require('./parse.js');
const { resolveUuidToPath } = require('./uuid-resolver.js');

/**
 * 查找 stub 节点对应的 PrefabInstance 对象
 *
 * stub 节点：__type__ = cc.Node，_prefab 指向一个 cc.PrefabInfo，
 * 该 PrefabInfo.instance 指向 cc.PrefabInstance。
 *
 * @param {object[]} elements   prefab 数组
 * @param {number}   stubId     stub 节点的 __id__（数组下标）
 * @returns {{ prefabInstance: object, prefabInstanceId: number, prefabInfo: object, prefabInfoId: number } | null}
 */
function _findStubPrefabInstance(elements, stubId) {
  const stub = elements[stubId];
  if (!stub || stub.__type__ !== 'cc.Node') return null;

  const prefabRef = stub._prefab;
  if (!prefabRef || typeof prefabRef.__id__ !== 'number') return null;

  const prefabInfoId = prefabRef.__id__;
  const prefabInfo = elements[prefabInfoId];
  if (!prefabInfo || prefabInfo.__type__ !== 'cc.PrefabInfo') return null;

  const instanceRef = prefabInfo.instance;
  if (!instanceRef || typeof instanceRef.__id__ !== 'number') return null;

  const prefabInstanceId = instanceRef.__id__;
  const prefabInstance = elements[prefabInstanceId];
  if (!prefabInstance || prefabInstance.__type__ !== 'cc.PrefabInstance') return null;

  return { prefabInstance, prefabInstanceId, prefabInfo, prefabInfoId };
}

/**
 * 加载嵌套 prefab 拿其根节点的 cc.PrefabInfo.fileId。
 * 这是 propertyOverride.targetInfo.localID 正确值（见地雷 3）。
 *
 * @param {object} prefabData   parsePrefab 返回值（外层 prefab），需含 resolverStartPath
 * @param {object} prefabInfo   stub 节点的 cc.PrefabInfo（包含 asset.__uuid__）
 * @returns {string}            嵌套 prefab 根节点 PrefabInfo.fileId
 *
 * @throws 嵌套 prefab UUID 缺失 / 解析失败 / 找不到根节点 fileId 时抛错
 */
function _getStubInnerRootFileId(prefabData, prefabInfo) {
  if (!prefabData || !prefabData.resolverStartPath) {
    throw new Error(`setOverrideProperty: prefabData 缺 resolverStartPath，无法解析嵌套 prefab`);
  }

  const assetRef = prefabInfo && prefabInfo.asset;
  if (!assetRef || typeof assetRef.__uuid__ !== 'string') {
    throw new Error(`setOverrideProperty: stub PrefabInfo.asset 不是 UUID 引用，无法定位嵌套 prefab`);
  }

  const nestedPath = resolveUuidToPath(assetRef.__uuid__, prefabData.resolverStartPath);
  if (typeof nestedPath !== 'string' || nestedPath.length === 0) {
    throw new Error(`setOverrideProperty: UUID "${assetRef.__uuid__}" 找不到对应 prefab 路径`);
  }

  const nestedData = parsePrefab(nestedPath);
  const nEls = nestedData.elements;
  for (const el of nEls) {
    if (!el || el.__type__ !== 'cc.Node') continue;
    // 嵌套 prefab 内根节点 _parent === null
    if (el._parent !== null && el._parent !== undefined) continue;
    if (!el._prefab || typeof el._prefab.__id__ !== 'number') continue;
    const pi = nEls[el._prefab.__id__];
    if (!pi || pi.__type__ !== 'cc.PrefabInfo') continue;
    if (typeof pi.fileId === 'string' && pi.fileId.length > 0) {
      return pi.fileId;
    }
  }
  throw new Error(`setOverrideProperty: 嵌套 prefab "${nestedPath}" 找不到根节点 PrefabInfo.fileId`);
}

/**
 * 找 PrefabInstance 中已有的 CCPropertyOverrideInfo
 * 条件：targetInfo 的 localID[0] === targetLocalId，propertyPath[0] === propertyPath
 *
 * @param {object[]} elements
 * @param {object}   prefabInstance
 * @param {string}   targetLocalId  目标 fileId（嵌套 prefab 内根节点 fileId）
 * @param {string[]} propertyPath
 * @param {string=}  legacyLocalId  兼容旧 prefab 写入的 stubFileId（一起匹配）
 * @returns {{ info: object, infoId: number } | null}
 */
function _findExistingOverride(elements, prefabInstance, targetLocalId, propertyPath, legacyLocalId) {
  if (!Array.isArray(prefabInstance.propertyOverrides)) return null;

  for (const overrideRef of prefabInstance.propertyOverrides) {
    if (typeof overrideRef.__id__ !== 'number') continue;
    const info = elements[overrideRef.__id__];
    if (!info || info.__type__ !== 'CCPropertyOverrideInfo') continue;

    // 匹配 targetInfo.localID[0]：targetLocalId 优先；legacyLocalId 用于兼容旧版 cli 写入的 stubFileId
    const targetInfoRef = info.targetInfo;
    if (!targetInfoRef || typeof targetInfoRef.__id__ !== 'number') continue;
    const targetInfo = elements[targetInfoRef.__id__];
    if (!targetInfo || targetInfo.__type__ !== 'cc.TargetInfo') continue;
    if (!Array.isArray(targetInfo.localID)) continue;
    const lid = targetInfo.localID[0];
    if (lid !== targetLocalId && lid !== legacyLocalId) continue;

    // 匹配 propertyPath
    if (!Array.isArray(info.propertyPath)) continue;
    if (info.propertyPath.length !== propertyPath.length) continue;
    if (info.propertyPath.every((p, i) => p === propertyPath[i])) {
      return { info, infoId: overrideRef.__id__, targetInfo };
    }
  }
  return null;
}

/**
 * 设置 stub 节点（嵌套 prefab 根节点）的属性 override
 *
 * 地雷 1：直接写 stub 节点字段无效，必须通过 PrefabInstance.propertyOverrides。
 *
 * @param {object}   prefabData      parsePrefab 的返回值
 * @param {number}   stubNodeId      stub 节点的数组下标（__id__）
 * @param {string[]} propertyPath    属性路径，如 ['_lpos'] 或 ['_name']
 * @param {*}        value           要写入的值
 * @returns {void}
 *
 * @throws 如果 stubNodeId 不是有效 stub 节点
 */
function setOverrideProperty(prefabData, stubNodeId, propertyPath, value) {
  const { elements } = prefabData;

  const stubResult = _findStubPrefabInstance(elements, stubNodeId);
  if (!stubResult) {
    throw new Error(
      `setOverrideProperty: index ${stubNodeId} 不是有效的 stub 节点（需要 _prefab → PrefabInfo.instance → PrefabInstance）`
    );
  }

  const { prefabInstance, prefabInfo } = stubResult;
  const stubFileId = prefabInfo.fileId;

  // 嵌套 prefab 内根节点 fileId 是 Cocos 运行时 targetMap 的正确 key（见地雷 3）。
  // 解析失败抛错（不再 fallback），调用方需保证嵌套 prefab 可用。
  const targetLocalId = _getStubInnerRootFileId(prefabData, prefabInfo);

  // 查找是否已有对应 override
  // 自动矫正：当 stubFileId !== targetLocalId 时，识别旧版 cli 写入的 stubFileId 条目，
  // 命中后把 localID 改写为真值（一次性迁移历史脏数据）。
  const legacyLocalId = stubFileId !== targetLocalId ? stubFileId : null;
  const existing = _findExistingOverride(elements, prefabInstance, targetLocalId, propertyPath, legacyLocalId);

  if (existing) {
    existing.info.value = value;
    if (legacyLocalId && existing.targetInfo && Array.isArray(existing.targetInfo.localID)) {
      if (existing.targetInfo.localID[0] === legacyLocalId) {
        existing.targetInfo.localID[0] = targetLocalId;
      }
    }
    return;
  }

  // 新建 TargetInfo
  const targetInfo = {
    __type__: 'cc.TargetInfo',
    localID: [targetLocalId],
  };
  const targetInfoId = elements.length;
  elements.push(targetInfo);

  // 新建 CCPropertyOverrideInfo
  const overrideInfo = {
    __type__: 'CCPropertyOverrideInfo',
    targetInfo: { __id__: targetInfoId },
    propertyPath: [...propertyPath],
    value,
  };
  const overrideInfoId = elements.length;
  elements.push(overrideInfo);

  // 追加到 PrefabInstance.propertyOverrides
  if (!Array.isArray(prefabInstance.propertyOverrides)) {
    prefabInstance.propertyOverrides = [];
  }
  prefabInstance.propertyOverrides.push({ __id__: overrideInfoId });
}

/**
 * 列出 stub 节点的所有 propertyOverrides
 *
 * @param {object} prefabData   parsePrefab 的返回值
 * @param {number} stubNodeId   stub 节点的数组下标
 * @returns {Array<{ propertyPath: string[], value: *, targetFileId: string }>}
 */
function listOverrides(prefabData, stubNodeId) {
  const { elements } = prefabData;

  const stubResult = _findStubPrefabInstance(elements, stubNodeId);
  if (!stubResult) {
    throw new Error(
      `listOverrides: index ${stubNodeId} 不是有效的 stub 节点`
    );
  }

  const { prefabInstance, prefabInfo } = stubResult;
  // stub-node-field override 的 localID 是嵌套 prefab 内根节点 fileId（见地雷 3）。
  const targetLocalId = _getStubInnerRootFileId(prefabData, prefabInfo);
  const result = [];

  if (!Array.isArray(prefabInstance.propertyOverrides)) return result;

  for (const overrideRef of prefabInstance.propertyOverrides) {
    if (typeof overrideRef.__id__ !== 'number') continue;
    const info = elements[overrideRef.__id__];
    if (!info || info.__type__ !== 'CCPropertyOverrideInfo') continue;

    const targetInfoRef = info.targetInfo;
    if (!targetInfoRef || typeof targetInfoRef.__id__ !== 'number') continue;
    const targetInfo = elements[targetInfoRef.__id__];
    if (!targetInfo || targetInfo.__type__ !== 'cc.TargetInfo') continue;
    if (!Array.isArray(targetInfo.localID) || targetInfo.localID[0] !== targetLocalId) continue;

    result.push({
      propertyPath: [...(info.propertyPath || [])],
      value: info.value,
      targetFileId: targetInfo.localID[0],
    });
  }

  return result;
}

/**
 * 同步 nestedPrefabInstanceRoots（地雷 2）
 *
 * 宿主 prefab 的根节点 PrefabInfo.nestedPrefabInstanceRoots 必须包含所有嵌套 stub 节点。
 * 调用此函数后会从 elements 中自动扫描所有 cc.PrefabInstance，
 * 找到对应的 stub 节点 __id__，并更新根节点 PrefabInfo 的 nestedPrefabInstanceRoots。
 *
 * 通常在新增 stub 节点后调用一次即可。
 *
 * @param {object} prefabData   parsePrefab 的返回值
 */
function syncNestedPrefabInstanceRoots(prefabData) {
  const { elements, rootId } = prefabData;

  // 找根节点 PrefabInfo（root 指向自己的那个）
  const rootNode = elements[rootId];
  if (!rootNode) throw new Error('syncNestedPrefabInstanceRoots: 根节点不存在');

  const rootPrefabRef = rootNode._prefab;
  if (!rootPrefabRef || typeof rootPrefabRef.__id__ !== 'number') {
    throw new Error('syncNestedPrefabInstanceRoots: 根节点没有 _prefab 引用');
  }

  const rootPrefabInfo = elements[rootPrefabRef.__id__];
  if (!rootPrefabInfo || rootPrefabInfo.__type__ !== 'cc.PrefabInfo') {
    throw new Error('syncNestedPrefabInstanceRoots: 根节点 _prefab 不是 cc.PrefabInfo');
  }

  // 收集所有 stub 节点 __id__（有 PrefabInstance 的 cc.Node）
  const stubIds = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || el.__type__ !== 'cc.Node') continue;
    if (!el._prefab || typeof el._prefab.__id__ !== 'number') continue;
    const pi = elements[el._prefab.__id__];
    if (!pi || pi.__type__ !== 'cc.PrefabInfo') continue;
    if (!pi.instance || typeof pi.instance.__id__ !== 'number') continue;
    const inst = elements[pi.instance.__id__];
    if (!inst || inst.__type__ !== 'cc.PrefabInstance') continue;
    // 这是一个 stub 节点
    stubIds.push(i);
  }

  rootPrefabInfo.nestedPrefabInstanceRoots = stubIds.length > 0
    ? stubIds.map((id) => ({ __id__: id }))
    : null;
}

module.exports = {
  setOverrideProperty,
  listOverrides,
  syncNestedPrefabInstanceRoots,
};
