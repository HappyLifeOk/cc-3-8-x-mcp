// ============================================================
// query/comp-fields.js — 组件字段提取（query 共用工具）
// ============================================================

'use strict';

// 系统级字段（每个 cc 组件都有，对调试无信息量）过滤掉
const RESERVED_COMP_FIELDS = new Set([
  '__type__',
  '_objFlags',
  '__editorExtras__',
  'node',
  '_enabled',
  '__prefab',
  '_id',
]);

/** 提取组件的业务字段（过滤系统字段） */
function extractCompFields(comp) {
  if (!comp || typeof comp !== 'object') return {};
  const fields = {};
  for (const key of Object.keys(comp)) {
    if (RESERVED_COMP_FIELDS.has(key)) continue;
    fields[key] = comp[key];
  }
  return fields;
}

/** 节点 _components 列表 → [{type, id, fields}] */
function componentDetails(elements, node) {
  if (!Array.isArray(node._components)) return [];
  const out = [];
  for (const ref of node._components) {
    if (typeof ref.__id__ !== 'number') continue;
    const comp = elements[ref.__id__];
    if (!comp) continue;
    out.push({
      type: comp.__type__,
      id: ref.__id__,
      fields: extractCompFields(comp),
    });
  }
  return out;
}

/** 节点 _components 列表 → 类型名数组（轻量版，不展开字段） */
function componentTypes(elements, node) {
  if (!Array.isArray(node._components)) return [];
  const types = [];
  for (const ref of node._components) {
    if (typeof ref.__id__ !== 'number') continue;
    const comp = elements[ref.__id__];
    if (comp && comp.__type__) types.push(comp.__type__);
  }
  return types;
}

/** 判断节点是否是 stub（嵌套 prefab 根节点）— query 内部用 */
function isStub(elements, node) {
  if (!node || node.__type__ !== 'cc.Node') return false;
  const prefabRef = node._prefab;
  if (!prefabRef || typeof prefabRef.__id__ !== 'number') return false;
  const prefabInfo = elements[prefabRef.__id__];
  if (!prefabInfo || prefabInfo.__type__ !== 'cc.PrefabInfo') return false;
  const instanceRef = prefabInfo.instance;
  if (!instanceRef || typeof instanceRef.__id__ !== 'number') return false;
  const instance = elements[instanceRef.__id__];
  return !!(instance && instance.__type__ === 'cc.PrefabInstance');
}

module.exports = {
  extractCompFields,
  componentDetails,
  componentTypes,
  isStub,
};
