// add-component: 在节点 _components 数组里加一个指向指定 ccclass 的组件条目
//   + 配套的 cc.CompPrefabInfo（含 deterministic fileId）
// op: { op: 'add-component', node, componentType, props? }
//
// - componentType: 组件 ccclass 名（如 'TaskBtn' / 'cc.Sprite'）
// - props: 可选，初始 @property 字段值，会浅合并到组件对象上
//
// 限制：
//   - stub 节点暂不支持
//   - 同节点同类型组件已存在时抛错

'use strict';

const { ref, makeCompPrefabInfo } = require('../../primitives.js');
const { normalizeComponentType, isStub, resolveNode, findComponent } = require('../helpers.js');
const { collectExistingFileIds, uniqueFileId } = require('../id-utils.js');

function execAddComponent(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector, componentType: rawComponentType, props } = op;

  if (typeof rawComponentType !== 'string' || rawComponentType.length === 0) {
    throw new Error(`editPrefab [add-component]: componentType 必须是非空字符串`);
  }
  const componentType = normalizeComponentType(rawComponentType, prefabData.resolverStartPath);

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'add-component');

  if (isStub(elements, node)) {
    throw new Error(`editPrefab [add-component]: stub 节点挂自定义组件暂未实现（需 PrefabInstance.mountedComponents）`);
  }

  if (findComponent(elements, node, componentType)) {
    throw new Error(`editPrefab [add-component]: 节点 "${node._name}" 已挂 "${componentType}" 组件`);
  }

  let seed = 'unknown';
  if (node._prefab && typeof node._prefab.__id__ === 'number') {
    const pi = elements[node._prefab.__id__];
    if (pi && pi.fileId) seed = pi.fileId;
  }
  const existingFileIds = collectExistingFileIds(elements);
  const compFileId = uniqueFileId(`${seed}#addComp#${componentType}`, existingFileIds);

  const compId = elements.length;
  const cpiId = compId + 1;

  const compObj = Object.assign(
    {
      __type__: componentType,
      _name: '',
      _objFlags: 0,
      __editorExtras__: {},
      node: ref(nodeId),
      _enabled: true,
      __prefab: ref(cpiId),
      _id: '',
    },
    props && typeof props === 'object' ? props : {}
  );

  const cpiObj = makeCompPrefabInfo(compFileId);

  elements.push(compObj);
  elements.push(cpiObj);

  if (!Array.isArray(node._components)) {
    node._components = [];
  }
  node._components.push(ref(compId));

  return nodeId;
}

module.exports = { execAddComponent };
