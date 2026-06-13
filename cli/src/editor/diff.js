// ============================================================
// editor/diff.js — dry-run 用的 elements 字段级 diff
// 输出：[{ id, type, name, changes: { 'a.b.c': [old, new] } }]
// ============================================================

'use strict';

function computeDiff(before, after) {
  const out = [];
  const maxLen = Math.max(before.length, after.length);
  for (let i = 0; i < maxLen; i++) {
    const a = before[i];
    const b = after[i];
    if (a === undefined && b !== undefined) {
      out.push({ id: i, type: 'added', after: b });
      continue;
    }
    if (a !== undefined && b === undefined) {
      out.push({ id: i, type: 'removed', before: a });
      continue;
    }
    const changes = {};
    diffObject(a, b, '', changes);
    if (Object.keys(changes).length > 0) {
      out.push({
        id: i,
        type: b && b.__type__ ? b.__type__ : null,
        name: b && b._name !== undefined ? b._name : undefined,
        changes,
      });
    }
  }
  return out;
}

function diffObject(a, b, prefix, out) {
  if (a === b) return;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    out[prefix || '<root>'] = [a, b];
    return;
  }
  // 数组长度不同：整数组替换。按 index 递归会把"数组截断/扩展"误报成
  // "该位置变 undefined"，JSON 序列化时 undefined → null，看上去像被置空了
  // 一个 null 槽位（例：[x] → [] 误报成 ".0: [x, null]"）。
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) {
    out[prefix || '<root>'] = [a, b];
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    if (av === bv) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (
      typeof av === 'object' && av !== null &&
      typeof bv === 'object' && bv !== null
    ) {
      diffObject(av, bv, path, out);
    } else {
      out[path] = [av, bv];
    }
  }
}

module.exports = { computeDiff };
