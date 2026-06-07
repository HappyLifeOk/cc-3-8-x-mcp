// ============================================================
// cli/main.js — 子命令分发入口
//
// 用法：
//   cocos-mcp-cli query <prefab> [--selector ...] [--with-comps] ...
//   cocos-mcp-cli set <prefab> <nodeName> <field> <value>
//   cocos-mcp-cli batch <prefab> <ops.json> [--project-root ...] [--dry-run]
// ============================================================

'use strict';

const { printHelp } = require('./help.js');
const { cmdQuery } = require('./query-cmd.js');
const { cmdSet } = require('./set-cmd.js');
const { cmdBatch } = require('./batch-cmd.js');
const { cmdAnim } = require('./anim-cmd.js');
const { cmdDiff } = require('./diff-cmd.js');
const { cmdCreatePrefab } = require('./create-cmd.js');
const { cmdExtractPrefab } = require('./extract-cmd.js');
const { cmdCompactPrefab } = require('./compact-cmd.js');
const { cmdEnsureMeta } = require('./ensure-meta-cmd.js');
const { cmdBuild } = require('./build-cmd.js');
const { cmdFixBorders } = require('./fix-borders-cmd.js');

function die(msg) {
  process.stderr.write('Error: ' + msg + '\n');
  process.exit(1);
}

function main(argv) {
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  if (cmd === 'query') {
    cmdQuery(rest);
  } else if (cmd === 'set') {
    cmdSet(rest);
  } else if (cmd === 'batch') {
    cmdBatch(rest);
  } else if (cmd === 'anim') {
    cmdAnim(rest);
  } else if (cmd === 'diff') {
    cmdDiff(rest);
  } else if (cmd === 'create-prefab') {
    cmdCreatePrefab(rest);
  } else if (cmd === 'extract-prefab') {
    cmdExtractPrefab(rest);
  } else if (cmd === 'compact-prefab') {
    cmdCompactPrefab(rest);
  } else if (cmd === 'ensure-meta') {
    cmdEnsureMeta(rest);
  } else if (cmd === 'build') {
    cmdBuild(rest);
  } else if (cmd === 'fix-borders') {
    cmdFixBorders(rest);
  } else {
    die(`未知子命令 "${cmd}"，可用: query / set / batch / anim / diff / create-prefab / extract-prefab / compact-prefab / ensure-meta / build / fix-borders`);
  }
}

module.exports = { main };
