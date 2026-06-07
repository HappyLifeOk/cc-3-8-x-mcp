// ============================================================
// editor/fix-borders.js — 清理 Cocos 重启/重新导入造成的图片 meta 噪音
//
// 现象（Cocos 重启/重新导入有时发生）：
//   1) 纯 key 顺序/格式变化：如 userData 里 trimType/atlasUuid 等字段被重排位置，
//      值没变，只产生 git diff 噪音。
//   2) 九宫格 border 被重置：subMetas.<hash>.userData.{borderTop,Bottom,Left,Right}
//      被清成 0（九宫格丢失，数据真丢）。
//
// 修复：扫 git 工作区改动的 .meta，逐个对比 git 版本：
//   - 值深度相等（只 key 顺序/格式不同）→ 直接还原成 git 原文，消噪音；
//   - 值不等但只是九宫格 border 被重置成 0 → 用 git 的值精准还原 border；
//     还原后若整体已等于 git（差异仅 border + 顺序）也直接写 git 原文，否则只改 border
//     字段、保留 meta 其它真实改动。
//
// 靠 git 对比拿正确值；git 调用统一带 core.quotePath=false，正确处理中文路径。
// 纯 Node + git，跨平台。供 CLI（fix-borders-cmd）和 MCP tool 共用。
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const BORDER_KEYS = ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'];

function allZero(ud) { return BORDER_KEYS.every(function (b) { return !ud[b]; }); }
function anyNonZero(ud) { return BORDER_KEYS.some(function (b) { return !!ud[b]; }); }

// 深度规范化（递归排序对象 key），用于「忽略 key 顺序」的值比较
function norm(o) {
  if (Array.isArray(o)) return o.map(norm);
  if (o && typeof o === 'object') {
    var r = {};
    Object.keys(o).sort().forEach(function (k) { r[k] = norm(o[k]); });
    return r;
  }
  return o;
}
function valueEqual(a, b) { return JSON.stringify(norm(a)) === JSON.stringify(norm(b)); }

/**
 * 清理被 Cocos 重启搞乱的 .meta（顺序噪音 + 九宫格 border 重置）。
 * @param {string} projectOrRoot 项目路径（git 仓库或其子目录均可）
 * @param {{dryRun?:boolean}} [opts]
 * @returns {{gitRoot, scanned, reorderFiles, borderFiles, borderFrames, details:string[]}}
 */
function fixResetBorders(projectOrRoot, opts) {
  opts = opts || {};
  var dryRun = !!opts.dryRun;

  // 统一带 core.quotePath=false：否则 git 把中文等非 ASCII 路径加引号转义，path.join 会失配
  function git(root, args) {
    return cp.execFileSync('git', ['-C', root, '-c', 'core.quotePath=false'].concat(args),
      { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  }

  var gitRoot;
  try { gitRoot = git(projectOrRoot, ['rev-parse', '--show-toplevel']).trim(); }
  catch (e) { throw new Error('不是 git 仓库（或 git 不可用）: ' + projectOrRoot); }

  var changed = git(gitRoot, ['diff', '--name-only', '--', '*.meta'])
    .split('\n').map(function (s) { return s.trim(); }).filter(Boolean);

  var reorderFiles = 0, borderFiles = 0, borderFrames = 0;
  var details = [];

  for (var i = 0; i < changed.length; i++) {
    var rel = changed[i];
    var abs = path.join(gitRoot, rel);
    if (!fs.existsSync(abs)) continue;

    var workStr, headStr, work, head;
    try { workStr = fs.readFileSync(abs, 'utf8'); work = JSON.parse(workStr); } catch (e) { continue; }
    try { headStr = git(gitRoot, ['show', 'HEAD:' + rel]); head = JSON.parse(headStr); } catch (e) { continue; } // git 里没有（新文件）跳过

    // 1) 纯 key 顺序/格式噪音（值深度相等）→ 还原 git 原文
    if (valueEqual(work, head)) {
      if (!dryRun) fs.writeFileSync(abs, headStr, 'utf8');
      reorderFiles++;
      details.push('[顺序] ' + rel);
      continue;
    }

    // 2) 值不等 → 检查九宫格 border 是否被重置成 0，精准还原
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
      if (allZero(wud) && anyNonZero(hud)) {
        for (var b = 0; b < BORDER_KEYS.length; b++) wud[BORDER_KEYS[b]] = hud[BORDER_KEYS[b]];
        metaChanged = true;
        borderFrames++;
        details.push('[border] ' + rel + ' [' + key + '] → T' + hud.borderTop + '/B' + hud.borderBottom +
          '/L' + hud.borderLeft + '/R' + hud.borderRight);
      }
    }

    if (metaChanged) {
      borderFiles++;
      if (!dryRun) {
        // 还原 border 后若整体已等于 git（差异仅 border + 顺序）→ 直接写 git 原文，最干净；
        // 否则只改了 border 字段、保留其它真实改动 → 按 work 写回（Cocos 标准格式）
        if (valueEqual(work, head)) fs.writeFileSync(abs, headStr, 'utf8');
        else fs.writeFileSync(abs, JSON.stringify(work, null, 2) + '\n', 'utf8');
      }
    }
  }

  return {
    gitRoot: gitRoot, scanned: changed.length,
    reorderFiles: reorderFiles, borderFiles: borderFiles, borderFrames: borderFrames,
    details: details,
  };
}

module.exports = { fixResetBorders: fixResetBorders };
