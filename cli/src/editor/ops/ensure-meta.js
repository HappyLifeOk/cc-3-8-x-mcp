// ensure-meta: 给指定 .ts / .json 文件创建 .meta（如果不存在）
// op: { op:'ensure-meta', path }
//
// 用途：新建 .ts / .ctrl.json 后 cocos 编辑器尚未生成 .meta，但 cli 后续要用
// className → classId 查表（add-component 等）。这时在 add-component 之前插一条
// ensure-meta，主动写一个标准 .meta（v4 uuid + 按扩展名选模板），让 cli 当场能查到表，
// 而不必等 cocos 编辑器异步 import。
//
// 路径规则：path 是绝对路径，或相对项目根（如 'assets/scripts/.../X.ts'）。
// 已存在 .meta 时幂等不动。
// dry-run 时不写盘（让 --dry-run 语义一致）。

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { clearCache } = require('../../classid-resolver.js');

function _v4Uuid() {
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;  // version 4
  b[8] = (b[8] & 0x3f) | 0x80;  // variant 10
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const _META_TEMPLATES = {
  '.ts': (uuid) => ({
    ver: '4.0.24',
    importer: 'typescript',
    imported: true,
    uuid,
    files: [],
    subMetas: {},
    userData: { simulateGlobals: [] },
  }),
  '.json': (uuid) => ({
    ver: '2.0.1',
    importer: 'json',
    imported: true,
    uuid,
    files: ['.json'],
    subMetas: {},
    userData: {},
  }),
};

function _resolveProjectRoot(startPath) {
  let dir = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'assets'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function execEnsureMeta(prefabData, op) {
  if (typeof op.path !== 'string' || op.path.length === 0) {
    throw new Error("ensure-meta: 缺必填字段 'path'");
  }

  let filePath = op.path;
  if (!path.isAbsolute(filePath)) {
    const projectRoot = _resolveProjectRoot(prefabData.resolverStartPath);
    if (!projectRoot) {
      throw new Error(
        `ensure-meta: 无法定位项目根（含 assets/+package.json），请用绝对 path`
      );
    }
    filePath = path.resolve(projectRoot, op.path);
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`ensure-meta: 文件不存在: ${filePath}`);
  }

  const metaPath = filePath + '.meta';
  if (fs.existsSync(metaPath)) {
    // 幂等：已存在不动
    return -1;
  }

  const ext = path.extname(filePath).toLowerCase();
  const template = _META_TEMPLATES[ext];
  if (!template) {
    throw new Error(
      `ensure-meta: 不支持的文件扩展名 "${ext}"（当前支持: ${Object.keys(_META_TEMPLATES).join(' / ')}）`
    );
  }

  if (prefabData.dryRun) {
    // dry-run 模式不落盘
    return -1;
  }

  const meta = template(_v4Uuid());
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  // 同 batch 后续 op（如 add-component）会调 resolveClassIdByName 查表，
  // resolver 有进程内 cache，必须 invalidate 让下次重扫覆盖新建的 meta
  clearCache();
  return -1;
}

module.exports = { execEnsureMeta };
