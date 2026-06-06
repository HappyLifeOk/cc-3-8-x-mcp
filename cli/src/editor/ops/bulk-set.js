// bulk-set: 按 selector 找一批节点，统一改字段（一条 op 顶 N 条）
// op: { op:'bulk-set', selector, target, property, value }
//
// selector：节点筛选条件
//   { byComponent: 'cc.Label' }       → 所有挂 cc.Label 的节点
//   { byNamePrefix: 'btn' }           → 所有 _name 以 'btn' 开头的节点
//   { byNameRegex: '^icon_\\d+$' }    → 正则匹配
//   多条件并存为 AND
//
// target：要改的对象层
//   'node'         → 改节点字段，如 _active / _name
//   'component:<T>' → 改节点上 type=T 的组件字段（每个匹配节点都得有这个组件，否则跳过）
//
// property：字符串或字符串数组（嵌套路径）
// value：写入值
//
// 行为：
// - 匹配 0 个不算错（返回 [] 但 opsApplied 仍 +1）
// - stub 节点跳过（bulk-set 不处理 stub，避免不同代码路径混用）
// - 返回所有受影响的 nodeId 数组（editPrefab 主循环会聚合到 affectedNodes）

'use strict';

const { isStub, findComponent } = require('../helpers.js');

function _matchSelector(elements, node, selector) {
  if (selector.byComponent) {
    if (!findComponent(elements, node, selector.byComponent)) return false;
  }
  if (selector.byNamePrefix) {
    if (typeof node._name !== 'string' || !node._name.startsWith(selector.byNamePrefix)) return false;
  }
  if (selector.byNameRegex) {
    if (typeof node._name !== 'string') return false;
    const re = new RegExp(selector.byNameRegex);
    if (!re.test(node._name)) return false;
  }
  return true;
}

function _setNested(obj, path, value) {
  if (typeof path === 'string') {
    obj[path] = value;
    return;
  }
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (cur[k] === null || cur[k] === undefined || typeof cur[k] !== 'object') {
      throw new Error(
        `bulk-set: 路径 ${path.slice(0, i + 1).join('.')} 不是对象（${JSON.stringify(cur[k])}），无法继续下钻`
      );
    }
    cur = cur[k];
  }
  cur[path[path.length - 1]] = value;
}

function execBulkSet(prefabData, op) {
  const { elements } = prefabData;
  const { selector, target, property, value } = op;

  if (!selector || typeof selector !== 'object' || Object.keys(selector).length === 0) {
    throw new Error(`editPrefab [bulk-set]: selector 必须是非空对象`);
  }
  if (typeof target !== 'string' || target.length === 0) {
    throw new Error(`editPrefab [bulk-set]: target 必须是 'node' 或 'component:<Type>'`);
  }
  if (
    !(typeof property === 'string' && property.length > 0) &&
    !(Array.isArray(property) && property.length > 0 && property.every((p) => typeof p === 'string'))
  ) {
    throw new Error(`editPrefab [bulk-set]: property 必须是非空字符串或字符串数组`);
  }
  if (value === undefined) {
    throw new Error(`editPrefab [bulk-set]: value 不能是 undefined`);
  }

  let targetKind = target;
  let targetCompType = null;
  if (target.startsWith('component:')) {
    targetCompType = target.slice('component:'.length);
    if (targetCompType.length === 0) {
      throw new Error(`editPrefab [bulk-set]: target='component:' 后必须跟组件类型`);
    }
    targetKind = 'component';
  } else if (target !== 'node') {
    throw new Error(`editPrefab [bulk-set]: target 必须是 'node' 或 'component:<Type>'，收到 "${target}"`);
  }

  const affected = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || el.__type__ !== 'cc.Node') continue;
    if (isStub(elements, el)) continue;
    if (!_matchSelector(elements, el, selector)) continue;

    if (targetKind === 'node') {
      _setNested(el, property, value);
    } else {
      const comp = findComponent(elements, el, targetCompType);
      if (!comp) continue; // 节点匹配但没这个组件，跳过
      _setNested(comp, property, value);
    }
    affected.push(i);
  }

  // 至少返回一个 id 让 affectedNodes 不报错（即使 0 匹配也不算 op fail）
  return affected.length > 0 ? affected[0] : -1;
}

module.exports = { execBulkSet };
