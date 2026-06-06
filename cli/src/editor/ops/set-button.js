// set-button: 批量设置节点上 cc.Button 的常用字段
// op: {
//   op: 'set-button',
//   node,
//   interactable?: boolean
//   transition?:   0=NONE 1=COLOR 2=SPRITE 3=SCALE
//   zoomScale?:    number（transition=SCALE 时的缩放比例）
//   duration?:     number（过渡动画时长，秒）
// }

'use strict';

const { isStub, resolveNode, findComponent } = require('../helpers.js');

const FIELD_MAP = {
  interactable: '_interactable',
  transition:   '_transition',
  zoomScale:    '_zoomScale',
  duration:     '_duration',
};

function execSetButton(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector } = op;

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'set-button');
  if (isStub(elements, node)) {
    throw new Error(`editPrefab [set-button]: 节点是 stub，请用 set-nested-component-field`);
  }

  const comp = findComponent(elements, node, 'cc.Button');
  if (!comp) {
    throw new Error(`editPrefab [set-button]: 节点 "${node._name}" 上找不到 cc.Button 组件`);
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
      `editPrefab [set-button]: 至少需要提供一个字段（${Object.keys(FIELD_MAP).join('/')}）`
    );
  }

  return nodeId;
}

module.exports = { execSetButton };
