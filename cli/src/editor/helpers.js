// ============================================================
// editor/helpers.js — 节点定位 / 组件查找 / 类型规范化
// 所有 op handler 共用的低层工具
// ============================================================

'use strict';

const { isCompressedClassId, compressUuid } = require('../id.js');
const { resolveClassIdByName } = require('../classid-resolver.js');

// ─── componentType 规范化 ────────────────────────────────────
//
// cli 允许 op 里用以下三种形式传 componentType：
//   1. @ccclass 名（如 'MyUI'）
//   2. 原始 UUID（如 '5a154a84-89a1-509a-8949-96edd6fb74a2'）
//   3. 压缩 classId（23 字符，已规范化格式，如 '5a154qEiaFQmolJlu3W+3Si'）
//
// 但 Cocos 编辑器序列化 prefab 时会把 __type__ 规范化为压缩 classId。
// 为避免「写入字符串名/原始 UUID → 编辑器 reimport 后规范化 + 清空 refs」的坑，
// 在每个 op 的 handler 开头把 componentType 统一转成压缩 classId。
//
// 规则：
//   - 空/非字符串：原样返回（让 handler 各自报参数错）
//   - 以 'cc.' / 'sp.' / 'dragonBones.' 开头：引擎类，不可能是 className，原样
//   - 已经是 23 字符压缩格式：原样
//   - 原始 UUID 格式（xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx）：压缩为 classId
//   - 其他（视作 @ccclass 名）：扫 assets/scripts 反查 → 压缩 classId
//     找不到时**直接抛错**：cocos 反序列化看到 className 字符串会报 MissingScript，
//     与其降级写入留个坑不如让 cli 当场失败，告诉调用方真实原因（meta 未生成 / class 名拼错 / 没加 @ccclass）。
//
// 这确保 add-component / set-component-ref / remove-component 无论传哪种形式
// 都能 lookup 到同一 __type__ 字符串，避免同 batch 内 add+ref 类型不一致。
const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeComponentType(componentType, resolverStartPath) {
  if (typeof componentType !== 'string' || componentType.length === 0) {
    return componentType;
  }
  if (/^(cc|sp|dragonBones)\./.test(componentType)) return componentType;
  if (isCompressedClassId(componentType)) return componentType;
  // 原始 UUID 格式 → 压缩为 classId，与 @ccclass 名查表结果统一
  if (_UUID_RE.test(componentType)) {
    try { return compressUuid(componentType); } catch (_) {}
  }
  // 视作 @ccclass 名：必须查表得到压缩 classId，否则写入会造成 cocos MissingScript
  if (!resolverStartPath) {
    throw new Error(
      `normalizeComponentType: className "${componentType}" 无法解析——缺少 prefab 路径用于定位项目根。` +
      `\n  通常因 prefab 在项目目录外（如 /tmp/）时未传 --project-root。`
    );
  }
  const classId = resolveClassIdByName(componentType, resolverStartPath);
  if (!classId) {
    throw new Error(
      `normalizeComponentType: className "${componentType}" 在 assets/scripts 下找不到对应 .ts.meta。` +
      `\n  常见原因：` +
      `\n    1) .ts 文件刚新建，cocos 编辑器尚未生成 .ts.meta（等编辑器自动 import 后重跑）；` +
      `\n    2) class 未加 @ccclass('${componentType}') 装饰器；` +
      `\n    3) @ccclass 参数与 className 拼写不一致。`
    );
  }
  return classId;
}

// ─── 判断节点是否是 stub（嵌套 prefab 根节点）────────────────

function isStub(elements, node) {
  if (!node || node.__type__ !== 'cc.Node') return false;
  const prefabRef = node._prefab;
  if (!prefabRef || typeof prefabRef.__id__ !== 'number') return false;
  const prefabInfo = elements[prefabRef.__id__];
  if (!prefabInfo || prefabInfo.__type__ !== 'cc.PrefabInfo') return false;
  const instanceRef = prefabInfo.instance;
  if (!instanceRef || typeof instanceRef.__id__ !== 'number') return false;
  const instance = elements[instanceRef.__id__];
  return !!(instance && instance.__type__ === 'cc.PrefabInstance');
}

// ─── 引用相等查 __id__ ───────────────────────────────────────

function indexOfNode(elements, node) {
  for (let i = 0; i < elements.length; i++) {
    if (elements[i] === node) return i;
  }
  return -1;
}

// ─── 节点定位（按名字串 或 {id:N}）──────────────────────────

function resolveNode(prefabData, nodeSelector, opDesc) {
  const { elements } = prefabData;

  if (typeof nodeSelector === 'string') {
    const node = prefabData.findNodeByName(nodeSelector);
    if (!node) {
      throw new Error(`editPrefab [${opDesc}]: 找不到节点 "${nodeSelector}"`);
    }
    const nodeId = indexOfNode(elements, node);
    if (nodeId < 0) {
      throw new Error(`editPrefab [${opDesc}]: 节点 "${nodeSelector}" 找到但索引失败（内部错误）`);
    }
    return { node, nodeId };
  }

  if (nodeSelector && typeof nodeSelector === 'object') {
    if (typeof nodeSelector.id === 'number') {
      const nodeId = nodeSelector.id;
      const node = elements[nodeId];
      if (!node || node.__type__ !== 'cc.Node') {
        throw new Error(`editPrefab [${opDesc}]: __id__ ${nodeId} 不是有效 cc.Node`);
      }
      return { node, nodeId };
    }
    if (typeof nodeSelector.path === 'string' && nodeSelector.path.length > 0) {
      return resolveNodeByPath(prefabData, nodeSelector.path, opDesc);
    }
  }

  throw new Error(
    `editPrefab [${opDesc}]: node 参数必须是字符串名称、{ id: N } 或 { path: 'A/B/C' }，收到: ${JSON.stringify(nodeSelector)}`
  );
}

// 按路径定位节点（DOM-like）
//   path 形如 "Canvas/Main/itemList"，从根节点开始按 _name 逐级下钻
//   每段必须命中 _children 中某个节点的 _name
//   遇到 stub 节点时不下钻（stub _name 在 propertyOverrides 里，超出 cli 范围）
function resolveNodeByPath(prefabData, pathStr, opDesc) {
  const { elements, rootId, getRoot } = prefabData;
  const segments = pathStr.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error(`editPrefab [${opDesc}]: path 段为空`);
  }

  let curId = rootId;
  let cur = getRoot();
  // 第一段对齐根节点名（如 "Canvas"），允许省略
  if (cur._name === segments[0]) {
    segments.shift();
  }

  for (const seg of segments) {
    if (!Array.isArray(cur._children)) {
      throw new Error(`editPrefab [${opDesc}]: path "${pathStr}" 在节点 "${cur._name}" 下没有子节点，无法继续下钻到 "${seg}"`);
    }
    const matches = [];
    for (const cref of cur._children) {
      if (typeof cref.__id__ !== 'number') continue;
      const child = elements[cref.__id__];
      if (child && child._name === seg) {
        matches.push(cref.__id__);
      }
    }
    if (matches.length === 0) {
      throw new Error(`editPrefab [${opDesc}]: path "${pathStr}" 在 "${cur._name}" 下找不到子节点 "${seg}"`);
    }
    if (matches.length > 1) {
      // 同名子节点 path 无法消歧，强制报错而非静默取首个
      throw new Error(
        `editPrefab [${opDesc}]: path "${pathStr}" 在 "${cur._name}" 下有 ${matches.length} 个同名子节点 "${seg}"（__id__: ${matches.join(', ')}），` +
        `path 选择器无法消歧。请改用 {id: N} 精确定位，或对父节点用 path、对该层用 id 组合`
      );
    }
    curId = matches[0];
    cur = elements[curId];
  }

  return { node: cur, nodeId: curId };
}

// ─── 找节点上指定类型的组件 ──────────────────────────────────

function findComponent(elements, node, compType) {
  if (!Array.isArray(node._components)) return null;
  for (const compRef of node._components) {
    if (typeof compRef.__id__ !== 'number') continue;
    const comp = elements[compRef.__id__];
    if (comp && comp.__type__ === compType) return comp;
  }
  return null;
}

// ─── 找根节点的 PrefabInfo（持有 nestedPrefabInstanceRoots / targetOverrides）──

function findRootPrefabInfo(elements, rootNodeId) {
  // 根节点直接持有其 PrefabInfo 的引用——沿 rootNode._prefab.__id__ 跳一步即可。
  // 不遍历：prefab 内每个节点都有自己的 PrefabInfo（root/__id__ 均指向根节点），
  // 迭代会优先命中遇到的第一个非根节点 PrefabInfo，导致 targetOverrides 写错位置。
  const rootNode = elements[rootNodeId];
  if (!rootNode || rootNode.__type__ !== 'cc.Node') return null;
  const prefabRef = rootNode._prefab;
  if (!prefabRef || typeof prefabRef.__id__ !== 'number') return null;
  const pi = elements[prefabRef.__id__];
  if (!pi || pi.__type__ !== 'cc.PrefabInfo') return null;
  if (pi.instance !== null && pi.instance !== undefined) return null;
  return pi;
}

module.exports = {
  normalizeComponentType,
  isStub,
  indexOfNode,
  resolveNode,
  findComponent,
  findRootPrefabInfo,
};
