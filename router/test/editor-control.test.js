'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    EDITOR_TOOLS,
    buildEditorSpawnArgs,
    hasReadyAssetResult,
} = require('../src/editor-control.js');

test('editor restart/spawn expose noLogin option', () => {
    var names = ['editor_restart', 'editor_spawn'];

    names.forEach(function (name) {
        var tool = EDITOR_TOOLS.filter(function (t) { return t.name === name; })[0];
        assert.ok(tool, 'tool exists: ' + name);
        assert.equal(tool.inputSchema.properties.noLogin.type, 'boolean');
    });

    var waitTool = EDITOR_TOOLS.filter(function (t) { return t.name === 'editor_wait_ready'; })[0];
    assert.ok(waitTool, 'tool exists: editor_wait_ready');
    assert.equal(waitTool.inputSchema.properties.noLogin, undefined);
});

test('buildEditorSpawnArgs adds --nologin by default', () => {
    assert.deepEqual(buildEditorSpawnArgs('/project'), ['--project', '/project', '--nologin']);
});

test('buildEditorSpawnArgs can disable --nologin', () => {
    assert.deepEqual(buildEditorSpawnArgs('/project', { noLogin: false }), ['--project', '/project']);
});

test('buildEditorSpawnArgs keeps project path before --nologin', () => {
    var args = buildEditorSpawnArgs('/project path', {});

    assert.equal(args[0], '--project');
    assert.equal(args[1], '/project path');
    assert.equal(args[2], '--nologin');
});

test('hasReadyAssetResult accepts raw asset object content', () => {
    var result = hasReadyAssetResult({
        result: {
            content: [
                { name: 'assets', path: 'db://assets/config' },
            ],
        },
    });

    assert.equal(result, true);
});

test('hasReadyAssetResult accepts text JSON content', () => {
    var result = hasReadyAssetResult({
        result: {
            content: [
                { type: 'text', text: '[{"name":"assets"}]' },
            ],
        },
    });

    assert.equal(result, true);
});

test('hasReadyAssetResult rejects empty or error results', () => {
    assert.equal(hasReadyAssetResult({ result: { content: [] } }), false);
    assert.equal(hasReadyAssetResult({ error: { message: 'not ready' } }), false);
    assert.equal(hasReadyAssetResult({ result: { isError: true } }), false);
});
