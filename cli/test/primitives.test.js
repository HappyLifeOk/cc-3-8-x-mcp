'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  vec3, vec2, ccSize, ccColor, ref,
  makeNode, makeUITransform, makeSprite, makeLabel, makeWidget,
  makePrefabInfo, makeCompPrefabInfo, makePrefabRoot,
} = require('../src/primitives.js');

// ─── 基础类型工厂 ─────────────────────────────────────────────────

test('vec3 - 默认 z=0', () => {
  const v = vec3(1, 2);
  assert.equal(v.__type__, 'cc.Vec3');
  assert.equal(v.x, 1);
  assert.equal(v.y, 2);
  assert.equal(v.z, 0);
});

test('vec2 - 结构正确', () => {
  const v = vec2(0.5, 0.5);
  assert.equal(v.__type__, 'cc.Vec2');
  assert.equal(v.x, 0.5);
  assert.equal(v.y, 0.5);
});

test('ccSize - 结构正确', () => {
  const s = ccSize(100, 200);
  assert.equal(s.__type__, 'cc.Size');
  assert.equal(s.width, 100);
  assert.equal(s.height, 200);
});

test('ccColor - 默认 a=255', () => {
  const c = ccColor(255, 0, 0);
  assert.equal(c.__type__, 'cc.Color');
  assert.equal(c.r, 255);
  assert.equal(c.g, 0);
  assert.equal(c.b, 0);
  assert.equal(c.a, 255);
});

test('ref - 结构正确', () => {
  const r = ref(5);
  assert.deepEqual(r, { __id__: 5 });
});

// ─── makeNode ─────────────────────────────────────────────────────

test('makeNode - 最小参数', () => {
  const node = makeNode({ name: 'TestNode' });
  assert.equal(node.__type__, 'cc.Node');
  assert.equal(node._name, 'TestNode');
  assert.equal(node._active, true);
  assert.equal(node._layer, 33554432);
  assert.equal(node._parent, null);
  assert.deepEqual(node._children, []);
  assert.deepEqual(node._components, []);
  assert.equal(node._prefab, null);
  assert.deepEqual(node._lpos, { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 });
  assert.deepEqual(node._lscale, { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 });
  assert.equal(node._id, '');
});

test('makeNode - 完整参数', () => {
  const node = makeNode({
    name: 'ChildNode',
    pos: [10, -20, 0],
    scale: [2, 2, 1],
    active: false,
    parentId: 1,
    childIds: [3, 4],
    componentIds: [5, 6],
    prefabId: 7,
  });
  assert.equal(node._parent.__id__, 1);
  assert.deepEqual(node._children, [{ __id__: 3 }, { __id__: 4 }]);
  assert.deepEqual(node._components, [{ __id__: 5 }, { __id__: 6 }]);
  assert.equal(node._prefab.__id__, 7);
  assert.equal(node._lpos.x, 10);
  assert.equal(node._lpos.y, -20);
  assert.equal(node._active, false);
  assert.equal(node._lscale.x, 2);
});

test('makeNode - _lrot 是单位四元数', () => {
  const node = makeNode({ name: 'N' });
  const r = node._lrot;
  assert.equal(r.__type__, 'cc.Quat');
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
  assert.equal(r.z, 0);
  assert.equal(r.w, 1);
});

// ─── makeUITransform ──────────────────────────────────────────────

test('makeUITransform - 基础结构', () => {
  const uit = makeUITransform({ nodeId: 2, width: 300, height: 150 });
  assert.equal(uit.__type__, 'cc.UITransform');
  assert.equal(uit._name, '');
  assert.equal(uit._objFlags, 0);
  assert.deepEqual(uit.__editorExtras__, {});
  assert.equal(uit._enabled, true);
  assert.equal(uit._id, '');
  assert.equal(uit.node.__id__, 2);
  assert.deepEqual(uit._contentSize, { __type__: 'cc.Size', width: 300, height: 150 });
  assert.deepEqual(uit._anchorPoint, { __type__: 'cc.Vec2', x: 0.5, y: 0.5 });
  assert.ok(!('__prefab' in uit), '__prefab 在 prefabInfoId=null 时不应出现');
});

test('makeUITransform - 自定义锚点和 prefabInfoId', () => {
  const uit = makeUITransform({ nodeId: 3, width: 100, height: 50, anchor: [0, 1], prefabInfoId: 9 });
  assert.equal(uit._anchorPoint.x, 0);
  assert.equal(uit._anchorPoint.y, 1);
  assert.equal(uit.__prefab.__id__, 9);
});

// ─── makeSprite ───────────────────────────────────────────────────

test('makeSprite - 无图时 spriteFrame 为 null', () => {
  const sprite = makeSprite({ nodeId: 2 });
  assert.equal(sprite.__type__, 'cc.Sprite');
  assert.equal(sprite._name, '');
  assert.equal(sprite._objFlags, 0);
  assert.deepEqual(sprite.__editorExtras__, {});
  assert.equal(sprite._enabled, true);
  assert.equal(sprite._customMaterial, null);
  assert.equal(sprite._srcBlendFactor, 2);
  assert.equal(sprite._dstBlendFactor, 4);
  assert.equal(sprite._sizeMode, 0);
  assert.equal(sprite._atlas, null);
  assert.equal(sprite._id, '');
  assert.equal(sprite._spriteFrame, null);
  assert.equal(sprite._type, 0);
  assert.equal(sprite._isTrimmedMode, true);
  assert.equal(sprite.node.__id__, 2);
});

test('makeSprite - 有 uuid 时 spriteFrame 有 expectedType', () => {
  const uuid = 'abc123-uuid@f9941';
  const sprite = makeSprite({ nodeId: 3, spriteFrameUuid: uuid });
  assert.equal(sprite._spriteFrame.__uuid__, uuid);
  assert.equal(sprite._spriteFrame.__expectedType__, 'cc.SpriteFrame');
});

test('makeSprite - 颜色参数生效', () => {
  const sprite = makeSprite({ nodeId: 4, color: [255, 128, 0, 200] });
  assert.equal(sprite._color.r, 255);
  assert.equal(sprite._color.g, 128);
  assert.equal(sprite._color.b, 0);
  assert.equal(sprite._color.a, 200);
});

// ─── makeLabel ────────────────────────────────────────────────────

test('makeLabel - 默认值', () => {
  const label = makeLabel({ nodeId: 5 });
  assert.equal(label.__type__, 'cc.Label');
  assert.equal(label._name, '');
  assert.equal(label._objFlags, 0);
  assert.deepEqual(label.__editorExtras__, {});
  assert.equal(label._enabled, true);
  assert.equal(label._customMaterial, null);
  assert.equal(label._srcBlendFactor, 2);
  assert.equal(label._dstBlendFactor, 4);
  assert.equal(label._id, '');
  assert.equal(label._string, '');
  assert.equal(label._fontSize, 20);
  assert.equal(label._horizontalAlign, 1);
  assert.equal(label._verticalAlign, 1);
  assert.equal(label._overflow, 0);
  assert.equal(label._font, null);
  assert.equal(label._isSystemFontUsed, true);
  assert.equal(label._enableOutline, false);
  assert.equal(label.node.__id__, 5);
});

test('makeLabel - 不含 shadow 字段', () => {
  const label = makeLabel({ nodeId: 5 });
  assert.ok(!('_enableShadow' in label), '_enableShadow 不应存在');
  assert.ok(!('_shadowColor' in label), '_shadowColor 不应存在');
  assert.ok(!('_shadowOffset' in label), '_shadowOffset 不应存在');
  assert.ok(!('_shadowBlur' in label), '_shadowBlur 不应存在');
  assert.ok(!('_spacingX' in label), '_spacingX 不应存在');
  assert.ok(!('_underlineHeight' in label), '_underlineHeight 不应存在');
});

test('makeLabel - 自定义字符串和字号', () => {
  const label = makeLabel({ nodeId: 6, string: 'Hello', fontSize: 36 });
  assert.equal(label._string, 'Hello');
  assert.equal(label._fontSize, 36);
  assert.equal(label._actualFontSize, 36);
});

test('makeLabel - 字体 uuid 设置时 isSystemFontUsed=false', () => {
  const label = makeLabel({ nodeId: 7, fontUuid: 'font-uuid-123' });
  assert.ok(label._font !== null);
  assert.equal(label._font.__uuid__, 'font-uuid-123');
  assert.equal(label._isSystemFontUsed, false);
});

test('makeLabel - 描边参数', () => {
  const label = makeLabel({
    nodeId: 8,
    enableOutline: true,
    outlineColor: [255, 0, 0, 255],
    outlineWidth: 4,
  });
  assert.equal(label._enableOutline, true);
  assert.equal(label._outlineColor.r, 255);
  assert.equal(label._outlineWidth, 4);
});

// ─── makeWidget ───────────────────────────────────────────────────

test('makeWidget - 默认值', () => {
  const widget = makeWidget({ nodeId: 2 });
  assert.equal(widget.__type__, 'cc.Widget');
  // 通用字段（与 cc.Sprite / cc.UITransform 对齐）
  assert.equal(widget._name, '');
  assert.equal(widget._objFlags, 0);
  assert.deepEqual(widget.__editorExtras__, {});
  assert.equal(widget._enabled, true);
  assert.equal(widget._id, '');
  // node 不在末尾：应出现在 _enabled 之前（key 顺序检查）
  const keys = Object.keys(widget);
  const nodeIdx = keys.indexOf('node');
  const alignFlagsIdx = keys.indexOf('_alignFlags');
  assert.ok(nodeIdx < alignFlagsIdx, 'node 应排在 _alignFlags 之前');
  // 业务字段
  assert.equal(widget._alignFlags, 0);
  assert.equal(widget._left, 0);
  assert.equal(widget._right, 0);
  assert.equal(widget._top, 0);
  assert.equal(widget._bottom, 0);
  assert.equal(widget._alignMode, 1);
  assert.equal(widget.node.__id__, 2);
  assert.ok(!('__prefab' in widget));
});

test('makeWidget - 四边对齐（alignFlags=15）', () => {
  const widget = makeWidget({
    nodeId: 3,
    alignFlags: 15, // LEFT|RIGHT|TOP|BOTTOM
    left: 10,
    right: 10,
    top: 20,
    bottom: 20,
    prefabInfoId: 99,
  });
  assert.equal(widget._alignFlags, 15);
  assert.equal(widget._left, 10);
  assert.equal(widget._right, 10);
  assert.equal(widget._top, 20);
  assert.equal(widget._bottom, 20);
  assert.equal(widget.__prefab.__id__, 99);
});

// ─── makePrefabInfo / makeCompPrefabInfo / makePrefabRoot ─────────

test('makePrefabInfo - 普通节点（非根）', () => {
  const info = makePrefabInfo({ rootId: 1, fileId: 'abc123XYZ' });
  assert.equal(info.__type__, 'cc.PrefabInfo');
  assert.equal(info.root.__id__, 1);
  assert.equal(info.asset.__id__, 0);
  assert.equal(info.fileId, 'abc123XYZ');
  assert.equal(info.instance, null);
  assert.equal(info.targetOverrides, null);
  assert.equal(info.nestedPrefabInstanceRoots, null);
});

test('makePrefabInfo - 根节点带 nestedPrefabInstanceRoots', () => {
  const info = makePrefabInfo({ rootId: 1, fileId: 'rootFileId', nestedPrefabInstanceRoots: [5, 12] });
  assert.deepEqual(info.nestedPrefabInstanceRoots, [{ __id__: 5 }, { __id__: 12 }]);
});

test('makeCompPrefabInfo - 结构正确', () => {
  const info = makeCompPrefabInfo('compFileId123');
  assert.equal(info.__type__, 'cc.CompPrefabInfo');
  assert.equal(info.fileId, 'compFileId123');
});

test('makePrefabRoot - 结构正确', () => {
  const root = makePrefabRoot({ name: 'MyPrefab', rootId: 1 });
  assert.equal(root.__type__, 'cc.Prefab');
  assert.equal(root._name, 'MyPrefab');
  assert.equal(root._objFlags, 0);
  assert.deepEqual(root.__editorExtras__, {});
  assert.equal(root._native, '');
  assert.equal(root.data.__id__, 1);
  assert.equal(root.optimizationPolicy, 0);
  assert.equal(root.persistent, false);
});

// ─── 集成：构造一个最小合法 prefab 数组 ─────────────────────────────

test('最小 prefab 数组可序列化', () => {
  // 模拟 index 分配
  // [0] cc.Prefab, [1] cc.Node(root), [2] cc.UITransform, [3] cc.CompPrefabInfo, [4] cc.PrefabInfo
  const compPrefabInfoIdx = 3;
  const prefabInfoIdx = 4;

  const objects = [
    makePrefabRoot({ name: 'Test', rootId: 1 }),
    makeNode({ name: 'Test', componentIds: [2], prefabId: prefabInfoIdx }),
    makeUITransform({ nodeId: 1, width: 200, height: 100, prefabInfoId: compPrefabInfoIdx }),
    makeCompPrefabInfo('testCompFileId'),
    makePrefabInfo({ rootId: 1, fileId: 'testRootFileId' }),
  ];

  // 验证可序列化
  const json = JSON.stringify(objects, null, 2);
  assert.ok(json.length > 0, 'JSON 序列化不应为空');

  // 验证反序列化后结构完整
  const parsed = JSON.parse(json);
  assert.equal(parsed.length, 5);
  assert.equal(parsed[0].__type__, 'cc.Prefab');
  assert.equal(parsed[1].__type__, 'cc.Node');
  assert.equal(parsed[2].__type__, 'cc.UITransform');
  assert.equal(parsed[3].__type__, 'cc.CompPrefabInfo');
  assert.equal(parsed[4].__type__, 'cc.PrefabInfo');
  assert.equal(parsed[1]._prefab.__id__, prefabInfoIdx);
  assert.equal(parsed[2].__prefab.__id__, compPrefabInfoIdx);
});
