// cli/anim-cmd.js — anim 子命令
//
// .anim 文件与 prefab 同为 JSON 数组 + __id__ 引用格式，editPrefab 可直接复用。
// 本子命令是封装：让用户语义上明确"这是动画文件操作"，并允许 query 节点结构。
//
// 用法：
//   anim query <anim> [--selector tree|node|find|field] ...
//   anim batch <anim> <ops.json> [--dry-run]
//
// 注意：op 库当前面向 cc.Node 树设计，对 .anim 内的 cc.AnimationClip /
// cc.Track / cc.Curve 等结构无专属 op，但通用的 set-component-field（用于
// AnimationClip 顶层）/ set-component-ref / dedupe-component 等仍可用。
// 真正的 anim 曲线编辑应由 src/anim-primitives.js 暴露的 helper 在脚本中处理。

'use strict';

const fs = require('fs');
const path = require('path');
const { editPrefab } = require('../editor/index.js');
const { queryPrefab } = require('../query/index.js');
const { parseFlags } = require('./flags.js');

function die(msg) {
  process.stderr.write('Error: ' + msg + '\n');
  process.exit(1);
}

function resolvePath(p) {
  return path.resolve(process.cwd(), p);
}

function cmdAnim(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(`anim <subcommand> <file> [args]

Subcommands:
  query <anim> [--selector tree|node|find|field] ...
  batch <anim> <ops.json> [--project-root <path>] [--dry-run]

注意：.anim 与 .prefab 同为 JSON 数组 + __id__ 引用格式，复用 editPrefab。
op 库当前主要面向 cc.Node 树；编辑动画曲线请用 src/anim-primitives.js
暴露的 helper 在脚本中处理。
`);
    return;
  }

  if (sub === 'query') {
    const { flags, positional } = parseFlags(rest);
    const animArg = positional[0];
    if (!animArg) die('anim query: 必须提供 <anim>');
    const animPath = resolvePath(animArg);
    if (!fs.existsSync(animPath)) die(`anim query: 文件不存在: ${animPath}`);

    const selectorType = flags['selector'] || 'tree';
    const withComps = flags['with-comps'] === true;
    let selector;
    if (selectorType === 'tree') selector = { type: 'tree', withComps };
    else if (selectorType === 'node') selector = { type: 'node', name: flags['name'], withComps };
    else if (selectorType === 'find') selector = { type: 'find', nodeType: flags['type'] };
    else if (selectorType === 'field') selector = {
      type: 'field', name: flags['name'], componentType: flags['comp'], field: flags['field'],
    };
    else die(`anim query: 不支持的 --selector "${selectorType}"`);

    let result;
    try {
      result = queryPrefab(animPath, selector);
    } catch (e) {
      die('anim query 失败: ' + e.message);
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  if (sub === 'batch') {
    const { flags, positional } = parseFlags(rest);
    const [animArg, opsArg] = positional;
    if (!animArg) die('anim batch: 必须提供 <anim>');
    if (!opsArg) die('anim batch: 必须提供 <ops.json>');
    const animPath = resolvePath(animArg);
    const opsPath = resolvePath(opsArg);
    if (!fs.existsSync(animPath)) die(`anim batch: 文件不存在: ${animPath}`);
    if (!fs.existsSync(opsPath)) die(`anim batch: ops 文件不存在: ${opsPath}`);

    let ops;
    try {
      ops = JSON.parse(fs.readFileSync(opsPath, 'utf8'));
    } catch (e) {
      die('anim batch: ops.json 解析失败: ' + e.message);
    }
    if (!Array.isArray(ops)) die('anim batch: ops.json 必须是数组');

    const editOptions = {};
    if (flags['project-root']) editOptions.projectRoot = resolvePath(flags['project-root']);
    if (flags['dry-run'] === true) editOptions.dryRun = true;

    let result;
    try {
      result = editPrefab(animPath, ops, editOptions);
    } catch (e) {
      die('anim batch 失败: ' + e.message);
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  die(`anim: 未知子命令 "${sub}"，可用: query / batch`);
}

module.exports = { cmdAnim };
