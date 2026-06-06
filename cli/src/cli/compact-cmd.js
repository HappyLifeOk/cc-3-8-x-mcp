// ============================================================
// compact-cmd.js — 清理 prefab data 数组里的 null 槽位 + 重映射 __id__
//
// 用途：早期某些 prefab（比如 extract-prefab 命令上线前手工生成的）含 null 槽位，
//       Cocos editor 反序列化容错跳过，但 build worker 严格 scan 撞 null 崩
//       「Cannot read properties of undefined (reading '__type__')」。
//
// 算法（跟 extract-cmd line 105-132 同款，但不剔除任何东西）：
//   1) 收集所有 null 索引
//   2) 构造 oldIdx → newIdx 映射（newIdx = oldIdx - 前面 null 数量）
//   3) newData = data.filter(el => el !== null)
//   4) 递归重映射所有 __id__ 引用
//
// 用法：
//   cocos-mcp-cli compact-prefab <prefab> [--dry-run]
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

function die(msg) {
  process.stderr.write('Error: ' + msg + '\n');
  process.exit(1);
}

function cmdCompactPrefab(argv) {
  let prefabPath = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--')) {
      die(`未知参数 "${arg}"`);
    } else if (prefabPath === null) {
      prefabPath = arg;
    } else {
      die(`多余位置参数 "${arg}"`);
    }
  }

  if (!prefabPath) die('需要 <prefab> 路径参数');

  compactOne(prefabPath, dryRun);
}

function compactOne(prefabPath, dryRun) {
  const abs = path.resolve(process.cwd(), prefabPath);
  if (!fs.existsSync(abs)) die(`prefab 不存在: ${prefabPath}`);

  const raw = fs.readFileSync(abs, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    die(`JSON 解析失败 (${prefabPath}): ${e.message}`);
  }
  if (!Array.isArray(data)) die(`不是 prefab 数据数组: ${prefabPath}`);

  // 1) 收集 null 索引
  const nullIdxs = [];
  data.forEach((el, i) => { if (el === null) nullIdxs.push(i); });

  if (nullIdxs.length === 0) {
    process.stdout.write(`${prefabPath} → 无 null 槽位，无需 compact\n`);
    return;
  }

  // 2) 构造 oldIdx → newIdx 映射
  const oldToNew = new Map();
  let newIdx = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== null) {
      oldToNew.set(i, newIdx);
      newIdx++;
    }
  }

  // 3) 新数组
  const newData = data.filter((el) => el !== null);

  // 4) 重映射 __id__；跟踪指向已删 null 的 dangling 引用
  let danglingRefs = 0;
  const danglingDetails = [];
  for (let i = 0; i < newData.length; i++) {
    _remapIds(newData[i], oldToNew, '[' + i + ']', danglingDetails);
  }
  danglingRefs = danglingDetails.length;

  // 5) Dry-run / Apply
  const summary = `${prefabPath} → ${data.length} → ${newData.length} (清掉 ${nullIdxs.length} 个 null)`;
  process.stdout.write(summary + (dryRun ? ' [dry-run]' : '') + '\n');
  if (nullIdxs.length <= 50) {
    process.stdout.write('  原 null 索引: ' + nullIdxs.join(',') + '\n');
  } else {
    process.stdout.write('  原 null 索引（前 20）: ' + nullIdxs.slice(0, 20).join(',') + ' ... (共 ' + nullIdxs.length + ')\n');
  }
  if (danglingRefs > 0) {
    process.stderr.write(`⚠ ${danglingRefs} 个 __id__ 引用原本指向 null 槽位（已置 null）：\n`);
    danglingDetails.slice(0, 5).forEach((d) => process.stderr.write('   ' + d + '\n'));
    if (danglingDetails.length > 5) process.stderr.write(`   ... 共 ${danglingDetails.length} 处\n`);
  }

  if (dryRun) return;

  fs.writeFileSync(abs, JSON.stringify(newData, null, 2) + '\n', 'utf8');
  process.stdout.write(`  ✓ 写入 ${prefabPath}\n`);
}

function _remapIds(obj, map, location, dangling) {
  if (obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) _remapIds(obj[i], map, location + '[' + i + ']', dangling);
    return;
  }
  if (typeof obj === 'object') {
    if (typeof obj.__id__ === 'number') {
      const oldId = obj.__id__;
      const newId = map.get(oldId);
      if (newId === undefined) {
        // 引用指向 null 槽位 —— 把 __id__ 置 null
        obj.__id__ = null;
        dangling.push(location + ' → __id__:' + oldId);
      } else {
        obj.__id__ = newId;
      }
      return;
    }
    for (const k of Object.keys(obj)) _remapIds(obj[k], map, location + '.' + k, dangling);
  }
}

module.exports = { cmdCompactPrefab };
