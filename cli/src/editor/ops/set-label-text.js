// set-label-text: 设置节点上 cc.Label 的 _string
// op: { op, node, text, labelNode? }
//
// 普通节点：直接修改 cc.Label._string
// stub 节点：从嵌套 prefab 中找 cc.Label 的 CompPrefabInfo.fileId，
//            写入 PrefabInstance.propertyOverrides

'use strict';

const { isStub, resolveNode, findComponent } = require('../helpers.js');
const { getNestedCompFileId, setStubCompOverride } = require('../nested.js');

function execSetLabelText(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector, text, labelNode = null } = op;

  if (typeof text !== 'string') {
    throw new Error(`editPrefab [set-label-text]: text 必须是字符串`);
  }

  const { node, nodeId: id } = resolveNode(prefabData, nodeSelector, 'set-label-text');

  if (isStub(elements, node)) {
    const compFileId = getNestedCompFileId(
      prefabData.resolverStartPath, elements, id, 'cc.Label', labelNode
    );
    setStubCompOverride(prefabData, id, compFileId, ['_string'], text);
  } else {
    const comp = findComponent(elements, node, 'cc.Label');
    if (!comp) {
      throw new Error(`editPrefab [set-label-text]: 节点 "${JSON.stringify(nodeSelector)}" 没有 cc.Label 组件`);
    }
    comp._string = text;
  }

  return id;
}

module.exports = { execSetLabelText };
