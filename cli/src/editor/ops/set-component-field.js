// set-component-field: 普通节点改任意组件字段
// op: { op:'set-component-field', node, componentType, property, value }
//
// set-nested-component-field 只覆盖 stub 节点；本 op 是普通节点版本。
//
// - node: 普通节点选择器（不能是 stub）
// - property: 字段名，可以是字符串（顶层字段）或字符串数组（嵌套路径）
//             例：'_string' / ['_color', 'r'] / ['_anchorPoint', 'x']
// - value: 任意 JSON-serializable 值；改 cc.Vec2 / cc.Vec3 / cc.Size 时需带 __type__

'use strict';

const { normalizeComponentType, isStub, resolveNode, findComponent } = require('../helpers.js');

function execSetComponentField(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector, componentType: rawComponentType, property, value } = op;

  if (typeof rawComponentType !== 'string' || rawComponentType.length === 0) {
    throw new Error(`editPrefab [set-component-field]: componentType 必须是非空字符串`);
  }
  const componentType = normalizeComponentType(rawComponentType, prefabData.resolverStartPath);
  if (
    !(typeof property === 'string' && property.length > 0) &&
    !(Array.isArray(property) && property.length > 0 && property.every((p) => typeof p === 'string' && p.length > 0))
  ) {
    throw new Error(`editPrefab [set-component-field]: property 必须是非空字符串或非空字符串数组`);
  }
  if (value === undefined) {
    throw new Error(`editPrefab [set-component-field]: value 不能是 undefined`);
  }

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'set-component-field');
  if (isStub(elements, node)) {
    throw new Error(
      `editPrefab [set-component-field]: 节点 "${node._name}" 是 stub 代理，请用 set-nested-component-field`
    );
  }

  const comp = findComponent(elements, node, componentType);
  if (!comp) {
    throw new Error(
      `editPrefab [set-component-field]: 节点 "${node._name}" 上找不到 ${componentType} 组件`
    );
  }

  // 单层 property
  if (typeof property === 'string') {
    comp[property] = value;
    return nodeId;
  }

  // 嵌套 property 路径：逐层下钻，路径中断时报错（不自动建中间对象，避免悄悄改坏结构）
  let cursor = comp;
  for (let i = 0; i < property.length - 1; i++) {
    const k = property[i];
    if (cursor[k] === null || cursor[k] === undefined || typeof cursor[k] !== 'object') {
      throw new Error(
        `editPrefab [set-component-field]: 路径 ${property.slice(0, i + 1).join('.')} 不是对象（实际值 ${JSON.stringify(cursor[k])}），无法继续下钻`
      );
    }
    cursor = cursor[k];
  }
  cursor[property[property.length - 1]] = value;
  return nodeId;
}

module.exports = { execSetComponentField };
