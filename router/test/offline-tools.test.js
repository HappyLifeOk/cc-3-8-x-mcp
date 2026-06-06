'use strict';

// ============================================================
// router/test/offline-tools.test.js
// T13 offline tool 测试
//
// 直接 require router/src/offline-tools.js，测：
//   1. prefab_query  happy path（tree / node / find）
//   2. prefab_edit   happy path（set-active 写 tmp 文件）
//   3. prefab_batch  happy path（opsJson 文件 → editPrefab）
//   4. 相对路径 filePath 报错
//   5. prefab_batch opsJsonPath 相对路径报错
// ============================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    isOfflineTool,
    handleOfflineToolCall,
    requireAbsolutePath,
    OFFLINE_TOOLS,
} = require('../src/offline-tools.js');

// fixture: HomeUI.prefab（只读，在 cli/test/fixtures/）
const FIXTURE_PATH = path.resolve(
    __dirname,
    '../../cli/test/fixtures/HomeUI.prefab'
);

// 复制 fixture 到 tmp 用于写操作
function makeTmp(tag) {
    var dst = path.join(os.tmpdir(), 'HomeUI-router-' + tag + '-' + Date.now() + '.prefab');
    fs.copyFileSync(FIXTURE_PATH, dst);
    return dst;
}

// ── OFFLINE_TOOLS 定义完整性 ────────────────────────────────────

test('OFFLINE_TOOLS 导出 3 个 tool，名称正确', () => {
    assert.equal(OFFLINE_TOOLS.length, 3);
    var names = OFFLINE_TOOLS.map(function (t) { return t.name; });
    assert.ok(names.includes('prefab_query'));
    assert.ok(names.includes('prefab_edit'));
    assert.ok(names.includes('prefab_batch'));
});

test('isOfflineTool 对已知 name 返回 true，未知 name 返回 false', () => {
    assert.equal(isOfflineTool('prefab_query'), true);
    assert.equal(isOfflineTool('prefab_edit'), true);
    assert.equal(isOfflineTool('prefab_batch'), true);
    assert.equal(isOfflineTool('router_list_editors'), false);
    assert.equal(isOfflineTool('scene_set_property'), false);
    assert.equal(isOfflineTool(''), false);
});

test('每个 offline tool description 包含 "[offline]" 标注', () => {
    for (var t of OFFLINE_TOOLS) {
        assert.ok(
            t.description.includes('[offline]'),
            'tool ' + t.name + ' description 应包含 "[offline]"'
        );
    }
});

// ── requireAbsolutePath ────────────────────────────────────────

test('requireAbsolutePath 相对路径抛错', () => {
    assert.throws(
        function () { requireAbsolutePath('relative/path.prefab', 'test'); },
        /必须是绝对路径/
    );
});

test('requireAbsolutePath 绝对路径不抛错', () => {
    assert.doesNotThrow(function () {
        requireAbsolutePath('/absolute/path.prefab', 'test');
    });
});

// ── prefab_query happy path ─────────────────────────────────────

test('prefab_query type=tree 返回 MCP content，根节点名称为 HomeUI', async () => {
    var result = await handleOfflineToolCall('prefab_query', {
        filePath: FIXTURE_PATH,
        selector: { type: 'tree' },
    });

    assert.ok(Array.isArray(result.content), 'result.content 应是数组');
    assert.equal(result.content[0].type, 'text');

    var data = JSON.parse(result.content[0].text);
    assert.equal(data.name, 'HomeUI', '根节点 name 应为 HomeUI');
    assert.ok(Array.isArray(data.children), 'children 应是数组');
});

test('prefab_query 无 selector 默认返回 tree', async () => {
    var result = await handleOfflineToolCall('prefab_query', {
        filePath: FIXTURE_PATH,
    });

    var data = JSON.parse(result.content[0].text);
    assert.equal(data.name, 'HomeUI');
});

test('prefab_query type=find 返回 cc.Label id 列表', async () => {
    var result = await handleOfflineToolCall('prefab_query', {
        filePath: FIXTURE_PATH,
        selector: { type: 'find', nodeType: 'cc.Label' },
    });

    var ids = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(ids), 'find 结果应是数组');
    assert.ok(ids.length > 0, '应找到至少一个 cc.Label');
    ids.forEach(function (id) { assert.equal(typeof id, 'number'); });
});

// ── prefab_query 相对路径报错 ────────────────────────────────────

test('prefab_query 相对路径 filePath 抛错', async () => {
    await assert.rejects(
        function () {
            return handleOfflineToolCall('prefab_query', {
                filePath: 'relative/HomeUI.prefab',
            });
        },
        /必须是绝对路径/
    );
});

// ── prefab_edit happy path ──────────────────────────────────────

test('prefab_edit set-active 成功，返回 changed=true + opsApplied=1', async () => {
    var tmp = makeTmp('edit');
    try {
        var result = await handleOfflineToolCall('prefab_edit', {
            filePath: tmp,
            ops: [
                { op: 'set-active', node: 'HomeUI', active: false },
            ],
        });

        var data = JSON.parse(result.content[0].text);
        assert.equal(data.changed, true, 'changed 应为 true');
        assert.equal(data.opsApplied, 1, 'opsApplied 应为 1');
        assert.ok(Array.isArray(data.nodesAffected), 'nodesAffected 应是数组');
    } finally {
        try { fs.unlinkSync(tmp); } catch (_) {}
    }
});

// ── prefab_edit 相对路径报错 ─────────────────────────────────────

test('prefab_edit 相对路径 filePath 抛错', async () => {
    await assert.rejects(
        function () {
            return handleOfflineToolCall('prefab_edit', {
                filePath: './relative.prefab',
                ops: [{ op: 'set-active', node: 'HomeUI', active: false }],
            });
        },
        /必须是绝对路径/
    );
});

// ── prefab_batch happy path ─────────────────────────────────────

test('prefab_batch 从 JSON 文件读取 ops，成功写回', async () => {
    var tmp = makeTmp('batch');
    var opsJson = path.join(os.tmpdir(), 'router-batch-ops-' + Date.now() + '.json');
    var ops = [
        { op: 'set-active', node: 'HomeUI', active: true },
    ];
    fs.writeFileSync(opsJson, JSON.stringify(ops), 'utf-8');

    try {
        var result = await handleOfflineToolCall('prefab_batch', {
            filePath: tmp,
            opsJsonPath: opsJson,
        });

        var data = JSON.parse(result.content[0].text);
        assert.equal(data.changed, true);
        assert.equal(data.opsApplied, 1);
    } finally {
        try { fs.unlinkSync(tmp); } catch (_) {}
        try { fs.unlinkSync(opsJson); } catch (_) {}
    }
});

// ── prefab_batch 相对路径报错 ────────────────────────────────────

test('prefab_batch 相对路径 filePath 抛错', async () => {
    await assert.rejects(
        function () {
            return handleOfflineToolCall('prefab_batch', {
                filePath: 'relative.prefab',
                opsJsonPath: '/absolute/ops.json',
            });
        },
        /必须是绝对路径/
    );
});

test('prefab_batch 相对路径 opsJsonPath 抛错', async () => {
    await assert.rejects(
        function () {
            return handleOfflineToolCall('prefab_batch', {
                filePath: FIXTURE_PATH,
                opsJsonPath: 'relative/ops.json',
            });
        },
        /必须是绝对路径/
    );
});
