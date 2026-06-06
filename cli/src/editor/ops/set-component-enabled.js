// set-component-enabled: 改组件 _enabled
// op: { op:'set-component-enabled', node, componentType, enabled }
//
// 普通节点直接改 comp._enabled
// stub 节点：写 PrefabInstance.propertyOverrides（与 set-nested-component-field 同模式）

'use strict';

const { normalizeComponentType, isStub, resolveNode, findComponent } = require('../helpers.js');
const { getNestedCompFileId, setStubCompOverride } = require('../nested.js');

function execSetComponentEnabled(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector, componentType: rawCompType, enabled, subNode = null } = op;

  if (typeof rawCompType !== 'string' || rawCompType.length === 0) {
    throw new Error(`editPrefab [set-component-enabled]: componentType 必须是非空字符串`);
  }
  if (typeof enabled !== 'boolean') {
    throw new Error(`editPrefab [set-component-enabled]: enabled 必须是布尔值`);
  }

  const componentType = normalizeComponentType(rawCompType, prefabData.resolverStartPath);
  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'set-component-enabled');

  if (isStub(elements, node)) {
    const compFileId = getNestedCompFileId(
      prefabData.resolverStartPath, elements, nodeId, componentType, subNode
    );
    setStubCompOverride(prefabData, nodeId, compFileId, ['_enabled'], enabled);
  } else {
    const comp = findComponent(elements, node, componentType);
    if (!comp) {
      throw new Error(
        `editPrefab [set-component-enabled]: 节点 "${node._name}" 上找不到 ${componentType} 组件`
      );
    }
    comp._enabled = enabled;
  }

  return nodeId;
}

module.exports = { execSetComponentEnabled };
