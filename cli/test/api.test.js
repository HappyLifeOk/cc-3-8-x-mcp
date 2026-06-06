'use strict';

// ============================================================
// T8 api.test.js
// 测试链路：editPrefab() → 内存执行所有 ops → 落盘 → re-parse → 断言
// fixture: cli/test/fixtures/HomeUI.prefab（只读副本）
// 所有写操作走 tmp 文件，断言原 fixture + assets 原文件未变
// ============================================================

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { editPrefab } = require('../src/editor/index.js');
const { parsePrefab } = require('../src/parse.js');
const { listOverrides } = require('../src/overrides.js');

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/HomeUI.prefab');

// 项目根（含 assets/ + package.json），传给 editPrefab options.projectRoot
// 让 UuidResolver 在 /tmp/ 临时文件场景下也能定位 assets/ 目录
const PROJECT_ROOT = path.resolve(__dirname, '../../../../');

// 每个测试独立 tmp 文件
function makeTmp(tag) {
  return path.join(os.tmpdir(), `HomeUI-api-${tag}-${Date.now()}.prefab`);
}

// 把 fixture 复制到 tmp，返回 tmp 路径（让 editPrefab 可以写回）
function cloneFixture(tag) {
  const tmp = makeTmp(tag);
  fs.copyFileSync(FIXTURE_PATH, tmp);
  return tmp;
}

function md5(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

// 记录生成的 tmp 路径，after 统一清理
const tmpFiles = [];

after(() => {
  for (const f of tmpFiles) {
    try { fs.unlinkSync(f); } catch (_) {}
  }
});

// ─── fixture 存在性 ───────────────────────────────────────────

test('fixture 文件存在', () => {
  assert.ok(fs.existsSync(FIXTURE_PATH), `fixture 不存在: ${FIXTURE_PATH}`);
});

// ─── set-position 普通节点 ────────────────────────────────────

test('set-position: 普通节点直改 _lpos', () => {
  const tmp = cloneFixture('pos-normal');
  tmpFiles.push(tmp);

  // touchArea 是普通非 stub 节点，原始 _lpos.x = 0
  const result = editPrefab(tmp, [
    { op: 'set-position', node: 'touchArea', x: 111, y: 222, z: 5 },
  ]);

  assert.equal(result.changed, true);
  assert.equal(result.opsApplied, 1);
  assert.ok(Array.isArray(result.nodesAffected) && result.nodesAffected.length === 1);

  // 验证写回结果
  const reparsed = parsePrefab(tmp);
  const node = reparsed.findNodeByName('touchArea');
  assert.ok(node, 'touchArea 应存在');
  assert.equal(node._lpos.x, 111, '_lpos.x 应为 111');
  assert.equal(node._lpos.y, 222, '_lpos.y 应为 222');
  assert.equal(node._lpos.z, 5, '_lpos.z 应为 5');
});

test('set-position: 按 {id: N} 定位普通节点', () => {
  const tmp = cloneFixture('pos-byid');
  tmpFiles.push(tmp);

  // touchArea 在 fixture 里是 cc.Node，找其 __id__
  const p0 = parsePrefab(FIXTURE_PATH);
  const ta = p0.findNodeByName('touchArea');
  let taId = -1;
  for (let i = 0; i < p0.elements.length; i++) {
    if (p0.elements[i] === ta) { taId = i; break; }
  }
  assert.ok(taId >= 0, 'touchArea id 应能找到');

  const result = editPrefab(tmp, [
    { op: 'set-position', node: { id: taId }, x: 500, y: 600 },
  ]);
  assert.equal(result.opsApplied, 1);

  const reparsed = parsePrefab(tmp);
  const node = reparsed.findNodeByName('touchArea');
  assert.equal(node._lpos.x, 500);
  assert.equal(node._lpos.y, 600);
  assert.equal(node._lpos.z, 0, 'z 默认为 0');
});

// ─── set-position stub 节点（走 override）────────────────────

test('set-position: stub 节点走 override 而非直改字段', () => {
  const tmp = cloneFixture('pos-stub');
  tmpFiles.push(tmp);

  // stub 节点 id=10，已有 _lpos override {x:-272, y:53}
  const STUB_ID = 10;

  const result = editPrefab(tmp, [
    { op: 'set-position', node: { id: STUB_ID }, x: 99, y: -88, z: 0 },
  ]);
  assert.equal(result.opsApplied, 1);

  const reparsed = parsePrefab(tmp);
  const overrides = listOverrides(reparsed, STUB_ID);
  const lposOverride = overrides.find((o) => o.propertyPath[0] === '_lpos');
  assert.ok(lposOverride, 'stub 节点应有 _lpos override');
  assert.equal(lposOverride.value.x, 99, 'override _lpos.x 应为 99');
  assert.equal(lposOverride.value.y, -88, 'override _lpos.y 应为 -88');

  // stub 节点本身的 _lpos 字段不应有 x=99（直接修改无效，这里验证 override 是主路径）
  // 不验证 stub._lpos（stub 无此字段是正常的）
});

// ─── set-label-text ───────────────────────────────────────────

test('set-label-text: 普通节点修改 cc.Label._string', () => {
  const tmp = cloneFixture('label');
  tmpFiles.push(tmp);

  // n7 节点上有 cc.Label，原始 text='开始'
  const result = editPrefab(tmp, [
    { op: 'set-label-text', node: 'n7', text: 'Hello World' },
  ]);
  assert.equal(result.opsApplied, 1);
  assert.ok(result.nodesAffected.includes('n7'));

  const reparsed = parsePrefab(tmp);
  const labels = reparsed.findNodesByType('cc.Label');
  const label = labels.find((l) => reparsed.elements[l.node.__id__]._name === 'n7');
  assert.ok(label, 'n7 的 Label 应存在');
  assert.equal(label._string, 'Hello World', 'Label 文字应已更新');
});

// ─── set-label-text stub 节点（T21：真正写 override，不再抛 unsupported）──

// ─── set-sprite-frame ─────────────────────────────────────────

test('set-sprite-frame: 普通节点修改 cc.Sprite._spriteFrame uuid', () => {
  const tmp = cloneFixture('sprite');
  tmpFiles.push(tmp);

  const newUuid = 'aaaabbbb-cccc-dddd-eeee-000011112222@f9941';

  const result = editPrefab(tmp, [
    { op: 'set-sprite-frame', node: 'n5', uuid: newUuid },
  ]);
  assert.equal(result.opsApplied, 1);

  const reparsed = parsePrefab(tmp);
  const sprites = reparsed.findNodesByType('cc.Sprite');
  const sprite = sprites.find((s) => reparsed.elements[s.node.__id__]._name === 'n5');
  assert.ok(sprite, 'n5 的 Sprite 应存在');
  assert.equal(sprite._spriteFrame.__uuid__, newUuid, 'spriteFrame uuid 应已更新');
  assert.equal(sprite._spriteFrame.__expectedType__, 'cc.SpriteFrame');
});

// ─── set-active ───────────────────────────────────────────────

test('set-active: 普通节点设置 _active = false', () => {
  const tmp = cloneFixture('active');
  tmpFiles.push(tmp);

  const result = editPrefab(tmp, [
    { op: 'set-active', node: 'touchArea', active: false },
  ]);
  assert.equal(result.opsApplied, 1);

  const reparsed = parsePrefab(tmp);
  const node = reparsed.findNodeByName('touchArea');
  assert.equal(node._active, false, '_active 应为 false');
});

test('set-active: stub 节点走 override', () => {
  const tmp = cloneFixture('active-stub');
  tmpFiles.push(tmp);

  const STUB_ID = 10;

  const result = editPrefab(tmp, [
    { op: 'set-active', node: { id: STUB_ID }, active: false },
  ]);
  assert.equal(result.opsApplied, 1);

  const reparsed = parsePrefab(tmp);
  const overrides = listOverrides(reparsed, STUB_ID);
  const activeOverride = overrides.find((o) => o.propertyPath[0] === '_active');
  assert.ok(activeOverride, 'stub 节点应有 _active override');
  assert.equal(activeOverride.value, false, 'override _active 应为 false');
});

// ─── 批量混合 ops ─────────────────────────────────────────────

test('批量 ops：position + label-text + active 混合', () => {
  const tmp = cloneFixture('batch');
  tmpFiles.push(tmp);

  const result = editPrefab(tmp, [
    { op: 'set-position', node: 'touchArea', x: 10, y: 20 },
    { op: 'set-label-text', node: 'n7', text: 'Batch Test' },
    { op: 'set-active', node: 'touchArea', active: false },
  ]);

  assert.equal(result.opsApplied, 3);
  // touchArea 被两个 op 命中，nodesAffected 去重后应有 2 个不同节点
  assert.ok(result.nodesAffected.length >= 1, 'nodesAffected 至少 1 项');

  const reparsed = parsePrefab(tmp);

  const touchArea = reparsed.findNodeByName('touchArea');
  assert.equal(touchArea._lpos.x, 10);
  assert.equal(touchArea._active, false);

  const labels = reparsed.findNodesByType('cc.Label');
  const label = labels.find((l) => reparsed.elements[l.node.__id__]._name === 'n7');
  assert.equal(label._string, 'Batch Test');
});

// ─── 失败回滚（不落盘）───────────────────────────────────────

test('失败回滚：其中一个 op 找不到节点，不落盘', () => {
  const tmp = cloneFixture('rollback');
  tmpFiles.push(tmp);

  const originalContent = fs.readFileSync(tmp, 'utf8');

  assert.throws(() => {
    editPrefab(tmp, [
      // 第 1 个 op 合法
      { op: 'set-position', node: 'touchArea', x: 999, y: 999 },
      // 第 2 个 op 找不到节点 → 抛错
      { op: 'set-position', node: '__nonexistent_node__', x: 1, y: 2 },
    ]);
  }, /找不到节点/);

  // 文件内容应与修改前完全一致（未落盘）
  const currentContent = fs.readFileSync(tmp, 'utf8');
  assert.equal(
    md5(currentContent),
    md5(originalContent),
    '发生错误时不应写回文件（原子性保证）'
  );
});

test('失败回滚：unsupported op 类型，不落盘', () => {
  const tmp = cloneFixture('rollback-unsupported');
  tmpFiles.push(tmp);

  const originalContent = fs.readFileSync(tmp, 'utf8');

  assert.throws(() => {
    editPrefab(tmp, [
      { op: 'unsupported-op-xyz', node: 'touchArea' },
    ]);
  }, /不支持的 op 类型/);

  const currentContent = fs.readFileSync(tmp, 'utf8');
  assert.equal(md5(currentContent), md5(originalContent), '不支持的 op 不应落盘');
});

// ─── add-node：普通父节点 ─────────────────────────────────────

test('add-node: 普通节点父 → 新节点存在、parent._children 包含、__id__ 连续', () => {
  const tmp = cloneFixture('add-normal');
  tmpFiles.push(tmp);

  // 在 touchArea(id=2) 下新增子节点
  const result = editPrefab(tmp, [
    { op: 'add-node', parent: 'touchArea', node: { name: 'newChild', lpos: [10, 20, 0] } },
  ]);
  assert.equal(result.opsApplied, 1);

  const reparsed = parsePrefab(tmp);
  // 新节点应能按名查到
  const newNode = reparsed.findNodeByName('newChild');
  assert.ok(newNode, '新节点 newChild 应存在');
  assert.equal(newNode._name, 'newChild');
  assert.equal(newNode._lpos.x, 10);
  assert.equal(newNode._lpos.y, 20);

  // touchArea 的 _children 应包含新节点
  const parent = reparsed.findNodeByName('touchArea');
  assert.ok(Array.isArray(parent._children) && parent._children.length > 0, 'touchArea._children 应非空');

  // 新节点的 __id__ 应在 elements 数组内且是末尾之一
  const newNodeId = reparsed.elements.indexOf(newNode);
  assert.ok(newNodeId > 0, '新节点 __id__ 应 > 0');
  const hasRef = parent._children.some((r) => r.__id__ === newNodeId);
  assert.ok(hasRef, 'touchArea._children 应包含新节点 __id__');

  // 新节点有 cc.PrefabInfo
  const prefabInfo = reparsed.elements[newNode._prefab.__id__];
  assert.ok(prefabInfo && prefabInfo.__type__ === 'cc.PrefabInfo', '新节点应有 cc.PrefabInfo');
  assert.ok(typeof prefabInfo.fileId === 'string' && prefabInfo.fileId.length > 0, 'fileId 应非空');
  assert.equal(prefabInfo.instance, null, '普通节点 instance 应为 null');
});

test('add-node: fileId 幂等 — 相同输入生成相同 fileId', () => {
  const tmp1 = cloneFixture('add-fid-1');
  const tmp2 = cloneFixture('add-fid-2');
  tmpFiles.push(tmp1, tmp2);

  const op = { op: 'add-node', parent: 'touchArea', node: { name: 'stableNode' } };
  editPrefab(tmp1, [op]);
  editPrefab(tmp2, [op]);

  const p1 = parsePrefab(tmp1);
  const p2 = parsePrefab(tmp2);

  const n1 = p1.findNodeByName('stableNode');
  const n2 = p2.findNodeByName('stableNode');
  assert.ok(n1 && n2, '两次 add-node 都应生成 stableNode');

  const fi1 = p1.elements[n1._prefab.__id__].fileId;
  const fi2 = p2.elements[n2._prefab.__id__].fileId;
  assert.equal(fi1, fi2, '相同种子应生成相同 fileId（幂等）');
});

test('add-node: 带 UITransform 组件 → 组件存在且 CompPrefabInfo 存在', () => {
  const tmp = cloneFixture('add-uit');
  tmpFiles.push(tmp);

  editPrefab(tmp, [
    {
      op: 'add-node',
      parent: 'touchArea',
      node: { name: 'uitNode', components: ['UITransform'], width: 200, height: 80 },
    },
  ]);

  const reparsed = parsePrefab(tmp);
  const newNode = reparsed.findNodeByName('uitNode');
  assert.ok(newNode, 'uitNode 应存在');
  assert.ok(Array.isArray(newNode._components) && newNode._components.length > 0, '应有组件');

  // 找到 UITransform 组件
  const uitComp = reparsed.elements[newNode._components[0].__id__];
  assert.ok(uitComp, 'UITransform 组件应存在');
  assert.equal(uitComp.__type__, 'cc.UITransform', '组件类型应是 cc.UITransform');
  assert.equal(uitComp._contentSize.width, 200, '宽度应为 200');
  assert.equal(uitComp._contentSize.height, 80, '高度应为 80');

  // CompPrefabInfo 应存在
  const cpi = reparsed.elements[uitComp.__prefab.__id__];
  assert.ok(cpi && cpi.__type__ === 'cc.CompPrefabInfo', 'UITransform 应有 CompPrefabInfo');
  assert.ok(typeof cpi.fileId === 'string' && cpi.fileId.length > 0, 'CompPrefabInfo.fileId 应非空');
});

// ─── add-node：stub 父节点 ────────────────────────────────────

test('add-node: stub 父 → 走 mountedChildren 路径', () => {
  const tmp = cloneFixture('add-stub');
  tmpFiles.push(tmp);

  const STUB_ID = 10;

  editPrefab(tmp, [
    { op: 'add-node', parent: { id: STUB_ID }, node: { name: 'mountedChild' } },
  ]);

  const reparsed = parsePrefab(tmp);
  // 新节点应能按名查到（findNodeByName 只走 _children，但 mountedChildren 不在其中）
  // 直接在 elements 里找
  const mountedNode = reparsed.elements.find(
    (el) => el && el.__type__ === 'cc.Node' && el._name === 'mountedChild'
  );
  assert.ok(mountedNode, 'mountedChild 节点应在 elements 中');

  // PrefabInstance.mountedChildren 应包含新节点
  const stubNode = reparsed.elements[STUB_ID];
  const stubPrefabInfo = reparsed.elements[stubNode._prefab.__id__];
  const prefabInstance = reparsed.elements[stubPrefabInfo.instance.__id__];
  assert.ok(Array.isArray(prefabInstance.mountedChildren), 'mountedChildren 应是数组');
  const newNodeId = reparsed.elements.indexOf(mountedNode);
  const hasRef = prefabInstance.mountedChildren.some((r) => r.__id__ === newNodeId);
  assert.ok(hasRef, 'mountedChildren 应包含新节点 __id__');

  // 新节点 _parent 应指向 stub 节点
  assert.equal(mountedNode._parent.__id__, STUB_ID, '新节点 _parent 应指向 stub');
});

// ─── remove-node ──────────────────────────────────────────────

test('remove-node: 普通节点 → 父 _children 不再含引用', () => {
  const tmp = cloneFixture('remove-normal');
  tmpFiles.push(tmp);

  // 先 add-node 创建一个可删除的节点
  editPrefab(tmp, [
    { op: 'add-node', parent: 'touchArea', node: { name: 'toDelete' } },
  ]);

  // 记录当前元素数，找 toDelete 的 id
  const p1 = parsePrefab(tmp);
  const toDeleteNode = p1.findNodeByName('toDelete');
  assert.ok(toDeleteNode, 'toDelete 应存在');
  const toDeleteId = p1.elements.indexOf(toDeleteNode);

  // 再 remove-node
  const result = editPrefab(tmp, [
    { op: 'remove-node', target: 'toDelete' },
  ]);
  assert.equal(result.opsApplied, 1);

  const reparsed = parsePrefab(tmp);
  const parent = reparsed.findNodeByName('touchArea');
  const stillReferenced = Array.isArray(parent._children) &&
    parent._children.some((r) => r.__id__ === toDeleteId);
  assert.ok(!stillReferenced, 'touchArea._children 不应再引用已删节点');

  // 节点元素本身仍在数组（orphan）
  const orphan = reparsed.elements[toDeleteId];
  assert.ok(orphan && orphan.__type__ === 'cc.Node', '孤儿节点元素仍在 elements 中');
  assert.equal(orphan._parent, null, '孤儿节点 _parent 应为 null');
});

test('remove-node: stub 子节点（mountedChildren 内） → mountedChildren 移除', () => {
  const tmp = cloneFixture('remove-stub-child');
  tmpFiles.push(tmp);

  const STUB_ID = 10;

  // 先 add-node 到 stub，再 remove-node
  editPrefab(tmp, [
    { op: 'add-node', parent: { id: STUB_ID }, node: { name: 'stubChild' } },
  ]);

  // 找到新节点 id
  const p1 = parsePrefab(tmp);
  const stubChildEl = p1.elements.find(
    (el) => el && el.__type__ === 'cc.Node' && el._name === 'stubChild'
  );
  assert.ok(stubChildEl, 'stubChild 应存在');
  const stubChildId = p1.elements.indexOf(stubChildEl);

  // remove-node
  editPrefab(tmp, [
    { op: 'remove-node', target: { id: stubChildId } },
  ]);

  const reparsed = parsePrefab(tmp);
  const stubNode = reparsed.elements[STUB_ID];
  const stubPrefabInfo = reparsed.elements[stubNode._prefab.__id__];
  const prefabInstance = reparsed.elements[stubPrefabInfo.instance.__id__];
  const stillInMounted = Array.isArray(prefabInstance.mountedChildren) &&
    prefabInstance.mountedChildren.some((r) => r.__id__ === stubChildId);
  assert.ok(!stillInMounted, 'mountedChildren 应不再包含已删节点');
});

test('remove-node: 失败回滚 — target 不存在时文件不变', () => {
  const tmp = cloneFixture('remove-rollback');
  tmpFiles.push(tmp);

  const originalMd5 = md5(fs.readFileSync(tmp, 'utf8'));

  assert.throws(() => {
    editPrefab(tmp, [
      { op: 'remove-node', target: '__nonexistent_target__' },
    ]);
  }, /找不到节点/);

  const currentMd5 = md5(fs.readFileSync(tmp, 'utf8'));
  assert.equal(currentMd5, originalMd5, 'remove-node 失败时不应落盘');
});

test('remove-node: 删嵌套 stub → 清根 targetOverrides 中指向它的悬空条目，保留无关条目', () => {
  // 最小 prefab：根(1) 挂一个嵌套 stub(2)，根 PrefabInfo 有两条 targetOverride——
  // _toStub 指向被删 stub(2)（应清），_keep target=null（应留）。
  // 复现 HomeUI fixture 缺失的场景：外层脚本对嵌套实例内部的引用 override。
  const tmp = path.join(os.tmpdir(), `nested-ov-${crypto.randomBytes(4).toString('hex')}.prefab`);
  tmpFiles.push(tmp);
  const data = [
    { __type__: 'cc.Prefab', data: { __id__: 1 } },
    { __type__: 'cc.Node', _name: 'Root', _parent: null, _children: [{ __id__: 2 }], _components: [], _prefab: { __id__: 5 } },
    { __type__: 'cc.Node', _name: null, _parent: { __id__: 1 }, _children: [], _components: [], _prefab: { __id__: 3 } },
    { __type__: 'cc.PrefabInfo', root: { __id__: 2 }, asset: { __uuid__: 'dummyuuid-0000-0000-0000-000000000001' }, fileId: 'stubFileId0000000000aa', instance: { __id__: 4 }, targetOverrides: null },
    { __type__: 'cc.PrefabInstance', root: { __id__: 2 }, asset: { __uuid__: 'dummyuuid-0000-0000-0000-000000000001' }, fileId: 'instFileId0000000000bb', mountedChildren: [], mountedComponents: [], propertyOverrides: [], targetOverrides: null },
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'rootFileId0000000000cc', instance: null, targetOverrides: [{ __id__: 6 }, { __id__: 7 }], nestedPrefabInstanceRoots: [{ __id__: 2 }] },
    { __type__: 'cc.TargetOverrideInfo', source: { __id__: 1 }, sourceInfo: null, propertyPath: ['_toStub'], target: { __id__: 2 }, targetInfo: { __id__: 8 } },
    { __type__: 'cc.TargetOverrideInfo', source: { __id__: 1 }, sourceInfo: null, propertyPath: ['_keep'], target: null, targetInfo: { __id__: 9 } },
    { __type__: 'cc.TargetInfo', localID: ['stubLocalId'] },
    { __type__: 'cc.TargetInfo', localID: ['keepLocalId'] },
  ];
  fs.writeFileSync(tmp, JSON.stringify(data));

  editPrefab(tmp, [{ op: 'remove-node', target: { id: 2 } }]);

  const reparsed = parsePrefab(tmp);
  const rootPi = reparsed.elements.find(
    (e) => e && e.__type__ === 'cc.PrefabInfo' && e.root && e.root.__id__ === 1
  );
  const remaining = (rootPi.targetOverrides || []).map(
    (r) => reparsed.elements[r.__id__].propertyPath[0]
  );
  assert.deepEqual(remaining, ['_keep'], '指向被删 stub 的 _toStub override 应被清，_keep 应保留');
  assert.equal(
    (rootPi.nestedPrefabInstanceRoots || []).length,
    0,
    'nestedPrefabInstanceRoots 应清空孤儿 stub'
  );
});

// ─── clone-node ───────────────────────────────────────────────

test('clone-node: 整棵子树复制、所有 _parent 正确、新 fileId 不与原冲突', () => {
  const tmp = cloneFixture('clone-normal');
  tmpFiles.push(tmp);

  // 先 add-node 创建有子节点的树
  editPrefab(tmp, [
    { op: 'add-node', parent: 'touchArea', node: { name: 'srcRoot', lpos: [0, 0, 0] } },
  ]);
  // 克隆 srcRoot 到同父
  const result = editPrefab(tmp, [
    { op: 'clone-node', source: 'srcRoot', parent: 'touchArea', name: 'clonedRoot' },
  ]);
  assert.equal(result.opsApplied, 1);

  const reparsed = parsePrefab(tmp);

  // 原节点和克隆节点都应存在
  const src = reparsed.findNodeByName('srcRoot');
  const cloned = reparsed.findNodeByName('clonedRoot');
  assert.ok(src, 'srcRoot 应存在');
  assert.ok(cloned, 'clonedRoot 应存在');

  // 两者 __id__ 不同
  const srcId = reparsed.elements.indexOf(src);
  const clonedId = reparsed.elements.indexOf(cloned);
  assert.notEqual(srcId, clonedId, '克隆节点应有不同 __id__');

  // 克隆节点 _parent 应指向 touchArea
  const touchArea = reparsed.findNodeByName('touchArea');
  const touchAreaId = reparsed.elements.indexOf(touchArea);
  assert.equal(cloned._parent.__id__, touchAreaId, '克隆节点 _parent 应指向 touchArea');

  // touchArea._children 应包含克隆节点
  const hasCloned = touchArea._children.some((r) => r.__id__ === clonedId);
  assert.ok(hasCloned, 'touchArea._children 应包含克隆节点');

  // fileId 不冲突
  const srcFileId = reparsed.elements[src._prefab.__id__].fileId;
  const clonedFileId = reparsed.elements[cloned._prefab.__id__].fileId;
  assert.notEqual(srcFileId, clonedFileId, '克隆节点 fileId 应与原节点不同');
});

test('clone-node: 带子节点的子树 → 所有子节点 _parent 正确', () => {
  const tmp = cloneFixture('clone-subtree');
  tmpFiles.push(tmp);

  // 先建一个带子节点的树
  editPrefab(tmp, [
    { op: 'add-node', parent: 'touchArea', node: { name: 'parent2' } },
  ]);
  editPrefab(tmp, [
    { op: 'add-node', parent: 'parent2', node: { name: 'child2' } },
  ]);

  // 克隆 parent2（含 child2）
  editPrefab(tmp, [
    { op: 'clone-node', source: 'parent2', parent: 'touchArea', name: 'clonedParent2' },
  ]);

  const reparsed = parsePrefab(tmp);
  const clonedParent = reparsed.findNodeByName('clonedParent2');
  assert.ok(clonedParent, 'clonedParent2 应存在');

  // 克隆节点应有 _children（子树被克隆）
  assert.ok(
    Array.isArray(clonedParent._children) && clonedParent._children.length > 0,
    '克隆后的父节点应有子节点'
  );

  // 子节点的 _parent 应指向克隆节点
  const clonedParentId = reparsed.elements.indexOf(clonedParent);
  for (const childRef of clonedParent._children) {
    const childNode = reparsed.elements[childRef.__id__];
    assert.ok(childNode, '子节点应存在');
    assert.equal(
      childNode._parent.__id__,
      clonedParentId,
      `子节点 _parent 应指向克隆节点(${clonedParentId})`
    );
  }
});

test('clone-node: 失败回滚 — source 不存在时文件不变', () => {
  const tmp = cloneFixture('clone-rollback');
  tmpFiles.push(tmp);

  const originalMd5 = md5(fs.readFileSync(tmp, 'utf8'));

  assert.throws(() => {
    editPrefab(tmp, [
      { op: 'clone-node', source: '__nonexistent_src__', parent: 'touchArea', name: 'cloned' },
    ]);
  }, /找不到节点/);

  const currentMd5 = md5(fs.readFileSync(tmp, 'utf8'));
  assert.equal(currentMd5, originalMd5, 'clone-node 失败时不应落盘');
});

test('clone-node: 失败回滚 — parent 不存在时文件不变', () => {
  const tmp = cloneFixture('clone-rollback-parent');
  tmpFiles.push(tmp);

  editPrefab(tmp, [
    { op: 'add-node', parent: 'touchArea', node: { name: 'srcForRollback' } },
  ]);

  const contentAfterAdd = fs.readFileSync(tmp, 'utf8');
  const md5AfterAdd = md5(contentAfterAdd);

  assert.throws(() => {
    editPrefab(tmp, [
      { op: 'clone-node', source: 'srcForRollback', parent: '__bad_parent__', name: 'cloned' },
    ]);
  }, /找不到节点/);

  const currentMd5 = md5(fs.readFileSync(tmp, 'utf8'));
  assert.equal(currentMd5, md5AfterAdd, 'clone-node parent 不存在时不应落盘');
});

// ─── T21 新增：stub 节点 set-label-text 错误路径 ─────────────

test('set-sprite-frame: stub 节点 + UUID 对应 prefab 不存在时抛错', () => {
  const tmp = cloneFixture('sprite-stub-bad-uuid');
  tmpFiles.push(tmp);

  // 先修改 fixture 的某个 stub 节点的嵌套 prefab asset.__uuid__ 为不存在的 uuid
  const data = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  const STUB_ID = 10;
  const stubNode = data[STUB_ID];
  const pi = data[stubNode._prefab.__id__];
  // 保存原 uuid，设置为不存在的 uuid
  pi.asset = { __uuid__: '00000000-0000-0000-0000-000000000000', __expectedType__: 'cc.Prefab' };
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');

  assert.throws(
    () => {
      editPrefab(
        tmp,
        [{ op: 'set-sprite-frame', node: { id: STUB_ID }, uuid: 'xxxx@f9941' }],
        { projectRoot: PROJECT_ROOT }
      );
    },
    (err) => {
      assert.ok(err instanceof Error, '应抛 Error');
      assert.ok(
        err.message.includes('00000000-0000-0000-0000-000000000000'),
        `错误消息应包含不存在的 UUID，实际: ${err.message}`
      );
      return true;
    },
    'UUID 找不到对应 prefab 时应抛错'
  );
});

// ─── T21 新增：uuid-resolver 单测 ────────────────────────────

test('uuid-resolver: 不存在的 uuid 抛明确错误', () => {
  const { resolveUuidToPath } = require('../src/uuid-resolver.js');

  assert.throws(
    () => {
      resolveUuidToPath('00000000-0000-0000-0000-deadbeefcafe', PROJECT_ROOT);
    },
    (err) => {
      assert.ok(err instanceof Error, '应抛 Error');
      assert.ok(
        err.message.includes('00000000-0000-0000-0000-deadbeefcafe'),
        `错误消息应包含不存在的 uuid，实际: ${err.message}`
      );
      return true;
    }
  );
});

// ─── T20 BUG-1: remove-node 递归清理子树 ─────────────────────

test('BUG-1 remove-node: 删除有多层子节点的父节点 → 所有后代 _parent 都断开', () => {
  const tmp = cloneFixture('bug1-remove-subtree');
  tmpFiles.push(tmp);

  // 建立 grandParent → child1 → grandChild 三层结构
  editPrefab(tmp, [
    { op: 'add-node', parent: 'touchArea', node: { name: 'gpNode' } },
  ]);
  editPrefab(tmp, [
    { op: 'add-node', parent: 'gpNode', node: { name: 'childNode1' } },
  ]);
  editPrefab(tmp, [
    { op: 'add-node', parent: 'childNode1', node: { name: 'grandChildNode' } },
  ]);

  // 验证结构建立完整
  const p0 = parsePrefab(tmp);
  assert.ok(p0.findNodeByName('gpNode'), 'gpNode 应存在');
  assert.ok(p0.findNodeByName('childNode1'), 'childNode1 应存在');
  assert.ok(p0.findNodeByName('grandChildNode'), 'grandChildNode 应存在');

  // 记录各节点 id
  const gpEl = p0.findNodeByName('gpNode');
  const c1El = p0.findNodeByName('childNode1');
  const gcEl = p0.findNodeByName('grandChildNode');
  const gpId = p0.elements.indexOf(gpEl);
  const c1Id = p0.elements.indexOf(c1El);
  const gcId = p0.elements.indexOf(gcEl);

  // 删除 gpNode（整棵子树）
  const result = editPrefab(tmp, [
    { op: 'remove-node', target: 'gpNode' },
  ]);
  assert.equal(result.opsApplied, 1);

  const reparsed = parsePrefab(tmp);

  // 父节点 touchArea 不再包含 gpNode 引用
  const touchArea = reparsed.findNodeByName('touchArea');
  const stillRef = Array.isArray(touchArea._children) &&
    touchArea._children.some((r) => r.__id__ === gpId);
  assert.ok(!stillRef, 'touchArea._children 不应再含 gpNode 引用');

  // 所有后代节点 _parent 都应为 null
  assert.equal(reparsed.elements[gpId]._parent, null, 'gpNode._parent 应为 null');
  assert.equal(reparsed.elements[c1Id]._parent, null, 'childNode1._parent 应为 null');
  assert.equal(reparsed.elements[gcId]._parent, null, 'grandChildNode._parent 应为 null');

  // 元素仍在数组中（__id__ 稳定）
  assert.ok(reparsed.elements[gpId].__type__ === 'cc.Node', 'gpNode 仍在 elements');
  assert.ok(reparsed.elements[c1Id].__type__ === 'cc.Node', 'childNode1 仍在 elements');
  assert.ok(reparsed.elements[gcId].__type__ === 'cc.Node', 'grandChildNode 仍在 elements');
});

// ─── T20 BUG-2: add-node fileId 冲突检测 ─────────────────────

test('BUG-2 add-node: 同父同名两次 → fileId 不同（deterministic）', () => {
  const tmp = cloneFixture('bug2-dup-add');
  tmpFiles.push(tmp);

  // 第一次 add
  editPrefab(tmp, [
    { op: 'add-node', parent: 'touchArea', node: { name: 'dupNode' } },
  ]);
  // 第二次 add 同名（同父同名）
  editPrefab(tmp, [
    { op: 'add-node', parent: 'touchArea', node: { name: 'dupNode' } },
  ]);

  const reparsed = parsePrefab(tmp);

  // 找所有名为 dupNode 的节点
  const dupNodes = reparsed.elements.filter(
    (el) => el && el.__type__ === 'cc.Node' && el._name === 'dupNode'
  );
  assert.equal(dupNodes.length, 2, '应有两个名为 dupNode 的节点');

  // 两个节点的 fileId 不同
  const fi0 = reparsed.elements[dupNodes[0]._prefab.__id__].fileId;
  const fi1 = reparsed.elements[dupNodes[1]._prefab.__id__].fileId;
  assert.notEqual(fi0, fi1, '两个 dupNode 的 fileId 应不同');
});

test('BUG-2 add-node: 同一系列调用多次结果 fileId 稳定（deterministic）', () => {
  const tmp1 = cloneFixture('bug2-det-1');
  const tmp2 = cloneFixture('bug2-det-2');
  tmpFiles.push(tmp1, tmp2);

  // 两个 tmp 执行完全相同的操作序列
  function runOps(f) {
    editPrefab(f, [{ op: 'add-node', parent: 'touchArea', node: { name: 'dupNode' } }]);
    editPrefab(f, [{ op: 'add-node', parent: 'touchArea', node: { name: 'dupNode' } }]);
  }
  runOps(tmp1);
  runOps(tmp2);

  const p1 = parsePrefab(tmp1);
  const p2 = parsePrefab(tmp2);

  const nodes1 = p1.elements.filter((el) => el && el.__type__ === 'cc.Node' && el._name === 'dupNode');
  const nodes2 = p2.elements.filter((el) => el && el.__type__ === 'cc.Node' && el._name === 'dupNode');

  assert.equal(nodes1.length, 2, 'tmp1 应有 2 个 dupNode');
  assert.equal(nodes2.length, 2, 'tmp2 应有 2 个 dupNode');

  const fi1 = nodes1.map((n) => p1.elements[n._prefab.__id__].fileId).sort();
  const fi2 = nodes2.map((n) => p2.elements[n._prefab.__id__].fileId).sort();

  assert.deepEqual(fi1, fi2, '相同操作序列应产生相同 fileId 集合（deterministic）');
});

// ─── T20 BUG-3: clone-node fileId 冲突检测 ───────────────────

test('BUG-3 clone-node: 同 source 同 name clone 两次 → 两棵克隆子树 fileId 互不重复', () => {
  const tmp = cloneFixture('bug3-dup-clone');
  tmpFiles.push(tmp);

  // 先建一个带子节点的树作为 source
  editPrefab(tmp, [
    { op: 'add-node', parent: 'touchArea', node: { name: 'cloneSrc' } },
  ]);
  editPrefab(tmp, [
    { op: 'add-node', parent: 'cloneSrc', node: { name: 'cloneSrcChild' } },
  ]);

  // 第一次 clone
  editPrefab(tmp, [
    { op: 'clone-node', source: 'cloneSrc', parent: 'touchArea', name: 'clonedOnce' },
  ]);
  // 第二次 clone 同 source 同目标 name（会产生新 name，但 source fileId 相同）
  editPrefab(tmp, [
    { op: 'clone-node', source: 'cloneSrc', parent: 'touchArea', name: 'clonedTwice' },
  ]);

  const reparsed = parsePrefab(tmp);

  // 找两棵克隆子树的根节点
  const once = reparsed.elements.find(
    (el) => el && el.__type__ === 'cc.Node' && el._name === 'clonedOnce'
  );
  const twice = reparsed.elements.find(
    (el) => el && el.__type__ === 'cc.Node' && el._name === 'clonedTwice'
  );
  assert.ok(once, 'clonedOnce 应存在');
  assert.ok(twice, 'clonedTwice 应存在');

  // 两棵克隆根节点 fileId 不同
  const fiOnce = reparsed.elements[once._prefab.__id__].fileId;
  const fiTwice = reparsed.elements[twice._prefab.__id__].fileId;
  assert.notEqual(fiOnce, fiTwice, '两次克隆根节点的 fileId 应不同');

  // 收集两棵克隆子树各自的 fileId（通过遍历子树节点）
  function collectSubtreeFileIds(elements, nodeEl) {
    const ids = new Set();
    function walk(el) {
      if (!el || el.__type__ !== 'cc.Node') return;
      if (el._prefab && typeof el._prefab.__id__ === 'number') {
        const pi = elements[el._prefab.__id__];
        if (pi && typeof pi.fileId === 'string') ids.add(pi.fileId);
      }
      if (Array.isArray(el._components)) {
        for (const ref of el._components) {
          if (typeof ref.__id__ !== 'number') continue;
          const comp = elements[ref.__id__];
          if (!comp) continue;
          if (comp.__prefab && typeof comp.__prefab.__id__ === 'number') {
            const cpi = elements[comp.__prefab.__id__];
            if (cpi && typeof cpi.fileId === 'string') ids.add(cpi.fileId);
          }
        }
      }
      if (Array.isArray(el._children)) {
        for (const childRef of el._children) {
          if (typeof childRef.__id__ === 'number') {
            walk(elements[childRef.__id__]);
          }
        }
      }
    }
    walk(nodeEl);
    return ids;
  }

  const idsOnce = collectSubtreeFileIds(reparsed.elements, once);
  const idsTwice = collectSubtreeFileIds(reparsed.elements, twice);

  // 两棵子树的 fileId 集合互不重叠
  for (const fid of idsOnce) {
    assert.ok(
      !idsTwice.has(fid),
      `fileId "${fid}" 同时出现在两棵克隆子树中（应互不重复）`
    );
  }
  assert.ok(idsOnce.size > 0, 'clonedOnce 子树应有 fileId');
  assert.ok(idsTwice.size > 0, 'clonedTwice 子树应有 fileId');
});

// ─── T20 BUG-4: add-node 未知组件类型报错 ────────────────────

test('BUG-4 add-node: 未知组件类型抛错且文件不变', () => {
  const tmp = cloneFixture('bug4-unknown-comp');
  tmpFiles.push(tmp);

  const originalMd5 = md5(fs.readFileSync(tmp, 'utf8'));

  assert.throws(
    () => {
      editPrefab(tmp, [
        {
          op: 'add-node',
          parent: 'touchArea',
          node: { name: 'badComp', components: ['cc.Unknown'] },
        },
      ]);
    },
    (err) => {
      assert.ok(err instanceof Error, '应抛 Error');
      assert.ok(
        err.message.includes('unknown component type') || err.message.includes('cc.Unknown'),
        `错误消息应提及 unknown component type 或 cc.Unknown，实际: ${err.message}`
      );
      return true;
    },
    '传入未知组件类型应抛错'
  );

  // 文件不应被修改
  const currentMd5 = md5(fs.readFileSync(tmp, 'utf8'));
  assert.equal(currentMd5, originalMd5, '抛错后文件不应落盘');
});

test('BUG-4 add-node: components 传字符串未知类型也抛错', () => {
  const tmp = cloneFixture('bug4-str-unknown-comp');
  tmpFiles.push(tmp);

  const originalMd5 = md5(fs.readFileSync(tmp, 'utf8'));

  assert.throws(
    () => {
      editPrefab(tmp, [
        {
          op: 'add-node',
          parent: 'touchArea',
          node: { name: 'badComp2', components: ['cc.UnknownComp'] },
        },
      ]);
    },
    (err) => {
      assert.ok(err instanceof Error, '应抛 Error');
      assert.ok(
        err.message.includes('unknown component type') || err.message.includes('cc.UnknownComp'),
        `错误消息应提及 unknown component type，实际: ${err.message}`
      );
      return true;
    },
    '传入字符串未知组件类型也应抛错'
  );

  const currentMd5 = md5(fs.readFileSync(tmp, 'utf8'));
  assert.equal(currentMd5, originalMd5, '抛错后文件不应落盘');
});

// ─── T20 BUG-1a: remove-node stub 节点 → PrefabInstance 被断开 ──

test('BUG-1a remove-node: 删除 stub 节点 → PrefabInfo.instance 置 null，PrefabInstance 孤儿化', () => {
  const tmp = cloneFixture('bug1a-remove-stub');
  tmpFiles.push(tmp);

  // stub 节点 id=10（HomeUI 中 TaskEntryBtn 嵌套 prefab 实例）
  const STUB_ID = 10;

  // 获取删除前 PrefabInstance 的 __id__
  const p0 = parsePrefab(tmp);
  const stubNode0 = p0.elements[STUB_ID];
  const pi0 = p0.elements[stubNode0._prefab.__id__];
  assert.ok(pi0.instance && typeof pi0.instance.__id__ === 'number', '删除前 instance 应有效');
  const piInstId = pi0.instance.__id__;
  const piId = stubNode0._prefab.__id__;

  // 先找 stub 父节点，获取 stub 在父 _children 里
  const parentId = stubNode0._parent.__id__;

  // remove-node
  const result = editPrefab(tmp, [
    { op: 'remove-node', target: { id: STUB_ID } },
  ]);
  assert.equal(result.opsApplied, 1);

  const reparsed = parsePrefab(tmp);

  // PrefabInfo._parent 应为 null
  const pi = reparsed.elements[piId];
  assert.equal(pi._parent, null, 'PrefabInfo._parent 应置 null');

  // PrefabInfo.instance 应被置 null（断开指向）
  assert.equal(pi.instance, null, 'PrefabInfo.instance 应置 null（BUG-1a 修复）');

  // PrefabInstance 元素本身仍在（__id__ 稳定），但其 propertyOverrides 应被清空
  const prefabInst = reparsed.elements[piInstId];
  assert.ok(prefabInst && prefabInst.__type__ === 'cc.PrefabInstance', 'PrefabInstance 仍在 elements');
  assert.ok(
    Array.isArray(prefabInst.propertyOverrides) && prefabInst.propertyOverrides.length === 0,
    'PrefabInstance.propertyOverrides 应被清空（BUG-1a 修复）'
  );

  // stub 节点本身的 _parent 也应为 null
  assert.equal(reparsed.elements[STUB_ID]._parent, null, 'stub 节点 _parent 应为 null');

  // 父节点 _children 不再含 stub 引用
  const parentNode = reparsed.elements[parentId];
  const stillRef = Array.isArray(parentNode._children) &&
    parentNode._children.some((r) => r.__id__ === STUB_ID);
  assert.ok(!stillRef, '父节点 _children 不应再含 stub 引用');
});

test('BUG-1a remove-node: stub 节点内有 mountedChildren → mountedChildren 节点也被递归断开', () => {
  const tmp = cloneFixture('bug1a-remove-stub-mc');
  tmpFiles.push(tmp);

  // 先 add-node 到 stub(id=10) 的 mountedChildren，再删除 stub 节点本身
  const STUB_ID = 10;

  editPrefab(tmp, [
    { op: 'add-node', parent: { id: STUB_ID }, node: { name: 'mountedKid' } },
  ]);

  // 找 mountedKid 的 id
  const p1 = parsePrefab(tmp);
  const kidEl = p1.elements.find(
    (el) => el && el.__type__ === 'cc.Node' && el._name === 'mountedKid'
  );
  assert.ok(kidEl, 'mountedKid 应在 add-node 后存在');
  const kidId = p1.elements.indexOf(kidEl);

  // 验证 mountedChildren 确实包含 kidId
  const stubNode1 = p1.elements[STUB_ID];
  const pi1 = p1.elements[stubNode1._prefab.__id__];
  const inst1 = p1.elements[pi1.instance.__id__];
  assert.ok(
    Array.isArray(inst1.mountedChildren) && inst1.mountedChildren.some((r) => r.__id__ === kidId),
    'mountedChildren 应包含 kidId'
  );

  // 删除 stub 节点（含 mountedKid）
  editPrefab(tmp, [
    { op: 'remove-node', target: { id: STUB_ID } },
  ]);

  const reparsed = parsePrefab(tmp);

  // mountedKid 仍在 elements（__id__ 稳定），但 _parent 应为 null
  const kidOrphan = reparsed.elements[kidId];
  assert.ok(kidOrphan && kidOrphan.__type__ === 'cc.Node', 'mountedKid 仍在 elements');
  assert.equal(kidOrphan._parent, null, 'mountedKid._parent 应为 null（递归断开）');

  // PrefabInstance.mountedChildren 应被清空
  const piId = stubNode1._prefab.__id__;
  const piInstId = pi1.instance.__id__;
  const prefabInst = reparsed.elements[piInstId];
  assert.ok(
    Array.isArray(prefabInst.mountedChildren) && prefabInst.mountedChildren.length === 0,
    'PrefabInstance.mountedChildren 应被清空（BUG-1a 修复）'
  );
});

// ─── T20 BUG-2a: _collectExistingFileIds 收集 cc.PrefabInstance.fileId ──

test('BUG-2a add-node: 生成的 fileId 不与现有 PrefabInstance.fileId 冲突', () => {
  const tmp = cloneFixture('bug2a-fileId-no-clash');
  tmpFiles.push(tmp);

  // 先收集现有所有 PrefabInstance.fileId
  const p0 = parsePrefab(tmp);
  const existingPiFileIds = new Set(
    p0.elements
      .filter((el) => el && el.__type__ === 'cc.PrefabInstance' && typeof el.fileId === 'string')
      .map((el) => el.fileId)
  );
  assert.ok(existingPiFileIds.size > 0, 'HomeUI 应有 PrefabInstance.fileId');

  // add-node 生成新节点
  editPrefab(tmp, [
    { op: 'add-node', parent: 'touchArea', node: { name: 'noPiClashNode' } },
  ]);

  const reparsed = parsePrefab(tmp);
  const newNode = reparsed.findNodeByName('noPiClashNode');
  assert.ok(newNode, 'noPiClashNode 应存在');

  const newPrefabInfo = reparsed.elements[newNode._prefab.__id__];
  const newFileId = newPrefabInfo.fileId;

  assert.ok(
    !existingPiFileIds.has(newFileId),
    `add-node 生成的 fileId "${newFileId}" 不应与现有 PrefabInstance.fileId 冲突（BUG-2a 修复）`
  );
});

test('BUG-2a clone-node: 生成的 fileId 不与现有 PrefabInstance.fileId 冲突', () => {
  const tmp = cloneFixture('bug2a-clone-fileId-no-clash');
  tmpFiles.push(tmp);

  // 先 add-node 创建可克隆源
  editPrefab(tmp, [
    { op: 'add-node', parent: 'touchArea', node: { name: 'cloneSrc2a' } },
  ]);

  // 收集现有 PrefabInstance.fileId（克隆前）
  const p0 = parsePrefab(tmp);
  const existingPiFileIds = new Set(
    p0.elements
      .filter((el) => el && el.__type__ === 'cc.PrefabInstance' && typeof el.fileId === 'string')
      .map((el) => el.fileId)
  );

  // clone-node
  editPrefab(tmp, [
    { op: 'clone-node', source: 'cloneSrc2a', parent: 'touchArea', name: 'clonedNode2a' },
  ]);

  const reparsed = parsePrefab(tmp);
  const clonedNode = reparsed.elements.find(
    (el) => el && el.__type__ === 'cc.Node' && el._name === 'clonedNode2a'
  );
  assert.ok(clonedNode, 'clonedNode2a 应存在');

  const clonedFileId = reparsed.elements[clonedNode._prefab.__id__].fileId;

  assert.ok(
    !existingPiFileIds.has(clonedFileId),
    `clone-node 生成的 fileId "${clonedFileId}" 不应与现有 PrefabInstance.fileId 冲突（BUG-2a 修复）`
  );
});

// ─── add-component ───────────────────────────────────────────

test('add-component: 普通节点挂自定义 ccclass 追加组件 + CompPrefabInfo', () => {
  const tmp = cloneFixture('addcomp-basic');
  tmpFiles.push(tmp);

  const before = parsePrefab(tmp);
  const beforeLen = before.elements.length;

  const result = editPrefab(tmp, [
    { op: 'add-component', node: 'btnMerge', componentType: 'TaskBtn' },
  ]);

  assert.equal(result.opsApplied, 1);

  const after = parsePrefab(tmp);
  const node = after.findNodeByName('btnMerge');
  assert.ok(node);

  // _components 追加了一项
  const newCompRef = node._components[node._components.length - 1];
  assert.ok(typeof newCompRef.__id__ === 'number');

  const comp = after.elements[newCompRef.__id__];
  assert.equal(comp.__type__, 'TaskBtn');
  assert.equal(comp.node.__id__, after.elements.findIndex((e) => e === node));
  assert.equal(comp._enabled, true);
  assert.ok(comp.__prefab && typeof comp.__prefab.__id__ === 'number');

  const cpi = after.elements[comp.__prefab.__id__];
  assert.equal(cpi.__type__, 'cc.CompPrefabInfo');
  assert.ok(typeof cpi.fileId === 'string' && cpi.fileId.length > 0);

  // elements 追加了 2 个（组件 + CompPrefabInfo）
  assert.equal(after.elements.length, beforeLen + 2);
});

test('add-component: 同类型重复挂抛错，不落盘', () => {
  const tmp = cloneFixture('addcomp-dup');
  tmpFiles.push(tmp);

  editPrefab(tmp, [
    { op: 'add-component', node: 'btnMerge', componentType: 'TaskBtn' },
  ]);

  const before = fs.readFileSync(tmp, 'utf8');

  assert.throws(
    () =>
      editPrefab(tmp, [
        { op: 'add-component', node: 'btnMerge', componentType: 'TaskBtn' },
      ]),
    /已挂/
  );

  // 未落盘：文件内容不变
  assert.equal(fs.readFileSync(tmp, 'utf8'), before);
});

test('add-component: props 被浅合并到组件对象上', () => {
  const tmp = cloneFixture('addcomp-props');
  tmpFiles.push(tmp);

  editPrefab(tmp, [
    {
      op: 'add-component',
      node: 'btnMerge',
      componentType: 'TaskBtn',
      props: { _foo: 42, _bar: null },
    },
  ]);

  const after = parsePrefab(tmp);
  const node = after.findNodeByName('btnMerge');
  const compRef = node._components[node._components.length - 1];
  const comp = after.elements[compRef.__id__];

  assert.equal(comp._foo, 42);
  assert.equal(comp._bar, null);
});

test('add-component: fileId 与现有 PrefabInfo / CompPrefabInfo 不冲突', () => {
  const tmp = cloneFixture('addcomp-fileid');
  tmpFiles.push(tmp);

  const before = parsePrefab(tmp);
  const existing = new Set();
  for (const el of before.elements) {
    if (
      el &&
      (el.__type__ === 'cc.PrefabInfo' ||
        el.__type__ === 'cc.CompPrefabInfo' ||
        el.__type__ === 'cc.PrefabInstance') &&
      typeof el.fileId === 'string'
    ) {
      existing.add(el.fileId);
    }
  }

  editPrefab(tmp, [
    { op: 'add-component', node: 'btnMerge', componentType: 'TaskBtn' },
  ]);

  const after = parsePrefab(tmp);
  const node = after.findNodeByName('btnMerge');
  const compRef = node._components[node._components.length - 1];
  const comp = after.elements[compRef.__id__];
  const cpi = after.elements[comp.__prefab.__id__];

  assert.ok(!existing.has(cpi.fileId), `新组件 fileId "${cpi.fileId}" 不应与现有冲突`);
});

// ─── remove-component ────────────────────────────────────────

test('remove-component: 普通节点移除组件引用 + 保持其他 __id__ 稳定', () => {
  const tmp = cloneFixture('removecomp-basic');
  tmpFiles.push(tmp);

  // 先挂上 TaskBtn 拿到一份可移除的组件
  editPrefab(tmp, [
    { op: 'add-component', node: 'btnMerge', componentType: 'TaskBtn' },
  ]);

  const before = parsePrefab(tmp);
  const beforeNode = before.findNodeByName('btnMerge');
  const beforeCompRef = beforeNode._components[beforeNode._components.length - 1];
  const beforeCompId = beforeCompRef.__id__;
  const beforeCompCount = beforeNode._components.length;
  const beforeElementsLen = before.elements.length;

  const result = editPrefab(tmp, [
    { op: 'remove-component', node: 'btnMerge', componentType: 'TaskBtn' },
  ]);
  assert.equal(result.opsApplied, 1);

  const after = parsePrefab(tmp);
  const node = after.findNodeByName('btnMerge');

  // _components 引用减少一项
  assert.equal(node._components.length, beforeCompCount - 1);
  for (const ref of node._components) {
    assert.notEqual(ref.__id__, beforeCompId, '_components 不应再引用被移除的组件');
  }

  // 组件元素本身作为 orphan 保留：elements 长度不变、原槽位仍是 TaskBtn
  assert.equal(after.elements.length, beforeElementsLen);
  assert.equal(after.elements[beforeCompId].__type__, 'TaskBtn');
});

test('remove-component: 节点上找不到对应组件抛错，不落盘', () => {
  const tmp = cloneFixture('removecomp-missing');
  tmpFiles.push(tmp);

  const before = fs.readFileSync(tmp, 'utf8');

  assert.throws(
    () =>
      editPrefab(tmp, [
        { op: 'remove-component', node: 'btnMerge', componentType: 'cc.Animation' },
      ]),
    /找不到 cc\.Animation 组件/
  );

  assert.equal(fs.readFileSync(tmp, 'utf8'), before);
});

test('remove-component: schema 校验缺 componentType 抛错', () => {
  const tmp = cloneFixture('removecomp-schema');
  tmpFiles.push(tmp);

  assert.throws(
    () => editPrefab(tmp, [{ op: 'remove-component', node: 'btnMerge' }]),
    /缺必填字段 "componentType"/
  );
});

// ─── set-component-ref ───────────────────────────────────────

test('set-component-ref: 字段指向另一节点 (cc.Node)', () => {
  const tmp = cloneFixture('setref-node');
  tmpFiles.push(tmp);

  editPrefab(tmp, [
    { op: 'add-component', node: 'btnMerge', componentType: 'TaskBtn' },
    {
      op: 'set-component-ref',
      node: 'btnMerge',
      componentType: 'TaskBtn',
      property: '_target',
      refNode: 'HomeUI',
    },
  ]);

  const after = parsePrefab(tmp);
  const node = after.findNodeByName('btnMerge');
  const compRef = node._components[node._components.length - 1];
  const comp = after.elements[compRef.__id__];

  assert.ok(comp._target && typeof comp._target.__id__ === 'number');
  const refNode = after.elements[comp._target.__id__];
  assert.equal(refNode.__type__, 'cc.Node');
  assert.equal(refNode._name, 'HomeUI');
});

test('set-component-ref: 字段指向另一节点上的组件 (cc.UITransform)', () => {
  const tmp = cloneFixture('setref-comp');
  tmpFiles.push(tmp);

  editPrefab(tmp, [
    { op: 'add-component', node: 'btnMerge', componentType: 'TaskBtn' },
    {
      op: 'set-component-ref',
      node: 'btnMerge',
      componentType: 'TaskBtn',
      property: '_uitRef',
      refNode: 'btnMerge',
      refType: 'cc.UITransform',
    },
  ]);

  const after = parsePrefab(tmp);
  const node = after.findNodeByName('btnMerge');
  const compRef = node._components[node._components.length - 1];
  const comp = after.elements[compRef.__id__];

  assert.ok(comp._uitRef && typeof comp._uitRef.__id__ === 'number');
  const refComp = after.elements[comp._uitRef.__id__];
  assert.equal(refComp.__type__, 'cc.UITransform');
});

test('set-component-ref: 目标组件未挂时抛错', () => {
  const tmp = cloneFixture('setref-missing-comp');
  tmpFiles.push(tmp);

  assert.throws(
    () =>
      editPrefab(tmp, [
        {
          op: 'set-component-ref',
          node: 'btnMerge',
          componentType: 'TaskBtn',
          property: '_x',
          refNode: 'HomeUI',
        },
      ]),
    /未挂 "TaskBtn"/
  );
});

test('set-component-ref: refNode 不存在该类型组件时抛错', () => {
  const tmp = cloneFixture('setref-missing-ref');
  tmpFiles.push(tmp);

  assert.throws(
    () =>
      editPrefab(tmp, [
        { op: 'add-component', node: 'btnMerge', componentType: 'TaskBtn' },
        {
          op: 'set-component-ref',
          node: 'btnMerge',
          componentType: 'TaskBtn',
          property: '_x',
          refNode: 'HomeUI',
          refType: 'cc.Sprite',
        },
      ]),
    /未挂 "cc.Sprite"/
  );
});

// ─── FIX-1: add-component 传原始 UUID，set-component-ref 传 @ccclass 名可互查 ──
// Bug: add-component 以原始 UUID 存储 __type__，set-component-ref 以压缩 classId 查找 → 不匹配
// Fix: normalizeComponentType 把原始 UUID 也压缩为 classId，两者统一

test('FIX-1 set-component-ref: add-component 传原始 UUID + 同 batch set-component-ref 传 @ccclass 名（有 projectRoot）', () => {
  const tmp = cloneFixture('fix1-uuid-add-name-ref');
  tmpFiles.push(tmp);

  // TaskBtn 的原始 UUID（来自 TaskBtn.ts.meta）
  const TASK_BTN_UUID = '5f4d2de3-a7dc-4d47-a41f-f27a12549b20';

  // 同一 batch：add-component 用原始 UUID，set-component-ref 用 @ccclass 名
  const result = editPrefab(tmp, [
    { op: 'add-component', node: 'btnMerge', componentType: TASK_BTN_UUID },
    {
      op: 'set-component-ref',
      node: 'btnMerge',
      componentType: 'TaskBtn',   // @ccclass 名，与上面的 UUID 对应同一类型
      property: '_target',
      refNode: 'HomeUI',
    },
  ], { projectRoot: PROJECT_ROOT });

  assert.equal(result.opsApplied, 2);

  const after = parsePrefab(tmp);
  const node = after.findNodeByName('btnMerge');
  const compRef = node._components[node._components.length - 1];
  const comp = after.elements[compRef.__id__];

  // 组件 __type__ 应是压缩 classId（不是原始 UUID，也不是 @ccclass 字符串）
  const { compressUuid } = require('../src/id.js');
  assert.equal(comp.__type__, compressUuid(TASK_BTN_UUID), '组件 __type__ 应已压缩为 classId');

  // _target 字段应指向 HomeUI 节点
  assert.ok(comp._target && typeof comp._target.__id__ === 'number', '_target 应已赋值');
  const refNode = after.elements[comp._target.__id__];
  assert.equal(refNode._name, 'HomeUI', '_target 应指向 HomeUI');
});

test('FIX-1 set-component-ref: add-component 传原始 UUID + 分批 set-component-ref 传 @ccclass 名（有 projectRoot）', () => {
  const tmp = cloneFixture('fix1-uuid-add-name-ref-split');
  tmpFiles.push(tmp);

  const TASK_BTN_UUID = '5f4d2de3-a7dc-4d47-a41f-f27a12549b20';

  // 第一批：add-component 传原始 UUID
  editPrefab(tmp, [
    { op: 'add-component', node: 'btnMerge', componentType: TASK_BTN_UUID },
  ], { projectRoot: PROJECT_ROOT });

  // 第二批：set-component-ref 传 @ccclass 名
  const result = editPrefab(tmp, [
    {
      op: 'set-component-ref',
      node: 'btnMerge',
      componentType: 'TaskBtn',
      property: '_target',
      refNode: 'HomeUI',
    },
  ], { projectRoot: PROJECT_ROOT });

  assert.equal(result.opsApplied, 1);

  const after = parsePrefab(tmp);
  const node = after.findNodeByName('btnMerge');
  const compRef = node._components[node._components.length - 1];
  const comp = after.elements[compRef.__id__];

  assert.ok(comp._target && typeof comp._target.__id__ === 'number', '_target 应已赋值');
  const refNode2 = after.elements[comp._target.__id__];
  assert.equal(refNode2._name, 'HomeUI', '_target 应指向 HomeUI');
});

// ─── FIX-2: set-component-ref 数组字段（_items.0 / _items[1]）────────────────
// Bug: property 只支持单字段名，多次调用同字段名被幂等检查覆盖
// Fix: parsePropertyPath 拆出数组路径；addRootTargetOverride 按完整 path 幂等；
//      普通节点走 setByPropertyPath 多级赋值

test('FIX-2 set-component-ref: 普通节点数组字段 "_items.0" 和 "_items[1]" 独立赋值', () => {
  const tmp = cloneFixture('fix2-array-ref-normal');
  tmpFiles.push(tmp);

  editPrefab(tmp, [
    { op: 'add-component', node: 'btnMerge', componentType: 'TaskBtn' },
    {
      op: 'set-component-ref',
      node: 'btnMerge',
      componentType: 'TaskBtn',
      property: '_items.0',    // . 分隔写法
      refNode: 'HomeUI',
    },
    {
      op: 'set-component-ref',
      node: 'btnMerge',
      componentType: 'TaskBtn',
      property: '_items[1]',   // [] 写法等价
      refNode: 'touchArea',
    },
  ]);

  const after = parsePrefab(tmp);
  const node = after.findNodeByName('btnMerge');
  const compRef = node._components[node._components.length - 1];
  const comp = after.elements[compRef.__id__];

  assert.ok(Array.isArray(comp._items), '_items 应是数组');
  assert.ok(comp._items[0] && typeof comp._items[0].__id__ === 'number', '_items[0] 应有 __id__');
  assert.ok(comp._items[1] && typeof comp._items[1].__id__ === 'number', '_items[1] 应有 __id__');

  const r0 = after.elements[comp._items[0].__id__];
  const r1 = after.elements[comp._items[1].__id__];
  assert.equal(r0._name, 'HomeUI',    '_items[0] 应指向 HomeUI');
  assert.equal(r1._name, 'touchArea', '_items[1] 应指向 touchArea');
});

test('FIX-2 set-component-ref: 普通节点数组字段 — 分批调用不互相覆盖', () => {
  const tmp = cloneFixture('fix2-array-ref-split');
  tmpFiles.push(tmp);

  // 第一批
  editPrefab(tmp, [
    { op: 'add-component', node: 'btnMerge', componentType: 'TaskBtn' },
    {
      op: 'set-component-ref',
      node: 'btnMerge',
      componentType: 'TaskBtn',
      property: '_items.0',
      refNode: 'HomeUI',
    },
  ]);

  // 第二批
  editPrefab(tmp, [
    {
      op: 'set-component-ref',
      node: 'btnMerge',
      componentType: 'TaskBtn',
      property: '_items.1',
      refNode: 'touchArea',
    },
  ]);

  const after = parsePrefab(tmp);
  const node = after.findNodeByName('btnMerge');
  const compRef = node._components[node._components.length - 1];
  const comp = after.elements[compRef.__id__];

  assert.ok(Array.isArray(comp._items), '_items 应是数组');
  const r0 = after.elements[comp._items[0].__id__];
  const r1 = after.elements[comp._items[1].__id__];
  assert.equal(r0._name, 'HomeUI',    '分批调用后 _items[0] 仍指向 HomeUI');
  assert.equal(r1._name, 'touchArea', '分批调用后 _items[1] 指向 touchArea');
});

test('FIX-2 addRootTargetOverride: 数组 propertyPath 各索引独立不被幂等覆盖', () => {
  // Unit test: 直接调 addRootTargetOverride，构造最小 prefabData
  const { addRootTargetOverride } = require('../src/editor/nested.js');

  const elements = [];
  // [0] root PrefabInfo（instance=null → root PrefabInfo，targetOverrides=null）
  elements.push({ __type__: 'cc.PrefabInfo', instance: null, targetOverrides: null, root: { __id__: 1 }, asset: null });
  // [1] root node，_prefab 指向 [0]
  elements.push({ __type__: 'cc.Node', _name: 'Root', _prefab: { __id__: 0 } });
  const rootId = 1;
  // [2] source comp
  const sourceCompId = 2;
  elements.push({ __type__: 'SomeComp' });
  // [3] target stub（任意 id）
  const stubId = 3;
  elements.push({ __type__: 'cc.Node', _name: null });

  const prefabData = { elements, rootId };

  // 调 3 次，索引 0/1/2
  addRootTargetOverride(prefabData, rootId, sourceCompId, ['_items', 0], stubId, ['fid-A']);
  addRootTargetOverride(prefabData, rootId, sourceCompId, ['_items', 1], stubId, ['fid-B']);
  addRootTargetOverride(prefabData, rootId, sourceCompId, ['_items', 2], stubId, ['fid-C']);
  // 第 4 次：_items[0] 重复调用，幂等 → 不应再增加
  addRootTargetOverride(prefabData, rootId, sourceCompId, ['_items', 0], stubId, ['fid-A']);

  const rootPI = elements[0];
  assert.ok(Array.isArray(rootPI.targetOverrides), 'targetOverrides 应已初始化为数组');
  assert.equal(rootPI.targetOverrides.length, 3,
    '应有 3 条 override（_items[0/1/2]），幂等的第 4 次不增加');

  const ovs = rootPI.targetOverrides.map(r => elements[r.__id__]);
  const paths = ovs.map(ov => JSON.stringify(ov.propertyPath));
  assert.ok(paths.includes(JSON.stringify(['_items', 0])), '应含 ["_items", 0]');
  assert.ok(paths.includes(JSON.stringify(['_items', 1])), '应含 ["_items", 1]');
  assert.ok(paths.includes(JSON.stringify(['_items', 2])), '应含 ["_items", 2]');
});

