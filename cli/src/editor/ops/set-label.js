// set-label: 批量设置节点上 cc.Label 的常用字段
// op: {
//   op: 'set-label',
//   node,
//   text?:            string（_string）
//   fontSize?:        number
//   lineHeight?:      number（0 = auto）
//   overflow?:        0=NONE 1=CLAMP 2=SHRINK 3=RESIZE_HEIGHT 4=TRUNCATE
//   horizontalAlign?: 0=LEFT 1=CENTER 2=RIGHT
//   verticalAlign?:   0=TOP 1=CENTER 2=BOTTOM
//   bold?:            boolean
//   italic?:          boolean
//   underline?:       boolean
//   enableWrapText?:  boolean（_enableWrapText）
// }

'use strict';

const { isStub, resolveNode, findComponent } = require('../helpers.js');

const FIELD_MAP = {
  text:            '_string',
  fontSize:        '_fontSize',
  lineHeight:      '_lineHeight',
  overflow:        '_overflow',
  horizontalAlign: '_horizontalAlign',
  verticalAlign:   '_verticalAlign',
  bold:            '_isBold',
  italic:          '_isItalic',
  underline:       '_isUnderline',
  enableWrapText:  '_enableWrapText',
};

function execSetLabel(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector } = op;

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'set-label');
  if (isStub(elements, node)) {
    throw new Error(`editPrefab [set-label]: 节点是 stub，请用 set-nested-component-field`);
  }

  const comp = findComponent(elements, node, 'cc.Label');
  if (!comp) {
    throw new Error(`editPrefab [set-label]: 节点 "${node._name}" 上找不到 cc.Label 组件`);
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
      `editPrefab [set-label]: 至少需要提供一个字段（${Object.keys(FIELD_MAP).join('/')}）`
    );
  }

  return nodeId;
}

module.exports = { execSetLabel };
