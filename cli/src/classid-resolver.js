// ============================================================
// ClassIdResolver：扫描 assets/scripts/ 下所有 .ts，建立
//   className → { uuid, classId, scriptPath } 映射。
//
// 来源：
//   - @ccclass('SomeName') 装饰器提供 className
//   - 同路径 <script>.ts.meta 的 uuid 字段
//   - compressUuid(uuid) 得到 Cocos 序列化 prefab 用的 23 字符 classId
//
// 缓存粒度：projectRoot；多次调用复用。
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { compressUuid } = require('./id');

const _cache = new Map(); // projectRoot -> Map<className, entry>

/** 从路径向上找含 assets/+package.json 的目录。 */
function _findProjectRoot(startPath) {
  const resolved = path.resolve(startPath);
  let dir;
  try {
    dir = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  } catch (_) {
    dir = path.dirname(resolved);
  }
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, 'assets')) && fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`ClassIdResolver: 无法从 "${startPath}" 向上找到项目根`);
}

/** 扫 .ts 抽取 @ccclass('Name')；一个文件可以多个 */
function _extractCcClassNames(src) {
  const names = [];
  const re = /@ccclass\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/** 在 assetsDir 下找所有 .ts（跳过 .d.ts），返回绝对路径数组。 */
function _listTsFiles(assetsDir) {
  try {
    const raw = execSync(
      `find "${assetsDir}" -name "*.ts" -not -name "*.d.ts" -type f`,
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
    );
    return raw.trim().split('\n').filter(Boolean);
  } catch (e) {
    throw new Error(`ClassIdResolver: find 命令失败: ${e.message}`);
  }
}

/** 建 projectRoot 下的 className -> entry 索引。 */
function _buildIndex(projectRoot) {
  const scriptsDir = path.join(projectRoot, 'assets', 'scripts');
  const scanDir = fs.existsSync(scriptsDir) ? scriptsDir : path.join(projectRoot, 'assets');

  const tsFiles = _listTsFiles(scanDir);
  const index = new Map();

  for (const tsPath of tsFiles) {
    const metaPath = tsPath + '.meta';
    if (!fs.existsSync(metaPath)) continue;

    let src, meta;
    try {
      src = fs.readFileSync(tsPath, 'utf8');
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (_) {
      continue;
    }
    if (typeof meta.uuid !== 'string') continue;

    const names = _extractCcClassNames(src);
    if (names.length === 0) continue;

    let classId;
    try {
      classId = compressUuid(meta.uuid);
    } catch (_) {
      continue;
    }

    for (const name of names) {
      if (!index.has(name)) {
        index.set(name, { uuid: meta.uuid, classId, scriptPath: tsPath });
      }
    }
  }
  return index;
}

function _getIndex(startPath) {
  const projectRoot = _findProjectRoot(startPath);
  if (_cache.has(projectRoot)) return _cache.get(projectRoot);
  const idx = _buildIndex(projectRoot);
  _cache.set(projectRoot, idx);
  return idx;
}

/**
 * 根据 @ccclass 名字解析对应的压缩 classId。
 * @param {string} className     例如 'GMUI'
 * @param {string} startPath     项目内任一路径（用于定位 projectRoot）
 * @returns {string|null}        命中返回 classId；未命中返回 null（调用方决定是否报错）
 */
function resolveClassIdByName(className, startPath) {
  const idx = _getIndex(startPath);
  const entry = idx.get(className);
  return entry ? entry.classId : null;
}

/** 测试/诊断：列出所有 className → classId 对。 */
function listAll(startPath) {
  const idx = _getIndex(startPath);
  const out = {};
  for (const [k, v] of idx.entries()) out[k] = v.classId;
  return out;
}

function clearCache() {
  _cache.clear();
}

module.exports = { resolveClassIdByName, listAll, clearCache };
