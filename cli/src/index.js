'use strict';

// 统一入口：re-export 所有公开 API
const { parsePrefab } = require('./parse.js');
const { writePrefab } = require('./write.js');
const { editPrefab } = require('./editor/index.js');
const { queryPrefab } = require('./query/index.js');
const { setOverrideProperty, listOverrides } = require('./overrides.js');
const { deterministicUUID, deterministicFileId, createFileIdGenerator } = require('./id.js');
const primitives = require('./primitives.js');
const animPrimitives = require('./anim-primitives.js');

module.exports = {
  parsePrefab,
  writePrefab,
  editPrefab,
  queryPrefab,
  setOverrideProperty,
  listOverrides,
  deterministicUUID,
  deterministicFileId,
  createFileIdGenerator,
  ...primitives,
  // .anim 文件对象构建原语（AnimationClip / Track / Curve / Channel），
  // parse/write 复用 parsePrefab / writePrefab（同为 JSON 数组 + __id__ 引用格式）
  anim: animPrimitives,
};
