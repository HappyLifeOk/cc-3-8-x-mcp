// query/node.js — 按名称查单节点详情

'use strict';

const { listOverrides } = require('../overrides.js');
const { isStub, componentTypes, componentDetails } = require('./comp-fields.js');

function queryNode(prefabData, name, opts) {
  const { elements } = prefabData;
  const withComps = !!(opts && opts.withComps);

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || el.__type__ !== 'cc.Node') continue;

    const stub = isStub(elements, el);
    let resolvedName = el._name;

    // stub 节点的实际名称可能存在 overrides 的 _name 字段
    if (stub && resolvedName === undefined) {
      try {
        const ovs = listOverrides(prefabData, i);
        const nameOv = ovs.find(
          (o) => o.propertyPath.length === 1 && o.propertyPath[0] === '_name'
        );
        if (nameOv) resolvedName = nameOv.value;
      } catch (_) {
        // ignore
      }
    }

    if (resolvedName !== name) continue;

    // stub 节点：把身份信息（isStub/stubAsset/overrides）放在 raw 之前，
    // 避免被 raw 大对象淹没。stub 节点的 _components / _children 字段在 raw 里是空的，
    // 真实组件/子节点都属于被引用 prefab 内部，不在当前文件里。
    const result = {
      id: i,
      name: resolvedName,
      type: el.__type__,
      active: el._active !== undefined ? el._active : null,
      isStub: stub,
    };
    if (stub) {
      const prefabInfo = elements[el._prefab.__id__];
      result.stubAsset = prefabInfo && prefabInfo.asset && prefabInfo.asset.__uuid__
        ? prefabInfo.asset.__uuid__
        : null;
      try {
        result.overrides = listOverrides(prefabData, i);
      } catch (_) {
        result.overrides = [];
      }
      result._note = 'stub 节点本身 _components/_children 为空；真实组件和子树在被引用 prefab 内（见 stubAsset），改 stub 内部字段用 set-nested-component-field / set-component-ref refSubNode';
    }
    result.componentTypes = componentTypes(elements, el);
    if (withComps) {
      result.components = componentDetails(elements, el);
    }
    result.raw = el;

    return result;
  }

  return null;
}

module.exports = { queryNode };
