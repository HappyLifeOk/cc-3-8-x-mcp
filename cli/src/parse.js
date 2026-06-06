// ============================================================
// CC3 Prefab 解析器（纯 CJS，零三方依赖）
// 读取 prefab JSON → 构建 __id__ 索引 → 暴露查询接口
// ============================================================

'use strict';

const fs = require('fs');

/**
 * 解析 prefab 文件
 *
 * 返回对象结构：
 * {
 *   raw: string,           // 原始文件内容（供 write.js 保留格式用）
 *   elements: object[],    // 顶层数组（原始引用，可直接修改）
 *   rootId: number,        // cc.Prefab data 指向的根节点 __id__
 *   findNodeByName(name),  // 递归按 _name 查首个匹配节点（返回 element）
 *   findNodesByType(type), // 按 __type__ 查所有匹配 element
 *   getRoot(),             // 返回根 cc.Node element
 *   resolveRef(refObj),    // { __id__: N } → element
 * }
 *
 * @param {string} filePath
 * @returns {PrefabData}
 */
function parsePrefab(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let elements;

  try {
    elements = JSON.parse(raw);
  } catch (e) {
    throw new Error(`parsePrefab: JSON 解析失败（${filePath}）: ${e.message}`);
  }

  if (!Array.isArray(elements)) {
    throw new Error(`parsePrefab: 顶层不是数组（${filePath}）`);
  }

  // 构建 __id__ → element 的 O(1) 索引
  // CC3 prefab 数组下标即 __id__，无需额外映射，但封装成函数方便维护
  // 同时校验数组长度
  const idIndex = elements; // 直接按下标访问即可

  // 找 cc.Prefab 资产头（通常在 index 0），取 rootId
  let rootId = -1;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el && typeof el === 'object' && el.__type__ === 'cc.Prefab') {
      if (el.data && typeof el.data.__id__ === 'number') {
        rootId = el.data.__id__;
      }
      break;
    }
  }

  if (rootId < 0) {
    throw new Error(`parsePrefab: 未找到 cc.Prefab 头或 data.__id__（${filePath}）`);
  }

  // ─── 辅助：按 __id__ 解引用 ───────────────────────────────
  function resolveRef(refObj) {
    if (!refObj || typeof refObj.__id__ !== 'number') {
      throw new Error(`resolveRef: 参数不是有效引用对象: ${JSON.stringify(refObj)}`);
    }
    const el = idIndex[refObj.__id__];
    if (el === undefined) {
      throw new Error(`resolveRef: __id__ ${refObj.__id__} 超出数组范围`);
    }
    return el;
  }

  // ─── 辅助：收集节点的所有子节点（递归） ─────────────────
  function _collectChildren(node, visited) {
    if (!node || !Array.isArray(node._children)) return [];
    const result = [];
    for (const childRef of node._children) {
      if (typeof childRef.__id__ !== 'number') continue;
      const id = childRef.__id__;
      if (visited.has(id)) continue; // 防环
      visited.add(id);
      const child = idIndex[id];
      if (child) {
        result.push(child);
        result.push(..._collectChildren(child, visited));
      }
    }
    return result;
  }

  // ─── getRoot ─────────────────────────────────────────────
  function getRoot() {
    return idIndex[rootId];
  }

  // ─── findNodeByName ───────────────────────────────────────
  // 从根节点递归 DFS，返回第一个 _name 匹配的 cc.Node
  function findNodeByName(name) {
    const root = getRoot();
    if (!root) return null;
    return _findByName(root, name, new Set([rootId]));
  }

  function _findByName(node, name, visited) {
    if (node._name === name) return node;
    if (!Array.isArray(node._children)) return null;
    for (const childRef of node._children) {
      if (typeof childRef.__id__ !== 'number') continue;
      const id = childRef.__id__;
      if (visited.has(id)) continue;
      visited.add(id);
      const child = idIndex[id];
      if (!child) continue;
      const found = _findByName(child, name, visited);
      if (found) return found;
    }
    return null;
  }

  // ─── findNodesByType ──────────────────────────────────────
  // 遍历整个数组，按 __type__ 过滤（不限于节点树）
  function findNodesByType(type) {
    return elements.filter(
      (el) => el && typeof el === 'object' && el.__type__ === type
    );
  }

  return {
    raw,
    elements,
    rootId,
    findNodeByName,
    findNodesByType,
    getRoot,
    resolveRef,
  };
}

module.exports = { parsePrefab };
