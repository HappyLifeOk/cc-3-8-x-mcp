// set-component-ref: 把节点上指定组件的 @property 字段序列化指向另一节点/组件
// op: { op: 'set-component-ref', node, componentType, property, refNode, refType?, refSubNode? }
//
// - node:          持有目标组件的节点
// - componentType: 目标组件 ccclass 名
// - property:      @property 字段名，支持以下格式：
//     "_role"         → 普通字段，propertyPath: ["_role"]
//     "_items.0"      → 数组字段第 0 项，propertyPath: ["_items", 0]
//     "_items[0]"     → 同上，[] 写法等价
// - refNode:       引用指向的节点（字符串名或 {id:N}）
// - refType:       缺省或 'cc.Node' 表示字段指向节点本身；否则指向 refNode 上该类型的第一个组件
// - refSubNode:    refNode 是 stub 时指定嵌套 prefab 内的子节点名（可选）

'use strict';

const { ref } = require('../../primitives.js');
const { normalizeComponentType, isStub, indexOfNode, resolveNode, findComponent } = require('../helpers.js');
const { resolveLocalIdChain, addRootTargetOverride } = require('../nested.js');

// ─── propertyPath 解析 ────────────────────────────────────────
//
// 把 property 字符串拆成 propertyPath 数组，传给 addRootTargetOverride
// 和 setByPropertyPath，统一用数字表示数组索引（Cocos 引擎序列化格式）。
//
// 例：
//   "_role"     → ["_role"]
//   "_items.0"  → ["_items", 0]
//   "_items[2]" → ["_items", 2]

function parsePropertyPath(property) {
  // [] 下标 → . 分隔：_items[0] → _items.0
  const normalized = property.replace(/\[(\d+)\]/g, '.$1');
  const parts = normalized.split('.').filter(p => p.length > 0);
  return parts.map(p => {
    const n = Number(p);
    // 纯整数字符串（不含前导零的，如 "0" "1" "10"）→ 数字索引
    return Number.isInteger(n) && String(n) === p ? n : p;
  });
}

// ─── 按 propertyPath 多层路径赋值 ─────────────────────────────
//
// 支持数组索引（数字 key）和对象属性（字符串 key）的任意组合。
// 中间层不存在时：下一段是数字 → 创建数组；否则 → 创建对象。

function setByPropertyPath(obj, pathParts, value) {
  if (pathParts.length === 1) {
    obj[pathParts[0]] = value;
    return;
  }
  const head = pathParts[0];
  const tail = pathParts.slice(1);
  if (!obj[head] || typeof obj[head] !== 'object') {
    obj[head] = typeof tail[0] === 'number' ? [] : {};
  }
  setByPropertyPath(obj[head], tail, value);
}

function execSetComponentRef(prefabData, op) {
  const { elements, rootId } = prefabData;
  const {
    node: nodeSelector,
    componentType: rawComponentType,
    property,
    refNode: refNodeSelector,
    refType: rawRefType,
    refSubNode = null,
  } = op;

  if (typeof rawComponentType !== 'string' || rawComponentType.length === 0) {
    throw new Error(`editPrefab [set-component-ref]: componentType 必须是非空字符串`);
  }
  if (typeof property !== 'string' || property.length === 0) {
    throw new Error(`editPrefab [set-component-ref]: property 必须是非空字符串`);
  }
  const componentType = normalizeComponentType(rawComponentType, prefabData.resolverStartPath);
  const refType = rawRefType
    ? normalizeComponentType(rawRefType, prefabData.resolverStartPath)
    : rawRefType;

  // 解析 property 为 propertyPath 数组（支持 "_items.0" / "_items[0]" 数组写法）
  const propertyPath = parsePropertyPath(property);

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'set-component-ref');

  if (isStub(elements, node)) {
    throw new Error(
      `editPrefab [set-component-ref]: 源节点 "${node._name}" 是 stub（嵌套 prefab 代理），` +
      `对 stub 自身组件挂 @property 字段的场景（需要 TargetOverrideInfo.sourceInfo）暂不支持`
    );
  }

  const comp = findComponent(elements, node, componentType);
  if (!comp) {
    throw new Error(`editPrefab [set-component-ref]: 节点 "${node._name}" 未挂 "${componentType}" 组件`);
  }

  const { node: refNode, nodeId: refNodeId } = resolveNode(prefabData, refNodeSelector, 'set-component-ref');

  // refNode 是 stub 代理 → 走 cc.TargetOverrideInfo 跨 nested 挂载
  if (isStub(elements, refNode)) {
    const targetCompType = !refType || refType === 'cc.Node' ? 'cc.Node' : refType;
    const localIdChain = resolveLocalIdChain(
      prefabData.resolverStartPath,
      elements,
      refNodeId,
      targetCompType,
      refSubNode
    );

    const compId = indexOfNode(elements, comp);
    if (compId < 0) {
      throw new Error(`editPrefab [set-component-ref]: 源组件索引失败（内部错误）`);
    }
    // 传入 propertyPath 数组（支持 ["_items", 0] 数组元素挂载）
    addRootTargetOverride(prefabData, rootId, compId, propertyPath, refNodeId, localIdChain);
    return nodeId;
  }

  // 普通节点：按 propertyPath 多层路径赋值（支持数组字段 _items[0]/_items[1]...）
  if (!refType || refType === 'cc.Node') {
    setByPropertyPath(comp, propertyPath, ref(refNodeId));
  } else {
    const refComp = findComponent(elements, refNode, refType);
    if (!refComp) {
      throw new Error(`editPrefab [set-component-ref]: 引用节点 "${refNode._name}" 未挂 "${refType}" 组件`);
    }
    const refCompId = indexOfNode(elements, refComp);
    if (refCompId < 0) {
      throw new Error(`editPrefab [set-component-ref]: 引用组件索引失败（内部错误）`);
    }
    setByPropertyPath(comp, propertyPath, ref(refCompId));
  }

  return nodeId;
}

module.exports = { execSetComponentRef };
