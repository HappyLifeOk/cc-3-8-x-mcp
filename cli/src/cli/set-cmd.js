// cli/set-cmd.js — set 子命令（单字段快捷写入）
//
// field 支持：
//   active              → set-active (true/false)
//   label.text          → set-label-text
//   position.x|y|z      → set-position（只改一轴，其余保留）

'use strict';

const fs = require('fs');
const path = require('path');
const { parsePrefab } = require('../parse.js');
const { editPrefab } = require('../editor/index.js');
const { parseFlags } = require('./flags.js');

function die(msg) {
  process.stderr.write('Error: ' + msg + '\n');
  process.exit(1);
}

function resolvePath(p) {
  return path.resolve(process.cwd(), p);
}

function cmdSet(args) {
  const { positional } = parseFlags(args);

  const [prefabArg, nodeName, field, rawValue] = positional;
  if (!prefabArg) die('set: 必须提供 <prefab>');
  if (!nodeName) die('set: 必须提供 <nodeName>');
  if (!field) die('set: 必须提供 <field>');
  if (rawValue === undefined) die('set: 必须提供 <value>');

  const prefabPath = resolvePath(prefabArg);
  if (!fs.existsSync(prefabPath)) die(`set: 文件不存在: ${prefabPath}`);

  let op;

  if (field === 'active') {
    if (rawValue !== 'true' && rawValue !== 'false') {
      die('set active: value 必须是 true 或 false');
    }
    op = { op: 'set-active', node: nodeName, active: rawValue === 'true' };

  } else if (field === 'label.text') {
    op = { op: 'set-label-text', node: nodeName, text: rawValue };

  } else if (field === 'position.x' || field === 'position.y' || field === 'position.z') {
    const axis = field.split('.')[1];
    const num = parseFloat(rawValue);
    if (isNaN(num)) die(`set ${field}: value 必须是数字`);
    const prefabData = parsePrefab(prefabPath);
    const node = prefabData.findNodeByName(nodeName);
    if (!node) die(`set: 找不到节点 "${nodeName}"`);
    const lpos = node._lpos || { x: 0, y: 0, z: 0 };
    const newPos = { x: lpos.x || 0, y: lpos.y || 0, z: lpos.z || 0 };
    newPos[axis] = num;
    op = { op: 'set-position', node: nodeName, x: newPos.x, y: newPos.y, z: newPos.z };

  } else {
    die(
      `set: 不支持的 field "${field}"，支持:\n` +
      '  active\n' +
      '  label.text\n' +
      '  position.x / position.y / position.z'
    );
  }

  let result;
  try {
    result = editPrefab(prefabPath, [op]);
  } catch (e) {
    die('set 失败: ' + e.message);
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { cmdSet };
