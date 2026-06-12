// add-spine-socket: 给普通节点上的 sp.Skeleton 增加 / 更新 Spine socket 绑定
// op: { op:'add-spine-socket', node, path, target }
//
// - node: 挂 sp.Skeleton 的节点
// - path: Spine socket path，例如 "root/zk/tou2"
// - target: 要绑定到该 socket 的 cc.Node
// - 幂等：同 path 已存在时只更新 target，不新增重复 socket 对象

'use strict';

const { makeSpineSocket } = require('../../primitives.js');
const { isStub, resolveNode, findComponent } = require('../helpers.js');

function execAddSpineSocket(prefabData, op) {
  const { elements } = prefabData;
  const { node: nodeSelector, path, target: targetSelector } = op;

  if (typeof path !== 'string' || path.length === 0) {
    throw new Error(`editPrefab [add-spine-socket]: path 必须是非空字符串`);
  }

  const { node, nodeId } = resolveNode(prefabData, nodeSelector, 'add-spine-socket');
  if (isStub(elements, node)) {
    throw new Error(`editPrefab [add-spine-socket]: 节点 "${node._name}" 是 stub 代理，不支持直接改子 prefab 的 sp.Skeleton`);
  }

  const skeleton = findComponent(elements, node, 'sp.Skeleton');
  if (!skeleton) {
    throw new Error(`editPrefab [add-spine-socket]: 节点 "${node._name}" 上找不到 sp.Skeleton 组件`);
  }

  const { nodeId: targetId } = resolveNode(prefabData, targetSelector, 'add-spine-socket target');

  if (!Array.isArray(skeleton._sockets)) skeleton._sockets = [];
  for (const socketRef of skeleton._sockets) {
    if (!socketRef || typeof socketRef.__id__ !== 'number') continue;
    const socket = elements[socketRef.__id__];
    if (socket && socket.__type__ === 'sp.Skeleton.SpineSocket' && socket.path === path) {
      socket.target = { __id__: targetId };
      return nodeId;
    }
  }

  const socketId = elements.length;
  elements.push(makeSpineSocket({ path, targetId }));
  skeleton._sockets.push({ __id__: socketId });
  return nodeId;
}

module.exports = { execAddSpineSocket };
