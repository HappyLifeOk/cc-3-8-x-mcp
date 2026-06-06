// ============================================================
// cli/extract-cmd.js — extract-prefab 子命令
//
// 用法：
//   cocos-mcp-cli extract-prefab <src-prefab> <out-prefab>
//     --node <selector> [--name <new-name>] [--dry-run]
//
// 把 src-prefab 中某个子节点连同其整棵子树（含组件 / PrefabInfo /
// 嵌套 PrefabInstance / propertyOverrides / TargetInfo / mountedComponents
// 等所有 __id__ 引用闭包）提取出来，构造一个独立的新 prefab + .meta。
//
// 跟 batch op clone-node 的区别：
//   - clone-node 在同 prefab 内复制 + 挂到 parent
//   - extract-prefab 写出到新 .prefab 文件（含 cc.Prefab 头），脱离源文件
//
// 典型场景：把 HomeBottom 上的 btnTask 子树提取成独立的 task BottomEntry.prefab。
//
// selector 接受 batch 同款三种形式：
//   "btnTask"
//   { "id": 13 }
//   { "path": "btnTask" }
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { deterministicUUID } = require('../id.js');
const { parsePrefab } = require('../parse.js');
const { resolveNode } = require('../editor/helpers.js');

function die(msg) {
  process.stderr.write('Error: ' + msg + '\n');
  process.exit(1);
}

function parseSelector(raw) {
  // 支持 --node btnTask 或 --node '{"id":13}'
  const t = raw.trim();
  if (t.startsWith('{')) {
    try { return JSON.parse(t); } catch (e) {
      die(`--node JSON 解析失败: ${t} (${e.message})`);
    }
  }
  return t;
}

function cmdExtractPrefab(argv) {
  let srcPath = null;
  let outPath = null;
  let nodeSelector = null;
  let newName = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--node') {
      nodeSelector = parseSelector(argv[++i] ?? '');
      if (!nodeSelector) die('--node 需要一个值');
    } else if (arg === '--name') {
      newName = argv[++i];
      if (!newName) die('--name 需要一个值');
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (!arg.startsWith('--')) {
      if (srcPath === null) srcPath = arg;
      else if (outPath === null) outPath = arg;
      else die('多余的位置参数: ' + arg);
    } else {
      die(`未知参数 "${arg}"`);
    }
  }

  if (!srcPath || !outPath) {
    die('用法: extract-prefab <src-prefab> <out-prefab> --node <selector> [--name <new-name>] [--dry-run]');
  }
  if (nodeSelector === null) die('--node 是必需参数');

  const srcAbs = path.resolve(process.cwd(), srcPath);
  if (!fs.existsSync(srcAbs)) die(`源 prefab 不存在: ${srcPath}`);

  // 确保 .prefab 后缀
  if (!outPath.endsWith('.prefab')) outPath += '.prefab';
  if (!newName) newName = path.basename(outPath, '.prefab');

  // 1) 解析源 prefab
  const prefabData = parsePrefab(srcAbs);
  const { elements } = prefabData;
  const { nodeId: srcNodeId } = resolveNode(prefabData, nodeSelector, 'extract-prefab');

  // 2) BFS 闭包收集：从 srcNodeId 出发，把所有递归引用的 __id__ 拉进来
  const collected = new Set();
  const queue = [srcNodeId];
  while (queue.length > 0) {
    const idx = queue.shift();
    if (collected.has(idx)) continue;
    collected.add(idx);
    const refs = [];
    _walkCollect(elements[idx], refs);
    for (const r of refs) {
      if (!collected.has(r)) queue.push(r);
    }
  }

  // 3) 重新编号：new[0] = 新 cc.Prefab 头部，new[1] = srcNode（root），其余按原 idx 升序
  const oldToNew = new Map();
  const sortedOld = [srcNodeId, ...[...collected].filter((i) => i !== srcNodeId).sort((a, b) => a - b)];
  const newData = [];

  // new[0]: 复制源 prefab 头部模板（只用 __type__ / data / optimizationPolicy / persistent 等基础字段）
  const srcHead = elements[0] && elements[0].__type__ === 'cc.Prefab' ? elements[0] : null;
  const newHead = {
    __type__: 'cc.Prefab',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    data: { __id__: 1 },
    optimizationPolicy: srcHead && srcHead.optimizationPolicy !== undefined ? srcHead.optimizationPolicy : 0,
    persistent: srcHead && srcHead.persistent !== undefined ? srcHead.persistent : false,
  };
  newData.push(newHead);

  for (let i = 0; i < sortedOld.length; i++) {
    oldToNew.set(sortedOld[i], i + 1);
    newData.push(_deepClone(elements[sortedOld[i]]));
  }

  // 4) Remap __id__ 引用
  for (let i = 1; i < newData.length; i++) {
    _remapIds(newData[i], oldToNew);
  }

  // 5) 修正根节点：_parent=null, _name=newName
  const newRoot = newData[1];
  newRoot._parent = null;
  newRoot._name = newName;

  // 6) 修正根节点 _prefab（PrefabInfo）：root 指向新根 idx 1，asset 指向 idx 0
  if (newRoot._prefab && typeof newRoot._prefab.__id__ === 'number') {
    const rootPInfo = newData[newRoot._prefab.__id__];
    if (rootPInfo && rootPInfo.__type__ === 'cc.PrefabInfo') {
      rootPInfo.root = { __id__: 1 };
      rootPInfo.asset = { __id__: 0 };
      // 这些字段在源 prefab 是相对宿主 prefab 的，新 prefab 是独立的，清掉
      if ('instance' in rootPInfo) rootPInfo.instance = null;
      if ('targetOverrides' in rootPInfo) rootPInfo.targetOverrides = null;
      if ('nestedPrefabInstanceRoots' in rootPInfo) rootPInfo.nestedPrefabInstanceRoots = null;
    }
  }

  // 7) 生成 meta
  const seed = `extract-prefab:${outPath}:${newName}`;
  const newUuid = deterministicUUID(`${seed}:uuid`);
  const meta = {
    ver: '1.1.50',
    importer: 'prefab',
    imported: true,
    uuid: newUuid,
    files: ['.json'],
    subMetas: {},
    userData: { syncNodeName: newName },
  };

  if (dryRun) {
    process.stdout.write('=== PREFAB ===\n');
    process.stdout.write(JSON.stringify(newData, null, 2) + '\n');
    process.stdout.write('\n=== META ===\n');
    process.stdout.write(JSON.stringify(meta, null, 2) + '\n');
    process.stdout.write(`\n=== STATS ===\ncollected ${collected.size} objects from source idx ${srcNodeId}\n`);
    return;
  }

  const outAbs = path.resolve(process.cwd(), outPath);
  const dir = path.dirname(outAbs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(outAbs, JSON.stringify(newData, null, 2) + '\n', 'utf8');
  fs.writeFileSync(outAbs + '.meta', JSON.stringify(meta, null, 2) + '\n', 'utf8');

  process.stdout.write(`created: ${outPath} (${collected.size} objects)\n`);
  process.stdout.write(`created: ${outPath}.meta\n`);
}

// ── internals ────────────────────────────────────────────

// 跳过的字段：_parent 反向引用会把父链/兄弟子树拖进闭包，破坏"只提取子树"的语义
const SKIP_KEYS = new Set(['_parent']);

function _walkCollect(obj, out) {
  if (obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    for (const v of obj) _walkCollect(v, out);
    return;
  }
  if (typeof obj === 'object') {
    if (typeof obj.__id__ === 'number') {
      out.push(obj.__id__);
      return;
    }
    for (const k of Object.keys(obj)) {
      if (SKIP_KEYS.has(k)) continue;
      _walkCollect(obj[k], out);
    }
  }
}

function _deepClone(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(_deepClone);
  const out = {};
  for (const k of Object.keys(obj)) out[k] = _deepClone(obj[k]);
  return out;
}

function _remapIds(obj, map) {
  if (obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    for (const v of obj) _remapIds(v, map);
    return;
  }
  if (typeof obj === 'object') {
    if (typeof obj.__id__ === 'number') {
      const newId = map.get(obj.__id__);
      if (newId !== undefined) {
        obj.__id__ = newId;
      } else {
        // 引用集合外的 idx —— 闭包应该完整，理论不会发生
        obj.__id__ = null;
      }
      return;
    }
    for (const k of Object.keys(obj)) _remapIds(obj[k], map);
  }
}

module.exports = { cmdExtractPrefab };
