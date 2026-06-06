// cli/batch-cmd.js — batch 子命令
//
// 用法：
//   batch <prefab> <ops.json> [--project-root P] [--dry-run]
//   batch <ops.json> --glob <pattern> [--project-root P] [--dry-run]
//
// --glob：把第一个位置参数当 ops.json，对所有匹配 pattern 的 prefab 跑同一组 ops

'use strict';

const fs = require('fs');
const path = require('path');
const { editPrefab } = require('../editor/index.js');
const { parseFlags } = require('./flags.js');

function die(msg) {
  process.stderr.write('Error: ' + msg + '\n');
  process.exit(1);
}

function resolvePath(p) {
  return path.resolve(process.cwd(), p);
}

// glob 匹配（自实现，支持 ** / * / ?）
//   ** 匹配任意层目录（包括 0 层）
//   * 匹配一段非斜杠字符
//   ? 匹配单字符
function _globToRegex(pattern) {
  let re = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      // 处理 **/  和  ** 末尾
      if (pattern[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 3;
      } else {
        re += '.*';
        i += 2;
      }
    } else if (c === '*') {
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+()|[]{}^$\\'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  re += '$';
  return new RegExp(re);
}

function _walk(dir, relRoot, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(relRoot, full);
    if (ent.isDirectory()) {
      // 跳过 node_modules / .git 等
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      _walk(full, relRoot, out);
    } else if (ent.isFile()) {
      out.push(rel);
    }
  }
}

function _expandGlob(pattern) {
  // 取 pattern 里第一个含通配符之前的目录段作为扫描根
  const cwd = process.cwd();
  const segments = pattern.split('/');
  const baseSegs = [];
  for (const s of segments) {
    if (s.includes('*') || s.includes('?')) break;
    baseSegs.push(s);
  }
  const baseRel = baseSegs.join('/');
  const baseAbs = baseRel ? path.resolve(cwd, baseRel) : cwd;
  if (!fs.existsSync(baseAbs)) return [];

  const all = [];
  if (fs.statSync(baseAbs).isFile()) {
    return [path.resolve(cwd, pattern)];
  }
  _walk(baseAbs, cwd, all);
  const re = _globToRegex(pattern);
  return all.filter((rel) => re.test(rel)).map((rel) => path.resolve(cwd, rel));
}

function cmdBatch(args) {
  const { flags, positional } = parseFlags(args);

  const editOptions = {};
  if (flags['project-root']) {
    editOptions.projectRoot = resolvePath(flags['project-root']);
  }
  if (flags['dry-run'] === true) {
    editOptions.dryRun = true;
  }

  // glob 模式：第一个位置参数当 ops.json
  if (flags['glob']) {
    const opsArg = positional[0];
    if (!opsArg) die('batch --glob: 必须提供 <ops.json>');
    const opsPath = resolvePath(opsArg);
    if (!fs.existsSync(opsPath)) die(`batch --glob: ops 文件不存在: ${opsPath}`);
    const ops = _readOps(opsPath);

    const matched = _expandGlob(flags['glob']);
    if (matched.length === 0) {
      die(`batch --glob: pattern "${flags['glob']}" 未匹配任何文件`);
    }

    const summary = [];
    for (const prefabPath of matched) {
      try {
        const result = editPrefab(prefabPath, ops, editOptions);
        summary.push({ file: path.relative(process.cwd(), prefabPath), ...result });
      } catch (e) {
        summary.push({ file: path.relative(process.cwd(), prefabPath), error: e.message });
      }
    }
    process.stdout.write(JSON.stringify({ matchedCount: matched.length, results: summary }, null, 2) + '\n');
    return;
  }

  // 单文件模式
  const [prefabArg, opsArg] = positional;
  if (!prefabArg) die('batch: 必须提供 <prefab>');
  if (!opsArg) die('batch: 必须提供 <ops.json>');

  const prefabPath = resolvePath(prefabArg);
  if (!fs.existsSync(prefabPath)) die(`batch: prefab 文件不存在: ${prefabPath}`);

  const ops = opsArg === '-'
    ? _readOpsRaw(fs.readFileSync('/dev/stdin', 'utf8'))
    : _readOps(resolvePath(opsArg));

  let result;
  try {
    result = editPrefab(prefabPath, ops, editOptions);
  } catch (e) {
    die('batch 失败: ' + e.message);
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

function _readOps(opsPath) {
  if (!fs.existsSync(opsPath)) die(`batch: ops 文件不存在: ${opsPath}`);
  return _readOpsRaw(fs.readFileSync(opsPath, 'utf8'));
}

function _readOpsRaw(raw) {
  let ops;
  try {
    ops = JSON.parse(raw);
  } catch (e) {
    die('batch: ops.json 解析失败: ' + e.message);
  }
  if (!Array.isArray(ops)) die('batch: ops.json 必须是数组');
  return ops;
}

module.exports = { cmdBatch };
