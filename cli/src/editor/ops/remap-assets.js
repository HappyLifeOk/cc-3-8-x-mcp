'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:@[^\s]+)?$/i;
const FILE_ID = /^[A-Za-z0-9+/]{22}$/;

/** 批量归并资源时同时迁移 TargetInfo 链，保留宿主节点和实例的身份。 */
function execRemapAssets(prefabData, op) {
  const assets = op.assetMap;
  const ids = op.fileIdMap || {};
  for (const [name, map, pattern] of [['assetMap', assets, UUID], ['fileIdMap', ids, FILE_ID]]) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      throw new Error(`remap-assets: ${name} 必须是映射对象`);
    }
    for (const [from, to] of Object.entries(map)) {
      if (!pattern.test(from) || typeof to !== 'string' || !pattern.test(to)) {
        throw new Error(`remap-assets: ${name} 存在无效映射 ${from}`);
      }
      // 一次替换必须幂等；拒绝链式重定向和循环，避免分批处理时结果不同。
      if (from !== to && Object.prototype.hasOwnProperty.call(map, to) && map[to] !== to) {
        throw new Error(`remap-assets: ${name} 不允许链式映射 ${from}`);
      }
    }
  }
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (typeof value.__uuid__ === 'string') {
      const uuid = value.__uuid__;
      const at = uuid.indexOf('@');
      const base = at < 0 ? uuid : uuid.slice(0, at);
      value.__uuid__ = assets[uuid] || (assets[base] ? assets[base] + (at < 0 ? '' : uuid.slice(at)) : uuid);
    }
    if (value.__type__ === 'cc.TargetInfo' && Array.isArray(value.localID)) {
      value.localID = value.localID.map(id => ids[id] || id);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(prefabData.elements);
  return prefabData.rootId;
}

module.exports = { execRemapAssets };
