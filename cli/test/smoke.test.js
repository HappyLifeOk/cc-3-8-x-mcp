'use strict';

// ============================================================
// T7 端到端 smoke test
// 测试链路：parse → 改普通节点 _lpos.x → 改 stub override → write → re-parse → 断言
// ============================================================

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { parsePrefab } = require('../src/parse.js');
const { writePrefab, detectIndent, detectTrailingNewline } = require('../src/write.js');
const { setOverrideProperty, listOverrides } = require('../src/overrides.js');

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/HomeUI.prefab');
const TMP_PATH = path.join(os.tmpdir(), `HomeUI-smoke-${Date.now()}.prefab`);

// 清理临时文件
after(() => {
  try {
    if (fs.existsSync(TMP_PATH)) fs.unlinkSync(TMP_PATH);
  } catch (_) {}
});

// ─── T4 parse 基础验证 ─────────────────────────────────────

test('parsePrefab: 正常读取 HomeUI.prefab', () => {
  assert.ok(fs.existsSync(FIXTURE_PATH), `fixture 文件不存在: ${FIXTURE_PATH}`);
  const prefabData = parsePrefab(FIXTURE_PATH);

  assert.ok(typeof prefabData.raw === 'string' && prefabData.raw.length > 0, 'raw 应是非空字符串');
  assert.ok(Array.isArray(prefabData.elements) && prefabData.elements.length > 0, 'elements 应是非空数组');
  assert.ok(typeof prefabData.rootId === 'number' && prefabData.rootId >= 0, 'rootId 应是非负整数');
});

test('parsePrefab: getRoot 返回根 cc.Node', () => {
  const prefabData = parsePrefab(FIXTURE_PATH);
  const root = prefabData.getRoot();
  assert.ok(root, 'getRoot() 不应为 null');
  assert.equal(root.__type__, 'cc.Node', 'getRoot() 应返回 cc.Node');
  assert.equal(root._name, 'HomeUI', '根节点名称应是 HomeUI');
});

test('parsePrefab: resolveRef 按 __id__ 返回正确 element', () => {
  const prefabData = parsePrefab(FIXTURE_PATH);
  const el0 = prefabData.resolveRef({ __id__: 0 });
  assert.equal(el0.__type__, 'cc.Prefab', '__id__=0 应是 cc.Prefab 头');
  const el1 = prefabData.resolveRef({ __id__: 1 });
  assert.equal(el1.__type__, 'cc.Node', '__id__=1 应是 cc.Node');
});

test('parsePrefab: findNodeByName 递归查找命名节点', () => {
  const prefabData = parsePrefab(FIXTURE_PATH);
  const node = prefabData.findNodeByName('touchArea');
  assert.ok(node, 'touchArea 节点应能找到');
  assert.equal(node.__type__, 'cc.Node');
  assert.equal(node._name, 'touchArea');
});

test('parsePrefab: findNodeByName 不存在时返回 null', () => {
  const prefabData = parsePrefab(FIXTURE_PATH);
  const node = prefabData.findNodeByName('__this_node_does_not_exist__');
  assert.equal(node, null);
});

test('parsePrefab: findNodesByType 查找所有 PrefabInstance', () => {
  const prefabData = parsePrefab(FIXTURE_PATH);
  const instances = prefabData.findNodesByType('cc.PrefabInstance');
  assert.ok(Array.isArray(instances) && instances.length > 0, '应找到至少 1 个 PrefabInstance');
  for (const inst of instances) {
    assert.equal(inst.__type__, 'cc.PrefabInstance');
  }
});

// ─── T5 write 格式检测验证 ────────────────────────────────

test('detectIndent: 正确识别 2 空格缩进', () => {
  const sample = '[\n  {\n    "a": 1\n  }\n]\n';
  assert.equal(detectIndent(sample), 2);
});

test('detectIndent: 正确识别 4 空格缩进', () => {
  const sample = '[\n    {\n        "a": 1\n    }\n]\n';
  assert.equal(detectIndent(sample), 4);
});

test('detectTrailingNewline: 末尾换行检测', () => {
  assert.equal(detectTrailingNewline('foo\n'), true);
  assert.equal(detectTrailingNewline('foo'), false);
  assert.equal(detectTrailingNewline(''), false);
});

test('writePrefab: 格式保真 - 缩进和末尾换行与原文件一致', () => {
  const prefabData = parsePrefab(FIXTURE_PATH);
  const originalIndent = detectIndent(prefabData.raw);
  const originalTrailing = detectTrailingNewline(prefabData.raw);

  // 不做任何修改，直接写回到临时路径
  writePrefab(TMP_PATH, prefabData.elements, prefabData.raw);

  const written = fs.readFileSync(TMP_PATH, 'utf8');
  assert.equal(detectIndent(written), originalIndent, '缩进应与原文件一致');
  assert.equal(detectTrailingNewline(written), originalTrailing, '末尾换行应与原文件一致');
});

// ─── 端到端：改普通节点 _lpos.x → write → re-parse → 断言 ──

test('端到端: 改普通节点 _lpos.x + 写回 + 验证', () => {
  const prefabData = parsePrefab(FIXTURE_PATH);

  // 找 'left' 节点（普通节点，非 stub，_lpos.x = -243）
  const leftNode = prefabData.findNodeByName('left');
  assert.ok(leftNode, "'left' 节点应存在");
  assert.ok(typeof leftNode._lpos === 'object', "'left' 节点应有 _lpos");

  const originalX = leftNode._lpos.x;
  const newX = originalX + 999;

  // 直接修改 elements 中的对象（引用语义）
  leftNode._lpos.x = newX;

  // 写到临时文件
  writePrefab(TMP_PATH, prefabData.elements, prefabData.raw);

  // 重新解析验证
  const reparsed = parsePrefab(TMP_PATH);
  const leftNodeAgain = reparsed.findNodeByName('left');
  assert.ok(leftNodeAgain, '写回后 left 节点仍可查找');
  assert.equal(leftNodeAgain._lpos.x, newX, '_lpos.x 应已更新');

  // 确认其他字段未变（检查 y 和 z）
  assert.equal(leftNodeAgain._lpos.y, leftNode._lpos.y, '_lpos.y 不应变化');
  assert.equal(leftNodeAgain._lpos.z, leftNode._lpos.z, '_lpos.z 不应变化');
});

// ─── 端到端：改 stub 节点 override → write → re-parse → 断言 ─

test('端到端: 更新 stub 节点已有 override (_lpos) + 写回 + 验证', () => {
  const prefabData = parsePrefab(FIXTURE_PATH);

  // stub 节点 index 10（PrefabInfo index 11, fileId='as0LdMaKxSWSLxrZB9u9KA'）
  // 已有 _lpos override: {x: -272, y: 53, z: 0}
  const STUB_ID = 10;

  const overridesBefore = listOverrides(prefabData, STUB_ID);
  const lposBefore = overridesBefore.find((o) => o.propertyPath[0] === '_lpos');
  assert.ok(lposBefore, 'stub 节点应已有 _lpos override');

  const newLpos = { __type__: 'cc.Vec3', x: 100, y: 200, z: 0 };
  setOverrideProperty(prefabData, STUB_ID, ['_lpos'], newLpos);

  writePrefab(TMP_PATH, prefabData.elements, prefabData.raw);

  // 重新解析
  const reparsed = parsePrefab(TMP_PATH);
  const overridesAfter = listOverrides(reparsed, STUB_ID);
  const lposAfter = overridesAfter.find((o) => o.propertyPath[0] === '_lpos');

  assert.ok(lposAfter, 're-parse 后 _lpos override 仍存在');
  assert.equal(lposAfter.value.x, 100, '_lpos.x 应已更新为 100');
  assert.equal(lposAfter.value.y, 200, '_lpos.y 应已更新为 200');
});

test('端到端: 新增 stub 节点 override (不存在的属性) + 写回 + 验证', () => {
  const prefabData = parsePrefab(FIXTURE_PATH);

  const STUB_ID = 10;
  const overridesBefore = listOverrides(prefabData, STUB_ID);
  const countBefore = overridesBefore.length;

  // 新增一个不存在的 override（以自定义属性为例）
  const customValue = { __type__: 'cc.Vec3', x: 77, y: 88, z: 0 };
  // 用 _lscale 测试（已有），换成其他路径新增
  // 实际新增：用 '__smoke_test_prop' 路径（Cocos 不认识，但结构正确）
  setOverrideProperty(prefabData, STUB_ID, ['__smoke_test_prop'], customValue);

  const overridesAfter = listOverrides(prefabData, STUB_ID);
  assert.equal(overridesAfter.length, countBefore + 1, 'override 数量应增加 1');

  writePrefab(TMP_PATH, prefabData.elements, prefabData.raw);

  // 重新解析
  const reparsed = parsePrefab(TMP_PATH);
  const overridesFinal = listOverrides(reparsed, STUB_ID);
  const newOverride = overridesFinal.find((o) => o.propertyPath[0] === '__smoke_test_prop');
  assert.ok(newOverride, '新增的 override 在 re-parse 后应能找到');
  assert.equal(newOverride.value.x, 77);
  assert.equal(newOverride.value.y, 88);
});

// ─── JSON diff 精确性验证 ─────────────────────────────────

test('JSON diff 精确：只有目标字段变化', () => {
  const prefabData = parsePrefab(FIXTURE_PATH);
  const touchArea = prefabData.findNodeByName('touchArea');
  assert.ok(touchArea, 'touchArea 应存在');

  const originalY = touchArea._lpos.y;
  touchArea._lpos.y = originalY + 12345;

  writePrefab(TMP_PATH, prefabData.elements, prefabData.raw);

  const reparsed = parsePrefab(TMP_PATH);

  // 验证目标字段变化
  const touchAreaAgain = reparsed.findNodeByName('touchArea');
  assert.equal(touchAreaAgain._lpos.y, originalY + 12345, '目标字段应变化');

  // 验证其他节点未变（采样检查根节点）
  const root = reparsed.getRoot();
  assert.equal(root._name, 'HomeUI', '根节点名称不应变化');
  assert.equal(root._lpos.x, 0, '根节点 _lpos.x 不应变化');

  // 验证总 element 数量不变（没有意外新增/删除）
  const origParsed = parsePrefab(FIXTURE_PATH);
  assert.equal(reparsed.elements.length, origParsed.elements.length, 'element 总数应不变');
});

