// dedupe-component: 合并同节点上同语义但重复挂载的组件条目
//
// 背景：cli 若用 className 写入 __type__（如 "GMUI"），而 Cocos 编辑器 reimport
// 时会把 __type__ 规范化为压缩 classId（如 "a57b6RRA21B5I70mCpu1pBP"），
// 在 TS 脚本尚未注册时 @property refs 会被丢弃，造成同节点出现「字符串版 +
// 压缩版」两份组件，其中一份 refs 完整、另一份全 null。本 op 把它们合并成一条。
//
// op: { op: 'dedupe-component', node? }
//   - node: 仅扫指定节点；缺省 → 扫整个 prefab 所有普通节点
//
// 策略：
//   1. 按 normalizeComponentType() 后的 compType 分组
//   2. 同 compType >=2 命中时，选非空 @property 字段最多的作为 keeper
//   3. 把 losers 的非空字段合并进 keeper（keeper 为 null/undefined 才填）
//   4. keeper.__type__ 写成规范化后的 compType
//   5. losers 的 comp idx 和 __prefab CompPrefabInfo idx 进入删除集
//   6. _components 数组过滤被删的引用
//   7. 其他 elements 里 __id__ 指向被删组件的引用映射到 keeper 新 id
//   8. 全部 __id__ 按缩减后的索引重映射 + splice 实际删除
// 限制：stub 节点暂不处理。

'use strict';

const { normalizeComponentType, isStub, resolveNode } = require('../helpers.js');
const {
  countPropertyRefs,
  isReservedCompField,
  filterCompRefsInElements,
  redirectIdsAcrossElements,
  buildShiftMap,
  shiftIdsAcrossElements,
} = require('../id-utils.js');

function execDedupeComponent(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector } = op || {};

  // ── 1. 决定扫哪些节点
  const targets = [];
  if (nodeSelector == null) {
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (el && el.__type__ === 'cc.Node') targets.push({ node: el, nodeId: i });
    }
  } else {
    const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'dedupe-component');
    targets.push({ node, nodeId });
  }

  // ── 2. 逐节点分组，找到所有要合并的 group
  const merges = [];
  const affectedNodes = new Set();

  for (const { node, nodeId } of targets) {
    if (isStub(elements, node)) continue;
    if (!Array.isArray(node._components)) continue;

    const groups = new Map();
    for (const cref of node._components) {
      if (!cref || typeof cref.__id__ !== 'number') continue;
      const comp = elements[cref.__id__];
      if (!comp || typeof comp.__type__ !== 'string') continue;
      const normalized = normalizeComponentType(comp.__type__, prefabData.resolverStartPath);
      if (!groups.has(normalized)) groups.set(normalized, []);
      groups.get(normalized).push({ compId: cref.__id__, comp });
    }

    for (const [normalized, list] of groups.entries()) {
      if (list.length < 2) continue;
      const scored = list.map((x) => ({ ...x, score: countPropertyRefs(x.comp) }));
      scored.sort((a, b) => b.score - a.score || a.compId - b.compId);
      const keeper = scored[0];
      const losers = scored.slice(1);

      for (const loser of losers) {
        for (const [k, v] of Object.entries(loser.comp)) {
          if (isReservedCompField(k)) continue;
          if ((keeper.comp[k] === null || keeper.comp[k] === undefined) && v !== null && v !== undefined) {
            keeper.comp[k] = v;
          }
        }
      }
      keeper.comp.__type__ = normalized;

      merges.push({
        keeperCompId: keeper.compId,
        loserCompIds: losers.map((x) => x.compId),
        normalizedType: normalized,
        nodeId,
      });
      affectedNodes.add(nodeId);
    }
  }

  if (merges.length === 0) return [];

  // ── 3. 收集要删除的 elements id 与「loser→keeper」重定向
  const deleteSet = new Set();
  const redirect = new Map();
  for (const m of merges) {
    for (const loserId of m.loserCompIds) {
      deleteSet.add(loserId);
      redirect.set(loserId, m.keeperCompId);
      const loserComp = elements[loserId];
      const pref = loserComp && loserComp.__prefab;
      if (pref && typeof pref.__id__ === 'number') {
        deleteSet.add(pref.__id__);
      }
    }
  }

  // ── 4. 先把所有节点的 _components / mountedComponents 数组过滤掉被删的引用
  filterCompRefsInElements(elements, deleteSet);

  // ── 5. __id__ 重定向（loser → keeper）
  redirectIdsAcrossElements(elements, redirect);

  // ── 6. 构建 shift 映射 + 执行删除
  const shiftMap = buildShiftMap(elements.length, deleteSet);
  shiftIdsAcrossElements(elements, shiftMap);
  const sortedToDel = Array.from(deleteSet).sort((a, b) => b - a);
  for (const idx of sortedToDel) elements.splice(idx, 1);

  // ── 7. 更新 prefabData.rootId
  if (typeof prefabData.rootId === 'number' && shiftMap[prefabData.rootId] != null) {
    prefabData.rootId = shiftMap[prefabData.rootId];
  }

  return Array.from(affectedNodes).map((id) => shiftMap[id] ?? id);
}

module.exports = { execDedupeComponent };
