// ============================================================
// cli/fix-borders-cmd.js — fix-borders 子命令
//
// 用法：
//   cocos-mcp-cli fix-borders [--project <dir>] [--dry-run]
//
// 修复 Cocos 重启把图片九宫格 border（subMetas.*.userData.border*）重置成 0 的 meta：
//   扫 git 改动的 .meta，把「git 里有值、工作区被清 0」的 border 还原成 git 的值。
//   只动 border 字段、保留 meta 其它改动。
//   --dry-run 只预览不写；--project 指定项目路径（默认当前目录）。
// ============================================================

'use strict';

const { fixResetBorders } = require('../editor/fix-borders.js');

function die(msg) { process.stderr.write('Error: ' + msg + '\n'); process.exit(1); }

function cmdFixBorders(argv) {
  let project = process.cwd();
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--project' || a === '-p') {
      project = argv[++i];
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'cocos-mcp-cli fix-borders — 清理 Cocos 重启造成的图片 meta 噪音\n\n' +
        '  --project, -p <dir>   项目路径（git 仓库或其子目录，默认当前目录）\n' +
        '  --dry-run             只预览将还原哪些，不写文件\n\n' +
        '处理两类噪音（都靠 git 对比，正确处理中文路径）：\n' +
        '  1) 纯 key 顺序/格式变化（值没变）→ 还原成 git 原文\n' +
        '  2) 九宫格 border 被重置成 0 → 用 git 的值精准还原\n');
      return;
    } else {
      die('未知参数 "' + a + '"');
    }
  }

  let r;
  try {
    r = fixResetBorders(project, { dryRun: dryRun });
  } catch (e) {
    die(e.message);
  }

  process.stdout.write(
    (dryRun ? '[dry-run] ' : '') +
    '扫描 ' + r.scanned + ' 个改动 meta：顺序噪音还原 ' + r.reorderFiles +
    ' 个，border 还原 ' + r.borderFiles + ' 个 meta / ' + r.borderFrames + ' frame\n');

  if (r.details.length) {
    process.stdout.write(r.details.slice(0, 50).join('\n') + '\n');
    if (r.details.length > 50) process.stdout.write('...（共 ' + r.details.length + ' 处，此处只列前 50）\n');
  }
}

module.exports = { cmdFixBorders };
