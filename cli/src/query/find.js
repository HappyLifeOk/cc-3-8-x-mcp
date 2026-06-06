// query/find.js — 按 __type__ 列出所有匹配 element 的 id

'use strict';

function queryFind(prefabData, nodeType) {
  const { elements } = prefabData;
  const ids = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el && typeof el === 'object' && el.__type__ === nodeType) {
      ids.push(i);
    }
  }
  return ids;
}

module.exports = { queryFind };
