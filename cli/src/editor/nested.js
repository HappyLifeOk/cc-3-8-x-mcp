// ============================================================
// editor/nested.js — stub 节点（嵌套 prefab）相关协议
//
// 涵盖：
//   - 从嵌套 prefab 反查 CompPrefabInfo.fileId / Node PrefabInfo.fileId
//   - 在 stub 节点的 PrefabInstance.propertyOverrides 写入字段 override
//   - cc.TargetOverrideInfo 跨 nested @property 挂载
// 协议背景见 prefab-schema.md §4 与 set-component-ref op 上方注释。
// ============================================================

'use strict';

const { parsePrefab } = require('../parse.js');
const { resolveUuidToPath } = require('../uuid-resolver.js');
const { findRootPrefabInfo } = require('./helpers.js');

// ─── 嵌套 prefab：找指定组件的 CompPrefabInfo.fileId ─────────

/**
 * @param {string}      hostPrefabPath  宿主 prefab 文件路径（用于 UuidResolver 推断项目根）
 * @param {object[]}    elements        宿主 prefab elements 数组
 * @param {number}      stubNodeId      stub 节点的 __id__
 * @param {string}      compType        组件类型，如 'cc.Label' / 'cc.Sprite'
 * @param {string|null} nodeName        可选：指定嵌套 prefab 内的节点名（null = 第一个匹配）
 * @returns {string}  CompPrefabInfo.fileId
 */
function getNestedCompFileId(hostPrefabPath, elements, stubNodeId, compType, nodeName) {
  const stubNode = elements[stubNodeId];
  if (!stubNode || stubNode.__type__ !== 'cc.Node') {
    throw new Error(`getNestedCompFileId: ${stubNodeId} 不是有效 cc.Node`);
  }

  const prefabRef = stubNode._prefab;
  if (!prefabRef || typeof prefabRef.__id__ !== 'number') {
    throw new Error(`getNestedCompFileId: stub 节点 ${stubNodeId} 没有 _prefab 引用`);
  }
  const prefabInfo = elements[prefabRef.__id__];
  if (!prefabInfo || prefabInfo.__type__ !== 'cc.PrefabInfo') {
    throw new Error(`getNestedCompFileId: stub 节点 ${stubNodeId} 的 _prefab 不是 cc.PrefabInfo`);
  }
  const assetRef = prefabInfo.asset;
  if (!assetRef || typeof assetRef.__uuid__ !== 'string') {
    throw new Error(
      `getNestedCompFileId: stub 节点 ${stubNodeId} 的 PrefabInfo.asset 不是 UUID 引用`
    );
  }
  const nestedUuid = assetRef.__uuid__;
  const nestedPath = resolveUuidToPath(nestedUuid, hostPrefabPath);

  let nestedData;
  try {
    nestedData = parsePrefab(nestedPath);
  } catch (e) {
    throw new Error(
      `getNestedCompFileId: 加载嵌套 prefab 失败（uuid=${nestedUuid}, path=${nestedPath}）: ${e.message}`
    );
  }

  const nEls = nestedData.elements;
  for (let i = 0; i < nEls.length; i++) {
    const el = nEls[i];
    if (!el || el.__type__ !== compType) continue;

    if (nodeName !== null && nodeName !== undefined) {
      if (!el.node || typeof el.node.__id__ !== 'number') continue;
      const ownerNode = nEls[el.node.__id__];
      if (!ownerNode || ownerNode._name !== nodeName) continue;
    }

    if (!el.__prefab || typeof el.__prefab.__id__ !== 'number') continue;
    const cpi = nEls[el.__prefab.__id__];
    if (!cpi || cpi.__type__ !== 'cc.CompPrefabInfo') continue;
    if (typeof cpi.fileId !== 'string' || cpi.fileId.length === 0) continue;

    return cpi.fileId;
  }

  const nodeHint = nodeName ? `（节点名: "${nodeName}"）` : '';
  throw new Error(
    `getNestedCompFileId: 在嵌套 prefab "${nestedPath}" 中找不到 ${compType} 组件${nodeHint}，` +
    `或该组件没有 cc.CompPrefabInfo.fileId。`
  );
}

// ─── 嵌套 prefab：找目标节点的 PrefabInfo.fileId ──────────────

/**
 * @param {string}      hostPrefabPath  宿主 prefab 路径
 * @param {object[]}    elements        宿主 prefab elements
 * @param {number}      stubNodeId      stub 节点 __id__
 * @param {string|null} nodeName        目标节点名（null = 嵌套 prefab 根节点）
 * @returns {string}    目标节点 cc.PrefabInfo.fileId
 */
function getNestedNodeFileId(hostPrefabPath, elements, stubNodeId, nodeName) {
  const stubNode = elements[stubNodeId];
  if (!stubNode || stubNode.__type__ !== 'cc.Node') {
    throw new Error(`getNestedNodeFileId: ${stubNodeId} 不是有效 cc.Node`);
  }

  const prefabRef = stubNode._prefab;
  if (!prefabRef || typeof prefabRef.__id__ !== 'number') {
    throw new Error(`getNestedNodeFileId: stub 节点 ${stubNodeId} 没有 _prefab 引用`);
  }
  const prefabInfo = elements[prefabRef.__id__];
  if (!prefabInfo || prefabInfo.__type__ !== 'cc.PrefabInfo') {
    throw new Error(`getNestedNodeFileId: stub 节点 ${stubNodeId} 的 _prefab 不是 cc.PrefabInfo`);
  }
  const assetRef = prefabInfo.asset;
  if (!assetRef || typeof assetRef.__uuid__ !== 'string') {
    throw new Error(
      `getNestedNodeFileId: stub 节点 ${stubNodeId} 的 PrefabInfo.asset 不是 UUID 引用`
    );
  }
  const nestedUuid = assetRef.__uuid__;
  const nestedPath = resolveUuidToPath(nestedUuid, hostPrefabPath);

  let nestedData;
  try {
    nestedData = parsePrefab(nestedPath);
  } catch (e) {
    throw new Error(
      `getNestedNodeFileId: 加载嵌套 prefab 失败（uuid=${nestedUuid}, path=${nestedPath}）: ${e.message}`
    );
  }

  const nEls = nestedData.elements;
  for (let i = 0; i < nEls.length; i++) {
    const el = nEls[i];
    if (!el || el.__type__ !== 'cc.Node') continue;
    if (!el._prefab || typeof el._prefab.__id__ !== 'number') continue;
    const pi = nEls[el._prefab.__id__];
    if (!pi || pi.__type__ !== 'cc.PrefabInfo') continue;
    if (typeof pi.fileId !== 'string' || pi.fileId.length === 0) continue;

    if (nodeName === null || nodeName === undefined) {
      // 根节点：_parent 为 null
      if (el._parent === null || el._parent === undefined) {
        return pi.fileId;
      }
    } else {
      if (el._name === nodeName) {
        return pi.fileId;
      }
    }
  }

  const nodeHint = nodeName ? `（节点名: "${nodeName}"）` : '（根节点）';
  throw new Error(
    `getNestedNodeFileId: 在嵌套 prefab "${nestedPath}" 中找不到目标节点${nodeHint}，` +
    `或该节点没有 cc.PrefabInfo.fileId。`
  );
}

// ─── 在 stub 节点的 PrefabInstance.propertyOverrides 写入字段 ─

/**
 * 在 stub 节点的 PrefabInstance.propertyOverrides 中写入一条组件属性 override。
 * TargetInfo.localID 使用 compFileId（嵌套 prefab 内该组件的 CompPrefabInfo.fileId）。
 *
 * @param {object}   prefabData    parsePrefab 返回值
 * @param {number}   stubNodeId    stub 节点 __id__
 * @param {string}   compFileId    嵌套 prefab 内目标组件的 CompPrefabInfo.fileId
 * @param {string[]} propertyPath  属性路径，如 ['_string']
 * @param {*}        value         要写入的值
 */
function setStubCompOverride(prefabData, stubNodeId, compFileId, propertyPath, value) {
  const { elements } = prefabData;

  const stubNode = elements[stubNodeId];
  const prefabInfo = elements[stubNode._prefab.__id__];
  const prefabInstance = elements[prefabInfo.instance.__id__];

  if (!prefabInstance || prefabInstance.__type__ !== 'cc.PrefabInstance') {
    throw new Error(`setStubCompOverride: stub ${stubNodeId} 没有有效 PrefabInstance`);
  }

  if (Array.isArray(prefabInstance.propertyOverrides)) {
    for (const overrideRef of prefabInstance.propertyOverrides) {
      if (typeof overrideRef.__id__ !== 'number') continue;
      const info = elements[overrideRef.__id__];
      if (!info || info.__type__ !== 'CCPropertyOverrideInfo') continue;

      const tiRef = info.targetInfo;
      if (!tiRef || typeof tiRef.__id__ !== 'number') continue;
      const ti = elements[tiRef.__id__];
      if (!ti || ti.__type__ !== 'cc.TargetInfo') continue;
      if (!Array.isArray(ti.localID) || ti.localID[0] !== compFileId) continue;

      if (
        Array.isArray(info.propertyPath) &&
        info.propertyPath.length === propertyPath.length &&
        info.propertyPath.every((p, i) => p === propertyPath[i])
      ) {
        info.value = value;
        return;
      }
    }
  }

  const targetInfo = {
    __type__: 'cc.TargetInfo',
    localID: [compFileId],
  };
  const targetInfoId = elements.length;
  elements.push(targetInfo);

  const overrideInfo = {
    __type__: 'CCPropertyOverrideInfo',
    targetInfo: { __id__: targetInfoId },
    propertyPath: [...propertyPath],
    value,
  };
  const overrideInfoId = elements.length;
  elements.push(overrideInfo);

  if (!Array.isArray(prefabInstance.propertyOverrides)) {
    prefabInstance.propertyOverrides = [];
  }
  prefabInstance.propertyOverrides.push({ __id__: overrideInfoId });
}

// ─── 跨 nested @property 挂载（cc.TargetOverrideInfo）─────────
//
// 背景：主 prefab 里 BottomView.prefab 的某个脚本组件（如 BottomView）有
// @property _btnStore: cc.Button，btnStore 节点在主 prefab 里是 stub 代理
// （PrefabInstance），真正的 cc.Button 组件在子 prefab StoreBtn.prefab 里。
// 正确协议：在主 prefab root PrefabInfo.targetOverrides 里写一条
// cc.TargetOverrideInfo，target 指向 stub 节点，targetInfo.localID 是子
// prefab 里目标组件的 __prefab.fileId。
//
// localID 为数组支持多层 nested：每过一层 PrefabInstance 边界新开子 map，
// 每个元素是该层某节点/组件的 fileId。当前 cli 实现只支持 1 层；多层场景由
// 上游 tools/step-3-script/bind-prefab-components 兜底。

/**
 * 在子 prefab 里按 compType + subNode 找目标组件 / 节点 fileId，
 * 返回 localID 数组。支持多层嵌套：
 *
 *   subNode = null | string         → 单层（在子 prefab 根上找 compType）
 *   subNode = ['name1', 'name2']    → 多层（每段是嵌套 stub 节点名，
 *                                     最后一段 + compType 决定终点）
 *
 * 多层链：path=['A','B'], compType='cc.Label'
 *   = 主 prefab stub → A.prefab 内的 stub 'A' → B.prefab 内的 cc.Label
 *   返回 [stub-A 在 A.prefab 内的 fileId, B.prefab 内 cc.Label 的 fileId]
 *   注意每跨一层 PrefabInstance 边界，链 push 一个 fileId。
 */
function resolveLocalIdChain(hostPrefabPath, elements, stubNodeId, compType, subNode) {
  // 单层：subNode 为 null 或字符串
  if (subNode === null || subNode === undefined || typeof subNode === 'string') {
    if (compType === 'cc.Node') {
      const nodeFileId = getNestedNodeFileId(hostPrefabPath, elements, stubNodeId, subNode);
      return [nodeFileId];
    }
    const compFileId = getNestedCompFileId(hostPrefabPath, elements, stubNodeId, compType, subNode);
    return [compFileId];
  }

  // 多层：subNode 是字符串数组（路径）
  if (!Array.isArray(subNode) || !subNode.every((s) => typeof s === 'string' && s.length > 0)) {
    throw new Error(`resolveLocalIdChain: subNode 必须是 null / 字符串 / 字符串数组，收到 ${JSON.stringify(subNode)}`);
  }
  if (subNode.length === 0) {
    return resolveLocalIdChain(hostPrefabPath, elements, stubNodeId, compType, null);
  }
  if (subNode.length === 1) {
    return resolveLocalIdChain(hostPrefabPath, elements, stubNodeId, compType, subNode[0]);
  }

  // 多层：从当前 stub 进入第一层嵌套，找名字 = subNode[0] 的内嵌 stub，
  // 拿到它在嵌套 prefab 内的 fileId，递归走剩下的路径
  const [firstSeg, ...restPath] = subNode;
  const { nestedPath, nestedData } = _loadNestedPrefab(hostPrefabPath, elements, stubNodeId);
  const nEls = nestedData.elements;

  let innerStubId = -1;
  let innerStubFileId = null;
  for (let i = 0; i < nEls.length; i++) {
    const el = nEls[i];
    if (!el || el.__type__ !== 'cc.Node') continue;
    if (el._name !== firstSeg) continue;
    if (!el._prefab || typeof el._prefab.__id__ !== 'number') continue;
    const innerPi = nEls[el._prefab.__id__];
    if (!innerPi || innerPi.__type__ !== 'cc.PrefabInfo') continue;
    if (!innerPi.instance) continue; // 不是 stub
    if (typeof innerPi.fileId !== 'string' || innerPi.fileId.length === 0) continue;
    innerStubId = i;
    innerStubFileId = innerPi.fileId;
    break;
  }
  if (innerStubId < 0) {
    throw new Error(
      `resolveLocalIdChain: 嵌套 prefab "${nestedPath}" 中找不到名为 "${firstSeg}" 的 stub 节点`
    );
  }

  // 递归到下一层（用嵌套 prefab 自身作为 hostPrefabPath）
  const innerChain = resolveLocalIdChain(nestedPath, nEls, innerStubId, compType, restPath);
  return [innerStubFileId, ...innerChain];
}

/** 加载 stub 指向的嵌套 prefab，返回路径 + parsed data */
function _loadNestedPrefab(hostPrefabPath, elements, stubNodeId) {
  const stubNode = elements[stubNodeId];
  if (!stubNode || stubNode.__type__ !== 'cc.Node') {
    throw new Error(`_loadNestedPrefab: ${stubNodeId} 不是有效 cc.Node`);
  }
  const prefabRef = stubNode._prefab;
  if (!prefabRef || typeof prefabRef.__id__ !== 'number') {
    throw new Error(`_loadNestedPrefab: stub 节点 ${stubNodeId} 没有 _prefab 引用`);
  }
  const prefabInfo = elements[prefabRef.__id__];
  if (!prefabInfo || prefabInfo.__type__ !== 'cc.PrefabInfo') {
    throw new Error(`_loadNestedPrefab: stub 节点 ${stubNodeId} 的 _prefab 不是 cc.PrefabInfo`);
  }
  const assetRef = prefabInfo.asset;
  if (!assetRef || typeof assetRef.__uuid__ !== 'string') {
    throw new Error(`_loadNestedPrefab: stub ${stubNodeId} 的 PrefabInfo.asset 不是 UUID 引用`);
  }
  const nestedPath = resolveUuidToPath(assetRef.__uuid__, hostPrefabPath);
  const nestedData = parsePrefab(nestedPath);
  return { nestedPath, nestedData };
}

// ─── propertyPath 数组索引 normalize ─────────────────────────────────────────
//
// Cocos 编辑器加载 prefab 时按 JSON 类型区分属性名（string）与数组索引（number）。
// 若数组索引以 string 形式写入（如 "0" 代替 0），编辑器无法匹配对应数组槽，
// TargetOverrideInfo 静默失效（inspector 显示空）。
//
// 使用方法：
//   addRootTargetOverride 在写入前调用 normalizePropertyPath，
//   保证任何经由字符串解析（"_items.0"、"_items[0]"）或直接传入的数字 string
//   都被转换为 number 类型的数组索引。
//
// 例：["_items", "0"] → ["_items", 0]
//     ["_items",  0 ] → ["_items", 0]  （已是 number，不变）
//     ["_role"      ] → ["_role"    ]  （无下标，不变）

function normalizePropertyPath(path) {
  return path.map(function(seg) {
    if (typeof seg === 'string' && /^\d+$/.test(seg)) {
      return parseInt(seg, 10);
    }
    return seg;
  });
}

/**
 * 给主 prefab root PrefabInfo.targetOverrides 追加一条 cc.TargetOverrideInfo
 * + cc.TargetInfo，实现跨 stub @property 挂载。
 *
 * @param {(string|number)[]} propertyPath  属性路径数组，普通字段如 ["_role"]，
 *   数组字段元素如 ["_items", 0]（索引用数字而非字符串）。
 *   传入字符串形式的数字索引（如 "0"）会被内部自动转为 number，调用方无需预处理。
 */
function addRootTargetOverride(prefabData, rootId, sourceCompId, propertyPath, targetStubId, localIdChain) {
  const { elements } = prefabData;
  const rootPrefabInfo = findRootPrefabInfo(elements, rootId);
  if (!rootPrefabInfo) {
    throw new Error(`addRootTargetOverride: 找不到主 prefab root PrefabInfo（rootId=${rootId}）`);
  }

  // 确保数组索引为 number 类型（Cocos 编辑器按类型匹配，string "0" ≠ number 0）
  const normalizedPath = normalizePropertyPath(propertyPath);

  // 幂等：已存在同 source/propertyPath/target/localID 的 override 直接返回
  // 注意：dedupe key 使用完整 propertyPath 数组比对，
  // 允许同一字段名但不同索引（如 ["_items",0] vs ["_items",1]）共存。
  const existingRefs = Array.isArray(rootPrefabInfo.targetOverrides) ? rootPrefabInfo.targetOverrides : [];
  for (const r of existingRefs) {
    if (typeof r.__id__ !== 'number') continue;
    const ov = elements[r.__id__];
    if (!ov || ov.__type__ !== 'cc.TargetOverrideInfo') continue;
    if (!ov.source || ov.source.__id__ !== sourceCompId) continue;
    if (!Array.isArray(ov.propertyPath) || ov.propertyPath.length !== normalizedPath.length) continue;
    if (!ov.propertyPath.every((p, i) => p === normalizedPath[i])) continue;
    if (!ov.target || ov.target.__id__ !== targetStubId) continue;
    const tiRef = ov.targetInfo;
    if (!tiRef || typeof tiRef.__id__ !== 'number') continue;
    const ti = elements[tiRef.__id__];
    if (!ti || !Array.isArray(ti.localID)) continue;
    if (ti.localID.length !== localIdChain.length) continue;
    if (ti.localID.every((v, i) => v === localIdChain[i])) return;
  }

  const targetInfoId = elements.length;
  elements.push({
    __type__: 'cc.TargetInfo',
    localID: localIdChain.slice(),
  });
  const overrideId = elements.length;
  elements.push({
    __type__: 'cc.TargetOverrideInfo',
    source: { __id__: sourceCompId },
    sourceInfo: null,
    propertyPath: normalizedPath.slice(),
    target: { __id__: targetStubId },
    targetInfo: { __id__: targetInfoId },
  });
  if (!Array.isArray(rootPrefabInfo.targetOverrides)) {
    rootPrefabInfo.targetOverrides = [];
  }
  // 插入策略：
  //   - 单字段 override（propertyPath.length === 1，如 ["_btnClose"]）：插到所有
  //     数组字段 override 之前。
  //   - 数组字段 override（propertyPath.length > 1，如 ["_items", 0]）：追加到末尾。
  //
  // 为什么：Cocos 加载 prefab 时，若 rootTargetOverrides 数组里前面有数组字段
  // override，后面位置的单字段 override 会被静默跳过（实测 cocos 3.8.x 行为，
  // 见 forest/extensions/cc-3-8-x-mcp/doc/cli.md 坑 14）。单字段插前面规避此 bug。
  const newRef = { __id__: overrideId };
  const isSingleField = normalizedPath.length === 1;
  if (isSingleField) {
    const arr = rootPrefabInfo.targetOverrides;
    let firstArrayIdx = arr.length;
    for (let i = 0; i < arr.length; i++) {
      const r = arr[i];
      if (!r || typeof r.__id__ !== 'number') continue;
      const ov = elements[r.__id__];
      if (!ov || ov.__type__ !== 'cc.TargetOverrideInfo') continue;
      if (Array.isArray(ov.propertyPath) && ov.propertyPath.length > 1) {
        firstArrayIdx = i;
        break;
      }
    }
    arr.splice(firstArrayIdx, 0, newRef);
  } else {
    rootPrefabInfo.targetOverrides.push(newRef);
  }
}

module.exports = {
  getNestedCompFileId,
  getNestedNodeFileId,
  setStubCompOverride,
  resolveLocalIdChain,
  addRootTargetOverride,
  normalizePropertyPath,
};
