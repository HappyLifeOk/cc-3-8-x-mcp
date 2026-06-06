// set-editbox: 批量设置节点上 cc.EditBox 的常用字段
// op: {
//   op: 'set-editbox',
//   node,
//   inputMode?:  0=ANY 1=EMAIL_ADDR 2=NUMERIC 3=PHONE_NUMBER 4=URL 5=DECIMAL 6=SINGLE_LINE
//   maxLength?:  number（-1 无限制）
//   placeholder?: string
//   string?:     string（当前文字值）
//   inputFlag?:  0=DEFAULT 1=PASSWORD 2=SENSITIVE 3=INITIAL_CAPS_WORD 4=INITIAL_CAPS_SENTENCE 5=INITIAL_CAPS_ALL_CHARACTERS
//   fontSize?:   number
// }
//
// 至少提供一个可选字段，否则 op 无意义。

'use strict';

const { isStub, resolveNode, findComponent } = require('../helpers.js');

const FIELD_MAP = {
  inputMode:   '_inputMode',
  maxLength:   '_maxLength',
  placeholder: '_placeholder',
  string:      '_string',
  inputFlag:   '_inputFlag',
  fontSize:    '_fontSize',
};

function execSetEditBox(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector } = op;

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'set-editbox');
  if (isStub(elements, node)) {
    throw new Error(`editPrefab [set-editbox]: 节点是 stub，请用 set-nested-component-field`);
  }

  const comp = findComponent(elements, node, 'cc.EditBox');
  if (!comp) {
    throw new Error(`editPrefab [set-editbox]: 节点 "${node._name}" 上找不到 cc.EditBox 组件`);
  }

  let applied = 0;
  for (const [key, field] of Object.entries(FIELD_MAP)) {
    if (key in op) {
      comp[field] = op[key];
      applied++;
    }
  }
  if (applied === 0) {
    throw new Error(`editPrefab [set-editbox]: 至少需要提供一个字段（inputMode/maxLength/placeholder/string/inputFlag/fontSize）`);
  }

  return nodeId;
}

module.exports = { execSetEditBox };
