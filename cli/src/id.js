// ============================================================
// 确定性 UUID / fileId 生成器（纯 CJS，零三方依赖）
// 与 tools/fgui2cc3/src/utils/DeterministicId.ts byte-for-byte 对齐
// ============================================================

'use strict';

const { createHash } = require('node:crypto');

/**
 * 基于种子字符串生成确定性 UUID v4 格式
 * 使用 SHA-256 哈希前 16 字节，设置 version=4 和 variant=RFC4122
 * @param {string} seed
 * @returns {string}
 */
function deterministicUUID(seed) {
  const hash = createHash('sha256').update(seed).digest();
  // 设置 version (4) 和 variant (RFC 4122)
  hash[6] = (hash[6] & 0x0f) | 0x40;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * 基于种子字符串生成确定性 fileId（CC3 使用 base64 编码的 16 字节）
 * @param {string} seed
 * @returns {string}
 */
function deterministicFileId(seed) {
  const hash = createHash('sha256').update(seed).digest();
  return hash.subarray(0, 16).toString('base64').replace(/=+$/, '');
}

/**
 * 创建一个带自增计数器的 fileId 生成器
 * 同一组件内每个节点/组件使用递增的序号保证唯一性和稳定性
 * @param {string} baseSeed
 * @returns {() => string}
 */
function createFileIdGenerator(baseSeed) {
  let counter = 0;
  return () => deterministicFileId(`${baseSeed}#fid#${counter++}`);
}

// ============================================================
// Cocos Creator 压缩 classId 编解码
// 标准 base64（A-Z a-z 0-9 + /），前 5 hex 保留，每 3 hex → 2 base64
// 产物格式：23 字符 = 5 hex + 18 base64
// ============================================================

const _BASE64_STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * 把 32/36 位 uuid 压缩为 Cocos ccclass id（23 字符）。
 *
 * @param {string} uuid  标准 uuid（含或不含 dash）
 * @returns {string}     23 字符压缩 classId
 */
function compressUuid(uuid) {
  if (typeof uuid !== 'string') {
    throw new Error(`compressUuid: uuid 必须是字符串，收到 ${typeof uuid}`);
  }
  const hex = uuid.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`compressUuid: 输入不是合法 uuid：${uuid}`);
  }
  let out = hex.slice(0, 5);
  for (let i = 5; i < 32; i += 3) {
    const code = parseInt(hex.substr(i, 3), 16);
    out += _BASE64_STD[(code >> 6) & 0x3f];
    out += _BASE64_STD[code & 0x3f];
  }
  return out;
}

/**
 * 判断字符串是否是 Cocos 压缩 classId 格式（23 字符，前 5 hex + 后 18 base64）。
 * 不做语义合法性校验（不查 classId 是否对应真实类）。
 */
function isCompressedClassId(str) {
  return typeof str === 'string' && /^[0-9a-f]{5}[A-Za-z0-9+/]{18}$/.test(str);
}

module.exports = {
  deterministicUUID,
  deterministicFileId,
  createFileIdGenerator,
  compressUuid,
  isCompressedClassId,
};
