// reset-overrides: 清除 stub 节点的 propertyOverrides（回滚到嵌套 prefab 默认值）
// op: { op:'reset-overrides', node, property?, componentType?, subNode?, all? }
//
// 调用形态：
//   1) all=true：清空 stub 的整个 propertyOverrides 数组（一键回滚）
//      不能同时指定 property / componentType
//   2) property（无 componentType）：清匹配 stub 节点字段 override
//      target = stub 自身 fileId，propertyPath = [property]
//      常见字段 _lpos / _name / _active / _lscale 等
//   3) property + componentType：清嵌套内某组件字段 override
//      subNode 用于嵌套 prefab 内同类型组件消歧（同 set-nested-component-field）
//
// 移除的 CCPropertyOverrideInfo / TargetInfo 作为 orphan 留在 elements，
// 保持其他 __id__ 稳定（与 remove-node / remove-component 同策略）。
//
// 幂等：未找到匹配 override 不报错（缺省静默，CC3_MCP_DEBUG=1 时打 warn）。

'use strict';

const { isStub, resolveNode, normalizeComponentType } = require('../helpers.js');
const { getNestedCompFileId, getNestedNodeFileId } = require('../nested.js');

function execResetOverrides(prefabData, op) {
  const { elements } = prefabData;
  const {
    node: nodeSelector,
    property,
    componentType: rawComponentType,
    subNode = null,
    all = false,
  } = op;

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'reset-overrides');
  if (!isStub(elements, node)) {
    throw new Error(
      `editPrefab [reset-overrides]: 节点 "${node._name || nodeId}" 不是 stub，普通节点没有 propertyOverrides`
    );
  }

  const prefabInfo = elements[node._prefab.__id__];
  const prefabInstance = elements[prefabInfo.instance.__id__];
  const stubFileId = prefabInfo.fileId;

  // 模式 1：清空全部
  if (all) {
    if (property !== undefined || rawComponentType !== undefined) {
      throw new Error(
        `editPrefab [reset-overrides]: all=true 时禁止同时提供 property / componentType`
      );
    }
    if (Array.isArray(prefabInstance.propertyOverrides)) {
      prefabInstance.propertyOverrides = [];
    }
    return nodeId;
  }

  // 模式 2/3：按 propertyPath 匹配单条
  if (property === undefined) {
    throw new Error(
      `editPrefab [reset-overrides]: 必须提供 property，或显式 all=true 清空全部`
    );
  }
  if (typeof property !== 'string' && !Array.isArray(property)) {
    throw new Error(`editPrefab [reset-overrides]: property 必须是字符串或数组`);
  }
  const propertyPath = Array.isArray(property) ? property : [property];

  // 决定要匹配的 localID[0]
  // 节点字段 override（无 componentType）：嵌套 prefab 内根节点 fileId 是 Cocos 运行时
  // 实际识别的 key（见 overrides.js 地雷 3）。
  let targetFileId;
  if (rawComponentType) {
    const componentType = normalizeComponentType(rawComponentType, prefabData.resolverStartPath);
    targetFileId = getNestedCompFileId(prefabData.resolverStartPath, elements, nodeId, componentType, subNode);
  } else {
    if (subNode !== null && subNode !== undefined) {
      throw new Error(
        `editPrefab [reset-overrides]: subNode 必须与 componentType 一起用（节点字段 override 无嵌套子节点定位）`
      );
    }
    targetFileId = getNestedNodeFileId(prefabData.resolverStartPath, elements, nodeId, null);
  }

  if (!Array.isArray(prefabInstance.propertyOverrides) || prefabInstance.propertyOverrides.length === 0) {
    return nodeId; // 无 override 数组，幂等返回
  }

  const remaining = [];
  let removed = 0;
  for (const ref of prefabInstance.propertyOverrides) {
    if (!ref || typeof ref.__id__ !== 'number') {
      remaining.push(ref);
      continue;
    }
    const info = elements[ref.__id__];
    if (!info || info.__type__ !== 'CCPropertyOverrideInfo') {
      remaining.push(ref);
      continue;
    }
    const tiRef = info.targetInfo;
    const ti = tiRef && typeof tiRef.__id__ === 'number' ? elements[tiRef.__id__] : null;
    if (!ti || !Array.isArray(ti.localID) || ti.localID[0] !== targetFileId) {
      remaining.push(ref);
      continue;
    }
    if (!Array.isArray(info.propertyPath) || info.propertyPath.length !== propertyPath.length) {
      remaining.push(ref);
      continue;
    }
    if (info.propertyPath.every((p, i) => p === propertyPath[i])) {
      removed++;
      continue;
    }
    remaining.push(ref);
  }

  if (removed === 0 && process.env.CC3_MCP_DEBUG) {
    console.warn(
      `[reset-overrides] stub [${nodeId}]: 未找到匹配 propertyPath=${JSON.stringify(propertyPath)} target=${targetFileId} 的 override（无操作）`
    );
  }

  prefabInstance.propertyOverrides = remaining;
  return nodeId;
}

module.exports = { execResetOverrides };
