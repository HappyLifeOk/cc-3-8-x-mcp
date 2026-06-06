// cli/diff-cmd.js — diff 子命令（比较两个 prefab 的字段级差异）
//
// 用法：
//   diff <prefabA> <prefabB>
//
// 输出与 batch --dry-run 同格式：
//   { diff: [{ id, type, name, changes: { 'a.b.c': [oldVal, newVal] } }] }
//
// 适用于：CI 验证转换工具产物 / 对照历史版本 / review 自动 diff

'use strict';

const fs = require('fs');
const path = require('path');
const { parsePrefab } = require('../parse.js');
const { computeDiff } = require('../editor/diff.js');
const { parseFlags } = require('./flags.js');

function die(msg) {
  process.stderr.write('Error: ' + msg + '\n');
  process.exit(1);
}

function resolvePath(p) {
  return path.resolve(process.cwd(), p);
}

function cmdDiff(args) {
  const { positional } = parseFlags(args);
  const [a, b] = positional;
  if (!a) die('diff: 必须提供 <prefabA>');
  if (!b) die('diff: 必须提供 <prefabB>');

  const aPath = resolvePath(a);
  const bPath = resolvePath(b);
  if (!fs.existsSync(aPath)) die(`diff: 文件不存在: ${aPath}`);
  if (!fs.existsSync(bPath)) die(`diff: 文件不存在: ${bPath}`);

  let aData;
  let bData;
  try {
    aData = parsePrefab(aPath);
    bData = parsePrefab(bPath);
  } catch (e) {
    die('diff: 解析失败: ' + e.message);
  }

  const diff = computeDiff(aData.elements, bData.elements);
  const result = {
    a: path.relative(process.cwd(), aPath),
    b: path.relative(process.cwd(), bPath),
    elementsA: aData.elements.length,
    elementsB: bData.elements.length,
    changedCount: diff.length,
    diff,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { cmdDiff };
