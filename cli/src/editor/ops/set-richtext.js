// set-richtext: 批量设置节点上 cc.RichText 的常用字段
// op: {
//   op: 'set-richtext',
//   node,
//   text?:       string（_string，支持 BBCode 标签）
//   maxWidth?:   number（0 = 不限制）
//   fontSize?:   number
//   lineHeight?: number
// }

'use strict';

const { isStub, resolveNode, findComponent } = require('../helpers.js');

const FIELD_MAP = {
  text:       '_string',
  maxWidth:   '_maxWidth',
  fontSize:   '_fontSize',
  lineHeight: '_lineHeight',
};

function execSetRichText(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector } = op;

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'set-richtext');
  if (isStub(elements, node)) {
    throw new Error(`editPrefab [set-richtext]: 节点是 stub，请用 set-nested-component-field`);
  }

  const comp = findComponent(elements, node, 'cc.RichText');
  if (!comp) {
    throw new Error(`editPrefab [set-richtext]: 节点 "${node._name}" 上找不到 cc.RichText 组件`);
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
      `editPrefab [set-richtext]: 至少需要提供一个字段（${Object.keys(FIELD_MAP).join('/')}）`
    );
  }

  return nodeId;
}

module.exports = { execSetRichText };
