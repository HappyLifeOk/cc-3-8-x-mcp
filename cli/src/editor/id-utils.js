// ============================================================
// editor/id-utils.js — fileId 分配 / 子树断开 / __id__ 重映射
//
// 用于 add-node / clone-node / remove-node / dedupe-component 共用：
//   - fileId 唯一性（deterministic + 冲突检测）
//   - 删节点时递归断开 _parent
//   - 删 elements 后所有 __id__ 引用收缩
// ============================================================

'use strict';

const { createFileIdGenerator } = require('../id.js');

// ─── 收集 elements 中所有现有 fileId ─────────────────────────

/**
 * 遍历 elements，收集所有 cc.PrefabInfo / cc.CompPrefabInfo / cc.PrefabInstance 的 fileId。
 * @param {object[]} elements
 * @returns {Set<string>}
 */
function collectExistingFileIds(elements) {
  const ids = new Set();
  for (const el of elements) {
    if (!el) continue;
    if (
      (el.__type__ === 'cc.PrefabInfo' ||
        el.__type__ === 'cc.CompPrefabInfo' ||
        el.__type__ === 'cc.PrefabInstance') &&
      typeof el.fileId === 'string' &&
      el.fileId.length > 0
    ) {
      ids.add(el.fileId);
    }
  }
  return ids;
}

/**
 * 生成不与 existingIds 冲突的 fileId。
 * 先用 baseSeed 生成，若冲突则追加 #1、#2 … 直到不冲突。
 * deterministic：相同 baseSeed + 相同现有集合 → 相同结果。
 */
function uniqueFileId(baseSeed, existingIds) {
  let candidate = createFileIdGenerator(baseSeed)();
  if (!existingIds.has(candidate)) {
    existingIds.add(candidate);
    return candidate;
  }
  let counter = 1;
  while (true) {
    candidate = createFileIdGenerator(`${baseSeed}#${counter}`)();
    if (!existingIds.has(candidate)) {
      existingIds.add(candidate);
      return candidate;
    }
    counter++;
  }
}

// ─── 断开子树（remove-node 用）────────────────────────────────

/**
 * 递归断开子树中所有节点及其关联对象的 _parent 引用（置 null）。
 * 元素本身保留在数组，只让它们成为真正的孤儿。
 */
function disconnectSubtree(elements, nodeId) {
  const node = elements[nodeId];
  if (!node || node.__type__ !== 'cc.Node') return;

  if (Array.isArray(node._children)) {
    for (const childRef of node._children) {
      if (typeof childRef.__id__ === 'number') {
        disconnectSubtree(elements, childRef.__id__);
      }
    }
  }

  node._parent = null;

  if (node._prefab && typeof node._prefab.__id__ === 'number') {
    const pi = elements[node._prefab.__id__];
    if (pi && pi.__type__ === 'cc.PrefabInfo') {
      pi._parent = null;

      if (pi.instance && typeof pi.instance.__id__ === 'number') {
        const prefabInst = elements[pi.instance.__id__];
        if (prefabInst && prefabInst.__type__ === 'cc.PrefabInstance') {
          if (Array.isArray(prefabInst.mountedChildren)) {
            for (const mcRef of prefabInst.mountedChildren) {
              if (typeof mcRef.__id__ === 'number') {
                disconnectSubtree(elements, mcRef.__id__);
              }
            }
            prefabInst.mountedChildren = [];
          }
          prefabInst.propertyOverrides = [];
          if (Array.isArray(prefabInst.mountedComponents)) {
            prefabInst.mountedComponents = [];
          }
          pi.instance = null;
        }
      }
    }
  }

  if (Array.isArray(node._components)) {
    for (const compRef of node._components) {
      if (typeof compRef.__id__ !== 'number') continue;
      const comp = elements[compRef.__id__];
      if (!comp) continue;
      comp._parent = null;
      if (comp.__prefab && typeof comp.__prefab.__id__ === 'number') {
        const cpi = elements[comp.__prefab.__id__];
        if (cpi && cpi.__type__ === 'cc.CompPrefabInfo') {
          cpi._parent = null;
        }
      }
    }
  }
}

// ─── elements 重排：__id__ 引用映射 / 收缩 ───────────────────
//
// 用于 dedupe-component：合并删除组件后，所有 __id__ 指向被删/被合并对象的
// 引用要重定向到 keeper 或按缩减后的下标 shift。

/** @property 字段非 null 计数（粗略打分，挑 keeper） */
function countPropertyRefs(comp) {
  let n = 0;
  for (const [k, v] of Object.entries(comp)) {
    if (isReservedCompField(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      n++;
    }
  }
  return n;
}

/** 合并时不触碰的核心字段 */
function isReservedCompField(key) {
  return (
    key === '__type__' ||
    key === '_name' ||
    key === '_objFlags' ||
    key === '__editorExtras__' ||
    key === 'node' ||
    key === '_enabled' ||
    key === '__prefab' ||
    key === '_id'
  );
}

/** 所有节点的 _components / mountedComponents 去掉指向 deleteSet 的 ref */
function filterCompRefsInElements(elements, deleteSet) {
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;
    if (Array.isArray(el._components)) {
      el._components = el._components.filter(
        (r) => !(r && typeof r.__id__ === 'number' && deleteSet.has(r.__id__))
      );
    }
    if (Array.isArray(el.mountedComponents)) {
      el.mountedComponents = el.mountedComponents.filter(
        (r) => !(r && typeof r.__id__ === 'number' && deleteSet.has(r.__id__))
      );
    }
  }
}

/** 把所有 __id__ 指向 redirect.keys 的 ref 改成指向 redirect.get(...) */
function redirectIdsAcrossElements(elements, redirect) {
  if (redirect.size === 0) return;
  const visit = (obj) => {
    if (obj === null || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const v of obj) visit(v);
      return;
    }
    if (typeof obj.__id__ === 'number' && redirect.has(obj.__id__)) {
      obj.__id__ = redirect.get(obj.__id__);
    }
    for (const k of Object.keys(obj)) visit(obj[k]);
  };
  visit(elements);
}

function buildShiftMap(total, deleteSet) {
  const map = new Array(total);
  let removed = 0;
  for (let i = 0; i < total; i++) {
    if (deleteSet.has(i)) {
      map[i] = null;
      removed++;
    } else {
      map[i] = i - removed;
    }
  }
  return map;
}

function shiftIdsAcrossElements(elements, shiftMap) {
  const visit = (obj) => {
    if (obj === null || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const v of obj) visit(v);
      return;
    }
    if (typeof obj.__id__ === 'number') {
      const nv = shiftMap[obj.__id__];
      if (nv != null) obj.__id__ = nv;
    }
    for (const k of Object.keys(obj)) visit(obj[k]);
  };
  visit(elements);
}

// ─── 清理根 PrefabInfo.targetOverrides 中悬空条目 ─────────────
//
// 从根 PrefabInfo.targetOverrides 移除 source/target 落入 removedIds 的条目。
// 被移除的 cc.TargetOverrideInfo / cc.TargetInfo 对象本身保留为孤儿
// （软删策略，保持其他 __id__ 稳定）。
//
// 调用方：
//   - remove-node：删 stub 后清「外层脚本 → stub 内部组件/节点」的悬空 override
//   - remove-component：删组件后清「该组件 → 嵌套 stub 内部组件/节点」的悬空 override
//
// 不传 removedIds 则不做任何事；rootId 必须传（指向根 cc.Node 在 elements 数组中的 __id__）。
function cleanupRootTargetOverrides(elements, rootId, removedIds) {
  if (!removedIds || removedIds.size === 0) return;
  const rootNode = elements[rootId];
  if (!rootNode || !rootNode._prefab || typeof rootNode._prefab.__id__ !== 'number') return;
  const rootPrefabInfo = elements[rootNode._prefab.__id__];
  if (!rootPrefabInfo || rootPrefabInfo.__type__ !== 'cc.PrefabInfo') return;
  if (!Array.isArray(rootPrefabInfo.targetOverrides)) return;

  rootPrefabInfo.targetOverrides = rootPrefabInfo.targetOverrides.filter((ref) => {
    if (!ref || typeof ref.__id__ !== 'number') return false;
    const ov = elements[ref.__id__];
    if (!ov) return false;
    const t = ov.target;
    const s = ov.source;
    if (t && typeof t.__id__ === 'number' && removedIds.has(t.__id__)) return false;
    if (s && typeof s.__id__ === 'number' && removedIds.has(s.__id__)) return false;
    return true;
  });
}

// ─── 同步根 PrefabInfo.nestedPrefabInstanceRoots ─────────────
//
// 重建根节点 PrefabInfo.nestedPrefabInstanceRoots = 当前所有「有父 + 有 PrefabInfo +
// PrefabInfo.instance 指向 cc.PrefabInstance」的嵌套 stub 节点 __id__。
//
// 调用方：
//   - remove-node：软删 stub 后，被删节点 _parent 已置 null，扫描时自动出局，
//     其登记从 nestedPrefabInstanceRoots 剔除。
//   - sync-nested-roots op：单独修「删了一半」残留的悬空嵌套实例根（父引用已被移除
//     但根 PrefabInfo 登记残留 → 残留 asset 仍被当依赖加载）。
function syncNestedRoots(elements, rootId) {
  const rootNode = elements[rootId];
  if (!rootNode || !rootNode._prefab) return;
  const rootPrefabInfo = elements[rootNode._prefab.__id__];
  if (!rootPrefabInfo || rootPrefabInfo.__type__ !== 'cc.PrefabInfo') return;
  const stubIds = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || el.__type__ !== 'cc.Node') continue;
    if (!el._parent || typeof el._parent.__id__ !== 'number') continue;
    if (!el._prefab || typeof el._prefab.__id__ !== 'number') continue;
    const pi = elements[el._prefab.__id__];
    if (!pi || pi.__type__ !== 'cc.PrefabInfo') continue;
    if (!pi.instance) continue;
    const inst = elements[pi.instance.__id__];
    if (!inst || inst.__type__ !== 'cc.PrefabInstance') continue;
    stubIds.push(i);
  }
  rootPrefabInfo.nestedPrefabInstanceRoots = stubIds.map((id) => ({ __id__: id }));
}

module.exports = {
  collectExistingFileIds,
  uniqueFileId,
  disconnectSubtree,
  countPropertyRefs,
  isReservedCompField,
  filterCompRefsInElements,
  redirectIdsAcrossElements,
  buildShiftMap,
  shiftIdsAcrossElements,
  cleanupRootTargetOverrides,
  syncNestedRoots,
};
