// set-layout: 批量设置节点上 cc.Layout 的常用字段
// op: {
//   op: 'set-layout',
//   node,
//   type?:            0=NONE 1=HORIZONTAL 2=VERTICAL 3=GRID
//   resizeMode?:      0=NONE 1=CHILDREN 2=CONTAINER
//   paddingLeft?:     number
//   paddingRight?:    number
//   paddingTop?:      number
//   paddingBottom?:   number
//   spacingX?:        number
//   spacingY?:        number
//   startAxis?:       0=HORIZONTAL 1=VERTICAL（GRID 模式）
//   constraint?:      0=NONE 1=FIXED_ROW 2=FIXED_COL（GRID 模式）
//   constraintNum?:   number（constraint 对应的行数/列数）
//   affectedByScale?: boolean
// }

'use strict';

const { isStub, resolveNode, findComponent } = require('../helpers.js');

const FIELD_MAP = {
  type:            '_layoutType',
  resizeMode:      '_resizeMode',
  paddingLeft:     '_paddingLeft',
  paddingRight:    '_paddingRight',
  paddingTop:      '_paddingTop',
  paddingBottom:   '_paddingBottom',
  spacingX:        '_spacingX',
  spacingY:        '_spacingY',
  startAxis:       '_startAxis',
  constraint:      '_constraint',
  constraintNum:   '_constraintNum',
  affectedByScale: '_affectedByScale',
};

function execSetLayout(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector } = op;

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'set-layout');
  if (isStub(elements, node)) {
    throw new Error(`editPrefab [set-layout]: 节点是 stub，请用 set-nested-component-field`);
  }

  const comp = findComponent(elements, node, 'cc.Layout');
  if (!comp) {
    throw new Error(`editPrefab [set-layout]: 节点 "${node._name}" 上找不到 cc.Layout 组件`);
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
      `editPrefab [set-layout]: 至少需要提供一个字段（${Object.keys(FIELD_MAP).join('/')}）`
    );
  }

  return nodeId;
}

module.exports = { execSetLayout };
