// set-sprite: 批量设置节点上 cc.Sprite 的常用字段（不含 spriteFrame，用 set-sprite-frame）
// op: {
//   op: 'set-sprite',
//   node,
//   sizeMode?:  0=CUSTOM 1=TRIMMED 2=RAW
//   type?:      0=SIMPLE 1=SLICED 2=TILED 3=FILLED 4=MESH
//   grayscale?: boolean（_useGrayscale）
//   trim?:      boolean（_isTrimmedMode）
// }

'use strict';

const { isStub, resolveNode, findComponent } = require('../helpers.js');

const FIELD_MAP = {
  sizeMode:  '_sizeMode',
  type:      '_type',
  grayscale: '_useGrayscale',
  trim:      '_isTrimmedMode',
};

function execSetSprite(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector } = op;

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'set-sprite');
  if (isStub(elements, node)) {
    throw new Error(`editPrefab [set-sprite]: 节点是 stub，请用 set-nested-component-field`);
  }

  const comp = findComponent(elements, node, 'cc.Sprite');
  if (!comp) {
    throw new Error(`editPrefab [set-sprite]: 节点 "${node._name}" 上找不到 cc.Sprite 组件`);
  }

  let applied = 0;
  for (const [key, field] of Object.entries(FIELD_MAP)) {
    if (key in op) {
      comp[field] = op[key];
      applied++;
    }
  }
  if (applied === 0) {
    throw new Error(
      `editPrefab [set-sprite]: 至少需要提供一个字段（${Object.keys(FIELD_MAP).join('/')}）。更换图片用 set-sprite-frame`
    );
  }

  return nodeId;
}

module.exports = { execSetSprite };
