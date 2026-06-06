// cli/query-cmd.js — query 子命令

'use strict';

const fs = require('fs');
const path = require('path');
const { queryPrefab } = require('../query/index.js');
const { parseFlags } = require('./flags.js');

function die(msg) {
  process.stderr.write('Error: ' + msg + '\n');
  process.exit(1);
}

function resolvePath(p) {
  return path.resolve(process.cwd(), p);
}

function cmdQuery(args) {
  const { flags, positional } = parseFlags(args);

  const prefabArg = positional[0];
  if (!prefabArg) die('query: 必须提供 <prefab> 路径');

  const prefabPath = resolvePath(prefabArg);
  if (!fs.existsSync(prefabPath)) die(`query: 文件不存在: ${prefabPath}`);

  const selectorType = flags['selector'] || 'tree';
  const withComps = flags['with-comps'] === true;
  let selector;

  if (selectorType === 'tree') {
    selector = { type: 'tree', withComps };
  } else if (selectorType === 'node') {
    const name = flags['name'];
    if (!name) die('query --selector node: 必须提供 --name <节点名>');
    selector = { type: 'node', name, withComps };
  } else if (selectorType === 'find') {
    const nodeType = flags['type'];
    if (!nodeType) die('query --selector find: 必须提供 --type <组件类型>');
    selector = { type: 'find', nodeType };
  } else if (selectorType === 'field') {
    const name = flags['name'];
    const compType = flags['comp'];
    const field = flags['field'];
    if (!name) die('query --selector field: 必须提供 --name <节点名>');
    if (!compType) die('query --selector field: 必须提供 --comp <组件类型>');
    if (!field) die('query --selector field: 必须提供 --field <字段名>');
    selector = { type: 'field', name, componentType: compType, field };
  } else if (selectorType === 'overrides') {
    // --node 支持 name / --id N / --path A/B/C 三种
    let nodeSel;
    if (flags['id'] !== undefined) {
      const idNum = Number(flags['id']);
      if (!Number.isInteger(idNum) || idNum < 0) die('query --selector overrides: --id 必须是非负整数');
      nodeSel = { id: idNum };
    } else if (typeof flags['path'] === 'string' && flags['path'].length > 0) {
      nodeSel = { path: flags['path'] };
    } else if (typeof flags['node'] === 'string' && flags['node'].length > 0) {
      nodeSel = flags['node'];
    } else if (typeof flags['name'] === 'string' && flags['name'].length > 0) {
      nodeSel = flags['name'];
    } else {
      die('query --selector overrides: 必须提供 --id N 或 --path A/B/C 或 --name <name>');
    }
    selector = { type: 'overrides', node: nodeSel };
  } else {
    die(`query: 不支持的 --selector 值 "${selectorType}"，可选: tree / node / find / field / overrides`);
  }

  let result;
  try {
    result = queryPrefab(prefabPath, selector);
  } catch (e) {
    die('query 失败: ' + e.message);
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { cmdQuery };
