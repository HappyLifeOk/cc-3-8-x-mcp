// ============================================================
// cli/ensure-meta-cmd.js — ensure-meta 子命令
//
// 用法：
//   cocos-mcp-cli ensure-meta <file-path> [--dry-run]
//
// 若目标文件已有同名 .meta → 跳过（幂等）。
// 若没有 .meta → 按扩展名生成对应格式的 .meta 文件。
//
// 支持的文件类型：
//   .ts / .js  → typescript importer（ver 4.0.24）
//   .json      → json importer（ver 2.0.1）
//
// 典型场景：新建脚本后 Cocos 编辑器未就绪时，先手动补 .meta。
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function die(msg) {
  process.stderr.write('Error: ' + msg + '\n');
  process.exit(1);
}

function makeMeta(ext, uuid) {
  if (ext === '.ts' || ext === '.js') {
    return {
      ver: '4.0.24',
      importer: 'typescript',
      imported: true,
      uuid,
      files: [],
      subMetas: {},
      userData: {},
    };
  }
  if (ext === '.json') {
    return {
      ver: '2.0.1',
      importer: 'json',
      imported: true,
      uuid,
      files: ['.json'],
      subMetas: {},
      userData: {},
    };
  }
  return null;
}

function cmdEnsureMeta(argv) {
  let filePath = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (!arg.startsWith('--')) {
      if (filePath !== null) die('多余的位置参数: ' + arg);
      filePath = arg;
    } else {
      die(`未知参数 "${arg}"`);
    }
  }

  if (!filePath) {
    die('用法: ensure-meta <file-path> [--dry-run]\n支持类型: .ts .js .json');
  }

  if (!fs.existsSync(filePath)) {
    die(`文件不存在: ${filePath}`);
  }

  const metaPath = filePath + '.meta';
  if (fs.existsSync(metaPath)) {
    process.stdout.write(`skip (already exists): ${metaPath}\n`);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const meta = makeMeta(ext, randomUUID());
  if (!meta) {
    die(`不支持的文件类型 "${ext}"，支持: .ts .js .json`);
  }

  if (dryRun) {
    process.stdout.write(JSON.stringify(meta, null, 2) + '\n');
    return;
  }

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  process.stdout.write(`created: ${metaPath}\n`);
}

module.exports = { cmdEnsureMeta };
