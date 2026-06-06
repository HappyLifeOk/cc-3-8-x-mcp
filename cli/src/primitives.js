// ============================================================
// CC3 Prefab 对象构建原语（纯 CJS，零三方依赖）
// 输入：朴素参数（name/pos/size 等）
// 输出：可直接插入 prefab 数组的裸对象
// ============================================================

'use strict';

// ─────────────────────────────────────────────
// 基础数据类型工厂
// ─────────────────────────────────────────────

/** @param {number} x @param {number} y @param {number} [z] */
function vec3(x, y, z = 0) {
  return { __type__: 'cc.Vec3', x, y, z };
}

/** @param {number} w @param {number} h */
function ccSize(w, h) {
  return { __type__: 'cc.Size', width: w, height: h };
}

/** @param {number} x @param {number} y */
function vec2(x, y) {
  return { __type__: 'cc.Vec2', x, y };
}

/** @param {number} r @param {number} g @param {number} b @param {number} [a] */
function ccColor(r, g, b, a = 255) {
  return { __type__: 'cc.Color', r, g, b, a };
}

/** @param {number} id */
function ref(id) {
  return { __id__: id };
}

// ─────────────────────────────────────────────
// cc.Node
// ─────────────────────────────────────────────

/**
 * 构造 cc.Node 裸对象
 * @param {object} opts
 * @param {string} opts.name - 节点名称
 * @param {number[]} [opts.pos] - 本地位置 [x, y, z]，默认 [0,0,0]
 * @param {number[]} [opts.scale] - 本地缩放 [x, y, z]，默认 [1,1,1]
 * @param {boolean} [opts.active] - 是否激活，默认 true
 * @param {number} [opts.layer] - 渲染层，默认 33554432（UI 层）
 * @param {number|null} [opts.parentId] - 父节点 __id__，null 表示根节点
 * @param {number[]} [opts.childIds] - 子节点 __id__ 数组
 * @param {number[]} [opts.componentIds] - 组件 __id__ 数组
 * @param {number|null} [opts.prefabId] - cc.PrefabInfo 的 __id__
 * @returns {object}
 */
function makeNode(opts) {
  const {
    name,
    pos = [0, 0, 0],
    scale = [1, 1, 1],
    active = true,
    layer = 33554432,
    parentId = null,
    childIds = [],
    componentIds = [],
    prefabId = null,
  } = opts;

  return {
    __type__: 'cc.Node',
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _parent: parentId !== null ? ref(parentId) : null,
    _children: childIds.map(ref),
    _active: active,
    _components: componentIds.map(ref),
    _prefab: prefabId !== null ? ref(prefabId) : null,
    _lpos: vec3(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0),
    _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
    _lscale: vec3(scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1),
    _mobility: 0,
    _layer: layer,
    _euler: vec3(0, 0, 0),
    _id: '',
  };
}

// ─────────────────────────────────────────────
// cc.UITransform
// ─────────────────────────────────────────────

/**
 * 构造 cc.UITransform 裸对象
 * @param {object} opts
 * @param {number} opts.nodeId - 所属节点 __id__
 * @param {number} opts.width - 宽度
 * @param {number} opts.height - 高度
 * @param {number[]} [opts.anchor] - 锚点 [x, y]，默认 [0.5, 0.5]
 * @param {number} [opts.prefabInfoId] - cc.CompPrefabInfo 的 __id__
 * @returns {object}
 */
function makeUITransform(opts) {
  const {
    nodeId,
    width,
    height,
    anchor = [0.5, 0.5],
    prefabInfoId = null,
  } = opts;

  const obj = {
    __type__: 'cc.UITransform',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: ref(nodeId),
    _enabled: true,
    _contentSize: ccSize(width, height),
    _anchorPoint: vec2(anchor[0] ?? 0.5, anchor[1] ?? 0.5),
    _id: '',
  };
  if (prefabInfoId !== null) obj.__prefab = ref(prefabInfoId);
  return obj;
}

// ─────────────────────────────────────────────
// cc.Sprite
// ─────────────────────────────────────────────

/**
 * 构造 cc.Sprite 裸对象
 * @param {object} opts
 * @param {number} opts.nodeId - 所属节点 __id__
 * @param {string} [opts.spriteFrameUuid] - 图片 UUID（格式 "uuid@f9941"），null 表示无图
 * @param {number} [opts.type] - 0=SIMPLE(默认)/1=SLICED/2=TILED/3=FILLED
 * @param {number[]} [opts.color] - [r,g,b,a]，默认白色不透明
 * @param {boolean} [opts.isTrimmedMode] - 默认 true
 * @param {number} [opts.prefabInfoId] - cc.CompPrefabInfo 的 __id__
 * @returns {object}
 */
function makeSprite(opts) {
  const {
    nodeId,
    spriteFrameUuid = null,
    type = 0,
    color = [255, 255, 255, 255],
    isTrimmedMode = true,
    prefabInfoId = null,
  } = opts;

  const obj = {
    __type__: 'cc.Sprite',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: ref(nodeId),
    _enabled: true,
    _customMaterial: null,
    _srcBlendFactor: 2,
    _dstBlendFactor: 4,
    _color: ccColor(color[0] ?? 255, color[1] ?? 255, color[2] ?? 255, color[3] ?? 255),
    _spriteFrame: spriteFrameUuid
      ? { __uuid__: spriteFrameUuid, __expectedType__: 'cc.SpriteFrame' }
      : null,
    _type: type,
    _fillType: 0,
    _sizeMode: 0,
    _fillCenter: vec2(0, 0),
    _fillStart: 0,
    _fillRange: 0,
    _isTrimmedMode: isTrimmedMode,
    _useGrayscale: false,
    _atlas: null,
    _id: '',
  };
  if (prefabInfoId !== null) obj.__prefab = ref(prefabInfoId);
  return obj;
}

// ─────────────────────────────────────────────
// cc.Label
// ─────────────────────────────────────────────

/**
 * 构造 cc.Label 裸对象
 * @param {object} opts
 * @param {number} opts.nodeId - 所属节点 __id__
 * @param {string} [opts.string] - 文字内容，默认空字符串
 * @param {number} [opts.fontSize] - 字号，默认 20
 * @param {number} [opts.lineHeight] - 行高，0 表示自动
 * @param {number} [opts.horizontalAlign] - 0=LEFT/1=CENTER/2=RIGHT，默认 1(CENTER)
 * @param {number} [opts.verticalAlign] - 0=TOP/1=CENTER/2=BOTTOM，默认 1(CENTER)
 * @param {number} [opts.overflow] - 0=NONE/1=CLAMP/2=SHRINK/3=RESIZE_HEIGHT，默认 0
 * @param {string|null} [opts.fontUuid] - 字体资产 UUID，null 使用系统字体
 * @param {number[]} [opts.color] - [r,g,b,a]，默认黑色不透明
 * @param {boolean} [opts.enableOutline] - 是否启用描边，默认 false
 * @param {number[]} [opts.outlineColor] - 描边颜色 [r,g,b,a]
 * @param {number} [opts.outlineWidth] - 描边宽度，默认 2
 * @param {number} [opts.prefabInfoId] - cc.CompPrefabInfo 的 __id__
 * @returns {object}
 */
function makeLabel(opts) {
  const {
    nodeId,
    string = '',
    fontSize = 20,
    lineHeight = 0,
    horizontalAlign = 1,
    verticalAlign = 1,
    overflow = 0,
    fontUuid = null,
    color = [0, 0, 0, 255],
    enableOutline = false,
    outlineColor = [0, 0, 0, 255],
    outlineWidth = 2,
    prefabInfoId = null,
  } = opts;

  const obj = {
    __type__: 'cc.Label',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: ref(nodeId),
    _enabled: true,
    _customMaterial: null,
    _srcBlendFactor: 2,
    _dstBlendFactor: 4,
    _color: ccColor(color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, color[3] ?? 255),
    _string: string,
    _horizontalAlign: horizontalAlign,
    _verticalAlign: verticalAlign,
    _actualFontSize: fontSize,
    _fontSize: fontSize,
    _fontFamily: 'Arial',
    _lineHeight: lineHeight,
    _overflow: overflow,
    _enableWrapText: true,
    _font: fontUuid ? { __uuid__: fontUuid, __expectedType__: 'cc.Font' } : null,
    _isSystemFontUsed: fontUuid === null,
    _isItalic: false,
    _isBold: false,
    _isUnderline: false,
    _cacheMode: 0,
    _enableOutline: enableOutline,
    _outlineColor: ccColor(
      outlineColor[0] ?? 0,
      outlineColor[1] ?? 0,
      outlineColor[2] ?? 0,
      outlineColor[3] ?? 255
    ),
    _outlineWidth: outlineWidth,
    _id: '',
  };
  if (prefabInfoId !== null) obj.__prefab = ref(prefabInfoId);
  return obj;
}

// ─────────────────────────────────────────────
// cc.Widget
// ─────────────────────────────────────────────

/**
 * 构造 cc.Widget 裸对象
 *
 * alignFlags 位掩码（可组合）：
 *   LEFT=1, RIGHT=2, TOP=4, BOTTOM=8, HORIZONTAL_CENTER=16, VERTICAL_CENTER=32
 *
 * @param {object} opts
 * @param {number} opts.nodeId - 所属节点 __id__
 * @param {number} [opts.alignFlags] - 对齐标志位掩码，默认 0（无对齐）
 * @param {number} [opts.left] - 左边距
 * @param {number} [opts.right] - 右边距
 * @param {number} [opts.top] - 上边距
 * @param {number} [opts.bottom] - 下边距
 * @param {boolean} [opts.isAbsLeft] - left 是否为绝对像素，默认 true
 * @param {boolean} [opts.isAbsRight] - right 是否为绝对像素，默认 true
 * @param {boolean} [opts.isAbsTop] - top 是否为绝对像素，默认 true
 * @param {boolean} [opts.isAbsBottom] - bottom 是否为绝对像素，默认 true
 * @param {boolean} [opts.isAbsHorizontalCenter] - horizontalCenter 是否为绝对像素，默认 true
 * @param {boolean} [opts.isAbsVerticalCenter] - verticalCenter 是否为绝对像素，默认 true
 * @param {number} [opts.horizontalCenter] - 水平居中偏移
 * @param {number} [opts.verticalCenter] - 垂直居中偏移
 * @param {number} [opts.alignMode] - 0=ONCE/1=ON_WINDOW_RESIZE/2=ALWAYS，默认 1
 * @param {number} [opts.prefabInfoId] - cc.CompPrefabInfo 的 __id__
 * @returns {object}
 */
function makeWidget(opts) {
  const {
    nodeId,
    alignFlags = 0,
    left = 0,
    right = 0,
    top = 0,
    bottom = 0,
    isAbsLeft = true,
    isAbsRight = true,
    isAbsTop = true,
    isAbsBottom = true,
    isAbsHorizontalCenter = true,
    isAbsVerticalCenter = true,
    horizontalCenter = 0,
    verticalCenter = 0,
    alignMode = 1,
    prefabInfoId = null,
  } = opts;

  const obj = {
    __type__: 'cc.Widget',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: ref(nodeId),
    _enabled: true,
    _alignFlags: alignFlags,
    _target: null,
    _left: left,
    _right: right,
    _top: top,
    _bottom: bottom,
    _horizontalCenter: horizontalCenter,
    _verticalCenter: verticalCenter,
    _isAbsLeft: isAbsLeft,
    _isAbsRight: isAbsRight,
    _isAbsTop: isAbsTop,
    _isAbsBottom: isAbsBottom,
    _isAbsHorizontalCenter: isAbsHorizontalCenter,
    _isAbsVerticalCenter: isAbsVerticalCenter,
    _originalWidth: 0,
    _originalHeight: 0,
    _alignMode: alignMode,
    _lockFlags: 0,
    _id: '',
  };
  if (prefabInfoId !== null) obj.__prefab = ref(prefabInfoId);
  return obj;
}

// ─────────────────────────────────────────────
// sp.Skeleton
// ─────────────────────────────────────────────

/**
 * 构造 sp.Skeleton 裸对象
 *
 * 给 spine prefab 用。运行时通过 loadAsset<Prefab> + instantiate +
 * getComponent(sp.Skeleton) 获取并播放动画。
 *
 * 字段默认值与 Cocos 编辑器从右键菜单挂 sp.Skeleton 的产物保持一致：
 * 缓存策略 PRIVATE_CACHE(1)、blend func 2/4、_useTint/_premultipliedAlpha
 * 等均为 false / 默认。
 *
 * @param {object} opts
 * @param {number} opts.nodeId - 所属节点 __id__
 * @param {string} opts.skeletonUuid - .skel 资产 UUID（cc.AssetManager 注册的资源 ID）
 * @param {number} [opts.prefabInfoId] - cc.CompPrefabInfo 的 __id__
 * @returns {object}
 */
function makeSpSkeleton(opts) {
  const { nodeId, skeletonUuid, prefabInfoId = null } = opts;
  const obj = {
    __type__: 'sp.Skeleton',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: ref(nodeId),
    _enabled: true,
    _customMaterial: null,
    _srcBlendFactor: 2,
    _dstBlendFactor: 4,
    _color: ccColor(255, 255, 255, 255),
    _skeletonData: { __uuid__: skeletonUuid, __expectedType__: 'sp.SkeletonData' },
    defaultSkin: '',
    defaultAnimation: '',
    _premultipliedAlpha: false,
    _timeScale: 1,
    _preCacheMode: 1,
    _cacheMode: 1,
    _defaultCacheMode: 1,
    _sockets: [],
    _useTint: false,
    _debugMesh: false,
    _debugBones: false,
    _debugSlots: false,
    _enableBatch: false,
    loop: false,
    _id: '',
  };
  if (prefabInfoId !== null) obj.__prefab = ref(prefabInfoId);
  return obj;
}

// ─────────────────────────────────────────────
// cc.PrefabInfo / cc.CompPrefabInfo
// ─────────────────────────────────────────────

/**
 * 构造节点的 cc.PrefabInfo 裸对象（非嵌套普通节点用）
 * @param {object} opts
 * @param {number} opts.rootId - 根节点 __id__（通常为 1）
 * @param {string} opts.fileId - 该节点在 prefab 内的唯一 ID（base64 22-24字符）
 * @param {number} [opts.assetId] - cc.Prefab 资产 __id__，默认 0
 * @param {number[]|null} [opts.nestedPrefabInstanceRoots] - 嵌套 stub 节点索引，根节点 PrefabInfo 用
 * @returns {object}
 */
function makePrefabInfo(opts) {
  const {
    rootId,
    fileId,
    assetId = 0,
    nestedPrefabInstanceRoots = null,
  } = opts;

  return {
    __type__: 'cc.PrefabInfo',
    root: ref(rootId),
    asset: ref(assetId),
    fileId,
    instance: null,
    targetOverrides: null,
    nestedPrefabInstanceRoots: nestedPrefabInstanceRoots
      ? nestedPrefabInstanceRoots.map(ref)
      : null,
  };
}

/**
 * 构造组件的 cc.CompPrefabInfo 裸对象
 * @param {string} fileId - 该组件在 prefab 内的唯一 ID
 * @returns {object}
 */
function makeCompPrefabInfo(fileId) {
  return { __type__: 'cc.CompPrefabInfo', fileId };
}

/**
 * 构造 cc.Prefab 文件头对象（下标 0）
 * @param {object} opts
 * @param {string} opts.name - prefab 名称
 * @param {number} opts.rootId - 根节点 __id__（通常为 1）
 * @returns {object}
 */
function makePrefabRoot(opts) {
  const { name, rootId = 1 } = opts;
  return {
    __type__: 'cc.Prefab',
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    data: ref(rootId),
    optimizationPolicy: 0,
    persistent: false,
  };
}

module.exports = {
  // 基础类型工厂（供外部使用）
  vec3,
  vec2,
  ccSize,
  ccColor,
  ref,
  // 节点/组件构建
  makeNode,
  makeUITransform,
  makeSprite,
  makeLabel,
  makeWidget,
  makeSpSkeleton,
  // Prefab 元信息
  makePrefabInfo,
  makeCompPrefabInfo,
  makePrefabRoot,
};
