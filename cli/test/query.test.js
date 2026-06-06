'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { queryPrefab } = require('../src/query/index.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'HomeUI.prefab');

// ─── selector: tree ─────────────────────────────────────────

test('queryPrefab tree - 返回精简节点树，根节点具备必要字段', () => {
  const tree = queryPrefab(FIXTURE, { type: 'tree' });

  assert.equal(typeof tree, 'object', 'tree 应是对象');
  assert.ok('id' in tree, 'tree 应有 id 字段');
  assert.equal(tree.name, 'HomeUI', '根节点名称应为 HomeUI');
  assert.equal(tree.type, 'cc.Node', '根节点 type 应为 cc.Node');
  assert.ok(Array.isArray(tree.children), 'children 应是数组');
  assert.ok(Array.isArray(tree.componentTypes), 'componentTypes 应是数组');
  assert.equal(typeof tree.isStub, 'boolean', 'isStub 应是布尔');
  assert.equal(tree.isStub, false, '根节点不是 stub');
});

test('queryPrefab tree - 无 selector 参数默认返回 tree', () => {
  const tree = queryPrefab(FIXTURE);
  assert.equal(tree.name, 'HomeUI', '无 selector 时应默认返回节点树');
});

test('queryPrefab tree - 树结构中存在 stub 节点，且 isStub=true + overrides 非空', () => {
  const tree = queryPrefab(FIXTURE, { type: 'tree' });

  // DFS 收集所有节点
  function collectAll(node) {
    const result = [node];
    for (const child of node.children) {
      result.push(...collectAll(child));
    }
    return result;
  }

  const allNodes = collectAll(tree);
  const stubs = allNodes.filter((n) => n.isStub);

  assert.ok(stubs.length > 0, '应至少存在一个 stub 节点');

  for (const stub of stubs) {
    assert.ok('overrides' in stub, `stub 节点 ${stub.id} 应包含 overrides 字段`);
    assert.ok(Array.isArray(stub.overrides), `stub 节点 ${stub.id} overrides 应是数组`);
    assert.ok(stub.overrides.length > 0, `stub 节点 ${stub.id} overrides 不应为空`);

    // 每条 override 应有 propertyPath 和 value
    for (const ov of stub.overrides) {
      assert.ok(Array.isArray(ov.propertyPath), 'override.propertyPath 应是数组');
      assert.ok(ov.propertyPath.length > 0, 'override.propertyPath 不应为空');
      assert.ok('value' in ov, 'override 应有 value 字段');
    }
  }
});

test('queryPrefab tree - 非 stub 节点没有 overrides 字段', () => {
  const tree = queryPrefab(FIXTURE, { type: 'tree' });

  function collectAll(node) {
    const result = [node];
    for (const child of node.children) {
      result.push(...collectAll(child));
    }
    return result;
  }

  const nonStubs = collectAll(tree).filter((n) => !n.isStub);
  for (const n of nonStubs) {
    assert.ok(!('overrides' in n), `非 stub 节点 ${n.id} 不应有 overrides 字段`);
  }
});

// ─── selector: node ─────────────────────────────────────────

test('queryPrefab node - 按名称查找普通节点（touchArea）', () => {
  const result = queryPrefab(FIXTURE, { type: 'node', name: 'touchArea' });

  assert.notEqual(result, null, '应找到 touchArea 节点');
  assert.equal(result.name, 'touchArea', 'name 应匹配');
  assert.equal(result.type, 'cc.Node');
  assert.equal(result.isStub, false, 'touchArea 不是 stub');
  assert.ok(Array.isArray(result.componentTypes), 'componentTypes 应是数组');
  assert.ok('raw' in result, '应包含 raw 原始数据');
  assert.ok(!('overrides' in result), '非 stub 不应有 overrides 字段');
});

test('queryPrefab node - 按 override._name 查找 stub 节点', () => {
  // stub 节点的 _name 存在 override 里，不在节点本体
  // HomeUI.prefab 第一个 stub id=10 override _name='taskEntry'
  const result = queryPrefab(FIXTURE, { type: 'node', name: 'taskEntry' });

  assert.notEqual(result, null, '应能通过 override._name 找到 stub 节点 taskEntry');
  assert.equal(result.name, 'taskEntry');
  assert.equal(result.isStub, true, 'taskEntry 应是 stub 节点');
  assert.ok(Array.isArray(result.overrides), 'stub 节点应有 overrides');
  assert.ok(result.overrides.length > 0, 'overrides 不应为空');
});

test('queryPrefab node - 查找不存在的节点返回 null', () => {
  const result = queryPrefab(FIXTURE, { type: 'node', name: '__nonexistent__' });
  assert.equal(result, null, '不存在的节点应返回 null');
});

test('queryPrefab node - 缺少 name 时抛出错误', () => {
  assert.throws(
    () => queryPrefab(FIXTURE, { type: 'node' }),
    /selector\.name/,
    '缺少 name 应抛出含 selector.name 的错误'
  );
});

// ─── selector: find ─────────────────────────────────────────

test('queryPrefab find - 返回所有 cc.Node 的 id 列表', () => {
  const ids = queryPrefab(FIXTURE, { type: 'find', nodeType: 'cc.Node' });

  assert.ok(Array.isArray(ids), '应返回数组');
  assert.ok(ids.length > 0, 'cc.Node 数量应 > 0');
  assert.ok(ids.every((id) => typeof id === 'number'), '所有 id 应是数字');
});

test('queryPrefab find - 返回所有 cc.PrefabInstance 的 id 列表，与 stub 节点数量匹配', () => {
  const instanceIds = queryPrefab(FIXTURE, { type: 'find', nodeType: 'cc.PrefabInstance' });
  assert.ok(instanceIds.length > 0, '应有至少一个 cc.PrefabInstance');

  // stub 节点数量应等于 PrefabInstance 数量
  const tree = queryPrefab(FIXTURE, { type: 'tree' });
  function countStubs(node) {
    let n = node.isStub ? 1 : 0;
    for (const c of node.children) n += countStubs(c);
    return n;
  }
  const stubCount = countStubs(tree);
  assert.equal(instanceIds.length, stubCount,
    `PrefabInstance 数量(${instanceIds.length}) 应等于树中 stub 数量(${stubCount})`);
});

test('queryPrefab find - 不存在的 type 返回空数组', () => {
  const ids = queryPrefab(FIXTURE, { type: 'find', nodeType: 'cc.NonExistentType' });
  assert.ok(Array.isArray(ids), '应返回数组');
  assert.equal(ids.length, 0, '不存在的 type 应返回空数组');
});

test('queryPrefab find - 缺少 nodeType 时抛出错误', () => {
  assert.throws(
    () => queryPrefab(FIXTURE, { type: 'find' }),
    /selector\.nodeType/,
    '缺少 nodeType 应抛出含 selector.nodeType 的错误'
  );
});

// ─── 未知 type 错误 ──────────────────────────────────────────

test('queryPrefab - 未知 selector.type 抛出错误', () => {
  assert.throws(
    () => queryPrefab(FIXTURE, { type: 'unknown' }),
    /未知.*selector\.type/,
    '未知 type 应抛出错误'
  );
});
