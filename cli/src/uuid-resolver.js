// ============================================================
// UuidResolver：惰性扫描 assets/ 下所有 .prefab.meta 文件
// 构建 uuid → prefab 磁盘路径 索引，仅扫描一次后缓存于内存。
//
// 设计约束：
//   - 不引入第三方依赖（纯 Node.js fs + path + child_process）
//   - uuid 索引只扫一次，重复调用复用缓存
//   - 解析失败时明确抛错，不静默降级
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── 模块级缓存 ───────────────────────────────────────────────

/**
 * 缓存结构：Map<projectRoot, Map<uuid, absolutePrefabPath>>
 * 按项目根分隔，支持同进程内多项目（虽然实际上只会有一个）。
 */
const _cache = new Map();

// ─── 内部：定位 projectRoot ───────────────────────────────────

/**
 * 从路径（文件或目录）往上查找项目根（含有 assets/ 子目录 + package.json）
 *
 * @param {string} startPath  绝对路径（文件或目录均可）
 * @returns {string}  项目根绝对路径
 * @throws  找不到时抛错
 */
function _findProjectRoot(startPath) {
  const resolved = path.resolve(startPath);
  // 若是文件取其目录，若是目录直接用
  let dir;
  try {
    dir = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  } catch (_) {
    // 路径不存在（如 tmp 文件已被删除）也从 dirname 开始
    dir = path.dirname(resolved);
  }

  // 最多向上 20 层
  for (let i = 0; i < 20; i++) {
    const hasAssets = fs.existsSync(path.join(dir, 'assets'));
    const hasPkg = fs.existsSync(path.join(dir, 'package.json'));
    if (hasAssets && hasPkg) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) break; // 到达文件系统根
    dir = parent;
  }

  throw new Error(
    `UuidResolver: 无法从 "${startPath}" 向上找到项目根（含 assets/ + package.json 的目录）`
  );
}

// ─── 内部：扫描并建立索引 ─────────────────────────────────────

/**
 * 扫描 projectRoot/assets/ 下所有 .prefab.meta，建立 uuid → absolutePath 映射
 *
 * @param {string} projectRoot
 * @returns {Map<string, string>}
 */
function _buildIndex(projectRoot) {
  const assetsDir = path.join(projectRoot, 'assets');

  if (!fs.existsSync(assetsDir)) {
    throw new Error(`UuidResolver: assets 目录不存在: ${assetsDir}`);
  }

  // 用 find 命令比 Node 递归快，且无需手写 readdir 递归
  let metaFiles;
  try {
    const raw = execSync(
      `find "${assetsDir}" -name "*.prefab.meta" -type f`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    metaFiles = raw.trim().split('\n').filter(Boolean);
  } catch (e) {
    throw new Error(`UuidResolver: find 命令失败: ${e.message}`);
  }

  const index = new Map();

  for (const metaFile of metaFiles) {
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    } catch (_) {
      // meta 损坏时跳过，不中断整体扫描
      continue;
    }

    if (typeof meta.uuid !== 'string') continue;

    // 对应的 prefab 路径 = 去掉 .meta 后缀
    const prefabPath = metaFile.replace(/\.meta$/, '');
    index.set(meta.uuid, prefabPath);
  }

  return index;
}

// ─── 公开 API ─────────────────────────────────────────────────

/**
 * 根据路径推断项目根，返回 uuid → prefab 绝对路径 的 Map。
 * 多次调用同一 projectRoot 时，直接返回缓存，不重复扫描。
 *
 * @param {string} startPath  起点路径：可以是宿主 prefab 的绝对路径（从它向上找项目根），
 *                            也可以直接是项目根目录（含 assets/ + package.json）。
 *                            当 filePath 是 /tmp/ 临时文件时，应直接传入项目根目录。
 * @returns {Map<string, string>}
 */
function getUuidIndex(startPath) {
  const projectRoot = _findProjectRoot(startPath);

  if (_cache.has(projectRoot)) {
    return _cache.get(projectRoot);
  }

  const index = _buildIndex(projectRoot);
  _cache.set(projectRoot, index);
  return index;
}

/**
 * 将 uuid 解析为 prefab 磁盘路径（绝对路径）。
 *
 * @param {string} uuid       资产 UUID
 * @param {string} startPath  起点路径（宿主 prefab 路径 或 项目根目录），用于推断项目根
 * @returns {string}  prefab 文件绝对路径
 * @throws  uuid 不存在时抛错
 */
function resolveUuidToPath(uuid, startPath) {
  const index = getUuidIndex(startPath);
  const result = index.get(uuid);

  if (!result) {
    throw new Error(
      `UuidResolver: 找不到 uuid "${uuid}" 对应的 prefab 文件。` +
      `已扫描项目内 ${index.size} 个 prefab。` +
      `请确认该 uuid 对应的 prefab 存在于 assets/ 目录下。`
    );
  }

  return result;
}

/**
 * 清除缓存（测试用，正常使用不需要调用）
 */
function clearCache() {
  _cache.clear();
}

module.exports = { getUuidIndex, resolveUuidToPath, clearCache };
