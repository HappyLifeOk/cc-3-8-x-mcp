// set-nested-component-field: 改 stub 节点展开后内部某组件的字段
// op: { op, node, componentType, property, value, subNode? }
//
// - node: stub 节点名或 {id}（必须是 stub 代理）
// - componentType: 子 prefab 里目标组件类型（如 'cc.Label'）
// - property: 字段名（如 '_string' / '_spriteFrame' / 'interactable'）；支持嵌套路径数组
// - value: 要写入的值（raw JSON）
// - subNode: 子 prefab 内部节点名（可选，默认 null = 子 prefab root 上第一个匹配组件）

'use strict';

const { normalizeComponentType, isStub, resolveNode } = require('../helpers.js');
const { getNestedCompFileId, setStubCompOverride } = require('../nested.js');

function execSetNestedComponentField(prefabData, op) {
  const { elements } = prefabData;
  const {
    node: nodeSelector,
    componentType: rawComponentType,
    property,
    value,
    subNode = null,
  } = op;

  if (typeof rawComponentType !== 'string' || rawComponentType.length === 0) {
    throw new Error(`editPrefab [set-nested-component-field]: componentType 必须是非空字符串`);
  }
  const componentType = normalizeComponentType(rawComponentType, prefabData.resolverStartPath);
  if (!property || (typeof property !== 'string' && !Array.isArray(property))) {
    throw new Error(`editPrefab [set-nested-component-field]: property 必须是字符串或数组`);
  }
  if (value === undefined) {
    throw new Error(`editPrefab [set-nested-component-field]: value 不能是 undefined`);
  }

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'set-nested-component-field');
  if (!isStub(elements, node)) {
    throw new Error(
      `editPrefab [set-nested-component-field]: 节点 "${node._name}" 不是 stub 代理——` +
      `普通节点直接用 set-label-text/set-sprite-frame 或在代码里改组件字段`
    );
  }

  const compFileId = getNestedCompFileId(
    prefabData.resolverStartPath, elements, nodeId, componentType, subNode
  );
  const propertyPath = Array.isArray(property) ? property : [property];
  setStubCompOverride(prefabData, nodeId, compFileId, propertyPath, value);
  return nodeId;
}

module.exports = { execSetNestedComponentField };
