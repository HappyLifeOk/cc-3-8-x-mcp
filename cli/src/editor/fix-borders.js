// ============================================================
// editor/fix-borders.js — 修复 Cocos 重启把图片九宫格 border 重置成 0 的 meta
//
// 现象：Cocos 重启/重新导入有时把已设九宫格的图 meta 里
//   subMetas.<hash>.userData.{borderTop,borderBottom,borderLeft,borderRight}
//   重置成 0（九宫格丢失）。
//
// 修复：扫 git 工作区改动的 .meta，找出「git 版本 border 非 0、工作区被重置成 0」的，
//   把 git 的 border 值还原回去。靠 git 对比拿正确值，只动 border 四个字段、
//   保留 meta 其它内容；写回用 Cocos 标准格式（2 空格缩进 + 尾随换行）。
//
// 纯 Node + git，跨平台。供 CLI（fix-borders-cmd）和 MCP tool 共用。
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const BORDER_KEYS = ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'];

function git(root, args) {
  return cp.execFileSync('git', ['-C', root].concat(args), {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

// 四个 border 都为 0 / 缺失（被重置的特征）
function allZero(ud) { return BORDER_KEYS.every(function (b) { return !ud[b]; }); }
// 至少一个 border 非 0（git 里有正确九宫格值的特征）
function anyNonZero(ud) { return BORDER_KEYS.some(function (b) { return !!ud[b]; }); }

/**
 * 扫 git 改动的 .meta，还原被 Cocos 重置成 0 的九宫格 border。
 * @param {string} projectOrRoot 项目路径（git 仓库或其子目录均可）
 * @param {{dryRun?:boolean}} [opts]
 * @returns {{gitRoot:string, scanned:number, fixedFiles:number, fixedFrames:number, details:string[]}}
 */
function fixResetBorders(projectOrRoot, opts) {
  opts = opts || {};
  var dryRun = !!opts.dryRun;

  var gitRoot;
  try {
    gitRoot = git(projectOrRoot, ['rev-parse', '--show-toplevel']).trim();
  } catch (e) {
    throw new Error('不是 git 仓库（或 git 不可用）: ' + projectOrRoot);
  }

  var changed = git(gitRoot, ['diff', '--name-only', '--', '*.meta'])
    .split('\n').map(function (s) { return s.trim(); }).filter(Boolean);

  var fixedFiles = 0, fixedFrames = 0;
  var details = [];

  for (var i = 0; i < changed.length; i++) {
    var rel = changed[i];
    var abs = path.join(gitRoot, rel);
    if (!fs.existsSync(abs)) continue;

    var work, head;
    try { work = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { continue; }
    try { head = JSON.parse(git(gitRoot, ['show', 'HEAD:' + rel])); } catch (e) { continue; } // git 里没有（新文件）跳过

    var wSubs = work && work.subMetas;
    var hSubs = head && head.subMetas;
    if (!wSubs || !hSubs || typeof wSubs !== 'object' || typeof hSubs !== 'object') continue;

    var metaChanged = false;
    var keys = Object.keys(wSubs);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var wud = wSubs[key] && wSubs[key].userData;
      var hud = hSubs[key] && hSubs[key].userData;
      if (!wud || !hud) continue;
      if (!BORDER_KEYS.some(function (b) { return b in wud; })) continue;

      // 工作区 border 全 0、git 版本有非 0 → 被重置，还原 git 的值
      if (allZero(wud) && anyNonZero(hud)) {
        for (var b = 0; b < BORDER_KEYS.length; b++) wud[BORDER_KEYS[b]] = hud[BORDER_KEYS[b]];
        metaChanged = true;
        fixedFrames++;
        details.push(rel + ' [' + key + '] → T' + hud.borderTop + '/B' + hud.borderBottom +
          '/L' + hud.borderLeft + '/R' + hud.borderRight);
      }
    }

    if (metaChanged) {
      fixedFiles++;
      if (!dryRun) fs.writeFileSync(abs, JSON.stringify(work, null, 2) + '\n', 'utf8');
    }
  }

  return { gitRoot: gitRoot, scanned: changed.length, fixedFiles: fixedFiles, fixedFrames: fixedFrames, details: details };
}

module.exports = { fixResetBorders: fixResetBorders };
