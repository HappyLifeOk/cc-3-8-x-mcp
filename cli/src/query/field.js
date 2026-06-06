// query/field.js — 单组件单字段值（脚本管道用）

'use strict';

function queryField(prefabData, args) {
  const { elements } = prefabData;
  const { name, componentType, field } = args;
  if (!name) throw new Error('queryPrefab: selector.type="field" 必须提供 name');
  if (!componentType) throw new Error('queryPrefab: selector.type="field" 必须提供 componentType');
  if (!field) throw new Error('queryPrefab: selector.type="field" 必须提供 field');

  const node = prefabData.findNodeByName(name);
  if (!node) throw new Error(`queryPrefab[field]: 找不到节点 "${name}"`);

  if (!Array.isArray(node._components)) {
    throw new Error(`queryPrefab[field]: 节点 "${name}" 没有组件`);
  }
  for (const ref of node._components) {
    if (typeof ref.__id__ !== 'number') continue;
    const comp = elements[ref.__id__];
    if (!comp || comp.__type__ !== componentType) continue;
    if (!(field in comp)) {
      throw new Error(
        `queryPrefab[field]: 节点 "${name}" 的 ${componentType} 没有字段 "${field}"`
      );
    }
    return comp[field];
  }
  throw new Error(`queryPrefab[field]: 节点 "${name}" 没有 ${componentType} 组件`);
}

module.exports = { queryField };
