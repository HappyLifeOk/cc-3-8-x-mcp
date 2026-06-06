// ============================================================
// editor/op-schema.js — ops 跑前 schema 校验
//
// 价值：
// - 字段拼错（comp / ref / propery）一次性报齐，不用一条条 op 跑到才发现
// - 未知 op 类型 / 必填字段缺失，跑前就报，避免部分写入后回滚浪费时间
// - 字段类型错（`width: "100"`）跑前就报，避免运行时崩
//
// 校验粒度：必填字段名 + 已知字段拼写白名单 + 字段类型；
// 业务约束（值域、互斥）留给 handler（更易给出场景化错误信息）
// ============================================================

'use strict';

// 类型令牌：
//   'number' | 'string' | 'boolean' | 'object' | 'array' | 'any'
//   'node-selector'  — 字符串 / 数字 / { id, path } 三选一
//   'string|array'   — property 类支持嵌套路径数组
//   'string|object'  — refSubNode 支持字符串或字符串数组（这里只做粗校验）
//
// 'any' 不做类型断言（覆盖 value / props 一类 raw JSON）。
const T = {
  node: 'node-selector',
  parent: 'node-selector',
  target: 'node-selector',
  source: 'node-selector',
  refNode: 'node-selector',
  componentType: 'string',
  property: 'string|array',
  refType: 'string',
  refSubNode: 'any', // string | string[]
  value: 'any',
  props: 'object',
  selector: 'object',
  order: 'array',
  text: 'string',
  name: 'string',
  uuid: 'string',
  prefabUuid: 'string',
  active: 'boolean',
  enabled: 'boolean',
  compensatePosition: 'boolean',
  clearOverrides: 'boolean',
  bold: 'boolean',
  italic: 'boolean',
  underline: 'boolean',
  enableWrapText: 'boolean',
  grayscale: 'boolean',
  trim: 'boolean',
  affectedByScale: 'boolean',
  interactable: 'boolean',
  all: 'boolean',
  x: 'number',
  y: 'number',
  z: 'number',
  dx: 'number',
  dy: 'number',
  dz: 'number',
  width: 'number',
  height: 'number',
  r: 'number',
  g: 'number',
  b: 'number',
  a: 'number',
  fontSize: 'number',
  lineHeight: 'number',
  maxWidth: 'number',
  maxLength: 'number',
  inputMode: 'number',
  inputFlag: 'number',
  zoomScale: 'number',
  duration: 'number',
  type: 'number',
  sizeMode: 'number',
  overflow: 'number',
  horizontalAlign: 'number',
  verticalAlign: 'number',
  transition: 'number',
  resizeMode: 'number',
  paddingLeft: 'number',
  paddingRight: 'number',
  paddingTop: 'number',
  paddingBottom: 'number',
  spacingX: 'number',
  spacingY: 'number',
  startAxis: 'number',
  constraint: 'number',
  constraintNum: 'number',
  placeholder: 'string',
  string: 'string',
  labelNode: 'string',
  spriteNode: 'string',
  subNode: 'any', // string | string[]
};

// 每个 op 的字段白名单（含必填 + 可选；'op' 隐含必填）
// typeOverrides：对全局 T 表的字段类型做局部覆盖（同名字段在不同 op 里语义不同时用）
const SCHEMAS = {
  'set-position':            { required: ['node', 'x', 'y'],                       optional: ['z'] },
  'set-label-text':          { required: ['node', 'text'],                         optional: ['labelNode'] },
  'set-sprite-frame':        { required: ['node', 'uuid'],                         optional: ['spriteNode'] },
  'set-active':              { required: ['node', 'active'],                       optional: [] },
  'set-component-field':     { required: ['node', 'componentType', 'property', 'value'], optional: [] },
  'set-component-enabled':   { required: ['node', 'componentType', 'enabled'],     optional: ['subNode'] },
  'set-anchor':              { required: ['node'],                                 optional: ['x', 'y', 'compensatePosition'] },
  'set-size':                { required: ['node'],                                 optional: ['width', 'height'] },
  'adjust-position':         { required: ['node'],                                 optional: ['dx', 'dy', 'dz'] },
  'rename-node':             { required: ['node', 'name'],                         optional: [] },
  // reparent: 把节点搬到另一个父节点下（不复制；普通 inline 节点；自带循环检测）
  'reparent':                { required: ['node', 'parent'],                       optional: ['index'] },
  'reorder-children':        { required: ['node', 'order'],                        optional: [] },
  // add-node 的 node 是「新节点描述对象」而非 selector
  'add-node':                { required: ['parent', 'node'],                       optional: [], typeOverrides: { node: 'object' } },
  'remove-node':             { required: ['target'],                               optional: [] },
  'clone-node':              { required: ['source', 'parent', 'name'],             optional: [] },
  'add-component':           { required: ['node', 'componentType'],                optional: ['props'] },
  'remove-component':        { required: ['node', 'componentType'],                optional: [] },
  'set-component-ref':       { required: ['node', 'componentType', 'property', 'refNode'], optional: ['refType', 'refSubNode'] },
  'set-nested-component-field': { required: ['node', 'componentType', 'property', 'value'], optional: ['subNode'] },
  // bulk-set 的 target 是 "node" 或 "component:<type>" 字符串模式，不是 selector
  'bulk-set':                { required: ['selector', 'target', 'property', 'value'], optional: [], typeOverrides: { target: 'string' } },
  'dedupe-component':        { required: [],                                       optional: ['node'] },
  'set-editbox':             { required: ['node'],                                 optional: ['inputMode', 'maxLength', 'placeholder', 'string', 'inputFlag', 'fontSize'] },
  'set-label':               { required: ['node'],                                 optional: ['text', 'fontSize', 'lineHeight', 'overflow', 'horizontalAlign', 'verticalAlign', 'bold', 'italic', 'underline', 'enableWrapText'] },
  'set-button':              { required: ['node'],                                 optional: ['interactable', 'transition', 'zoomScale', 'duration'] },
  'set-layout':              { required: ['node'],                                 optional: ['type', 'resizeMode', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'spacingX', 'spacingY', 'startAxis', 'constraint', 'constraintNum', 'affectedByScale'] },
  'set-richtext':            { required: ['node'],                                 optional: ['text', 'maxWidth', 'fontSize', 'lineHeight'] },
  'set-sprite':              { required: ['node'],                                 optional: ['sizeMode', 'type', 'grayscale', 'trim'] },
  'set-node-color':          { required: ['node'],                                 optional: ['r', 'g', 'b', 'a'] },
  'replace-nested-prefab':   { required: ['target', 'prefabUuid'],                 optional: ['clearOverrides'] },
  'add-nested-prefab':       { required: ['parent', 'prefabUuid'],                 optional: ['name', 'lpos'] },
  'reset-overrides':         { required: ['node'],                                 optional: ['property', 'componentType', 'subNode', 'all'] },
  // ensure-meta: 给 .ts/.json 文件创建 .meta（v4 uuid），让后续 className → classId 查表能命中
  'ensure-meta':             { required: ['path'],                                 optional: [], typeOverrides: { path: 'string' } },
  'sync-nested-roots':       { required: [],                                       optional: [] },
};

// 已知拼错 → 正确字段映射（友好提示）
const COMMON_TYPOS = {
  'comp':       'componentType',
  'compType':   'componentType',
  'ref':        'refNode',
  'propery':    'property',
  'val':        'value',
  'newName':    'name',
  'nodeName':   'node',
};

function _formatType(token) {
  switch (token) {
    case 'node-selector': return '字符串/数字/{id}/{path}';
    case 'string|array':  return '字符串或数组';
    default:              return token;
  }
}

function _checkType(value, token) {
  if (token === 'any') return true;
  if (token === 'node-selector') {
    if (typeof value === 'string') return value.length > 0;
    if (typeof value === 'number') return Number.isInteger(value) && value >= 0;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return typeof value.id === 'number' || typeof value.path === 'string';
    }
    return false;
  }
  if (token === 'string|array') {
    return typeof value === 'string' || Array.isArray(value);
  }
  if (token === 'array') return Array.isArray(value);
  if (token === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  return typeof value === token; // number / string / boolean
}

function validateOps(ops, knownOpTypes) {
  const errors = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const prefix = `ops[${i}]`;

    if (!op || typeof op !== 'object' || Array.isArray(op)) {
      errors.push(`${prefix}: 不是对象`);
      continue;
    }
    if (typeof op.op !== 'string') {
      errors.push(`${prefix}: 缺 'op' 字段`);
      continue;
    }
    if (!knownOpTypes.includes(op.op)) {
      errors.push(`${prefix}: 不支持的 op 类型 "${op.op}"，已知: ${knownOpTypes.join(', ')}`);
      continue;
    }

    const schema = SCHEMAS[op.op];
    if (!schema) continue; // 没登记 schema 的 op 跳过

    const known = new Set(['op', ...schema.required, ...schema.optional]);

    // 必填检查
    for (const r of schema.required) {
      if (!(r in op)) {
        errors.push(`${prefix} (${op.op}): 缺必填字段 "${r}"`);
      }
    }

    // 多余字段 + 类型检查
    for (const k of Object.keys(op)) {
      if (k === 'op') continue;
      if (!known.has(k)) {
        const suggest = COMMON_TYPOS[k];
        if (suggest && known.has(suggest)) {
          errors.push(`${prefix} (${op.op}): 未知字段 "${k}"，可能想写 "${suggest}"`);
        } else {
          errors.push(`${prefix} (${op.op}): 未知字段 "${k}"，已知: ${[...known].join(', ')}`);
        }
        continue;
      }
      // 类型检查（only 在 T 中登记的字段；未登记的留给 handler）
      // op 的 typeOverrides 优先级高于全局 T
      const token = (schema.typeOverrides && schema.typeOverrides[k]) || T[k];
      if (!token) continue;
      if (!_checkType(op[k], token)) {
        const got = Array.isArray(op[k]) ? 'array' : (op[k] === null ? 'null' : typeof op[k]);
        errors.push(
          `${prefix} (${op.op}): 字段 "${k}" 类型应为 ${_formatType(token)}，实际是 ${got}（值: ${JSON.stringify(op[k])}）`
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`editPrefab: ops schema 校验失败:\n  ${errors.join('\n  ')}`);
  }
}

module.exports = { validateOps, SCHEMAS };
