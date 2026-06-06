// set-sprite-frame: 设置节点上 cc.Sprite 的 _spriteFrame uuid
// op: { op, node, uuid, spriteNode? }

'use strict';

const { isStub, resolveNode, findComponent } = require('../helpers.js');
const { getNestedCompFileId, setStubCompOverride } = require('../nested.js');

function execSetSpriteFrame(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector, uuid, spriteNode = null } = op;

  if (typeof uuid !== 'string') {
    throw new Error(`editPrefab [set-sprite-frame]: uuid 必须是字符串`);
  }

  const { node, nodeId: id } = resolveNode(prefabData, nodeSelector, 'set-sprite-frame');
  const newFrame = { __uuid__: uuid, __expectedType__: 'cc.SpriteFrame' };

  if (isStub(elements, node)) {
    const compFileId = getNestedCompFileId(
      prefabData.resolverStartPath, elements, id, 'cc.Sprite', spriteNode
    );
    setStubCompOverride(prefabData, id, compFileId, ['_spriteFrame'], newFrame);
  } else {
    const comp = findComponent(elements, node, 'cc.Sprite');
    if (!comp) {
      throw new Error(`editPrefab [set-sprite-frame]: 节点 "${JSON.stringify(nodeSelector)}" 没有 cc.Sprite 组件`);
    }
    comp._spriteFrame = newFrame;
  }

  return id;
}

module.exports = { execSetSpriteFrame };
