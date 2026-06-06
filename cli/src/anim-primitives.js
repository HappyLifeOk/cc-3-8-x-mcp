// ============================================================
// CC3 AnimationClip (.anim) 对象构建原语（纯 CJS，零三方依赖）
//
// .anim 文件和 .prefab 一样是 JSON 数组 + `__id__` 交叉引用，
// 复用 parsePrefab / writePrefab 解析写入。
//
// 但 .anim 内部对象类型（AnimationClip / Track / Curve / Channel）
// 有自己的 schema 规范，最容易踩的坑：
//
//   ✅ cc.animation.RealTrack   → 单通道 → `_channel: {__id__: X}`   （单数）
//   ✅ cc.animation.ObjectTrack → 单通道 → `_channel: {__id__: X}`   （单数）
//   ✅ cc.animation.VectorTrack → 多通道 → `_channels: [x, y, z]`    （复数数组）
//   ✅ cc.animation.ColorTrack  → 多通道 → `_channels: [r, g, b, a]` （复数数组）
//
// 写错字段名（比如给 RealTrack 写 `_channels: [...]`）会导致 CC3 编辑器
// 按 schema 验证时直接忽略整条轨道，表现为「anim 文件里有数据但编辑器
// 不显示关键帧、运行时也不播」——历史踩过的坑，见 anim-schema.md。
//
// 用本文件里的 make* 工厂函数，保证字段名一定写对。
// ============================================================

'use strict';

const { ref } = require('./primitives.js');

// ─────────────────────────────────────────────
// 插值模式常量
// 对应 cc.RealCurve.interpolationMode 枚举
// ─────────────────────────────────────────────
const InterpolationMode = Object.freeze({
  LINEAR: 0,     // 线性插值，两关键帧之间平滑过渡
  CONSTANT: 1,   // 常量插值，保持当前值直到下一帧瞬变
  CUBIC: 2,      // 三次插值，带缓动曲线
});

// ─────────────────────────────────────────────
// Extrapolation 模式常量
// 对应 cc.RealCurve.preExtrapolation / postExtrapolation
// ─────────────────────────────────────────────
const Extrapolation = Object.freeze({
  LINEAR: 0,
  CLAMP: 1,      // 最常用：首帧之前保持首帧值，末帧之后保持末帧值
  REPEAT: 2,
  PINGPONG: 3,
});

// ─────────────────────────────────────────────
// RealKeyframeValue：单个浮点关键帧
// ─────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {number} opts.value
 * @param {number} [opts.interpolationMode=CONSTANT] 0=LINEAR 1=CONSTANT 2=CUBIC
 * @param {number} [opts.easingMethod=0] 0=Linear，其余见 cc.EasingMethod
 */
function makeRealKeyframe(opts) {
  const { value, interpolationMode = InterpolationMode.CONSTANT, easingMethod = 0 } = opts;
  return {
    __type__: 'cc.RealKeyframeValue',
    interpolationMode,
    tangentWeightMode: 0,
    value,
    rightTangent: 0,
    rightTangentWeight: 1,
    leftTangent: 0,
    leftTangentWeight: 1,
    easingMethod,
    __editorExtras__: null,
  };
}

// ─────────────────────────────────────────────
// cc.RealCurve：浮点曲线
// times/values 一一对应，长度必须相同
// ─────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {number[]} opts.times - 递增时间点（秒）
 * @param {object[]} opts.values - RealKeyframeValue 对象数组，与 times 同长
 * @param {number} [opts.preExtrapolation=1] CLAMP
 * @param {number} [opts.postExtrapolation=1] CLAMP
 */
function makeRealCurve(opts) {
  const { times, values, preExtrapolation = Extrapolation.CLAMP, postExtrapolation = Extrapolation.CLAMP } = opts;
  if (times.length !== values.length) {
    throw new Error(`makeRealCurve: times.length (${times.length}) !== values.length (${values.length})`);
  }
  return {
    __type__: 'cc.RealCurve',
    _times: times,
    _values: values,
    preExtrapolation,
    postExtrapolation,
  };
}

// ─────────────────────────────────────────────
// cc.ObjectCurve：对象引用曲线（用于 spriteFrame 等资产序列）
// values 是资产引用对象数组（`{ __uuid__, __expectedType__ }`）
// ─────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {number[]} opts.times
 * @param {object[]} opts.values - 资产引用对象
 */
function makeObjectCurve(opts) {
  const { times, values, preExtrapolation = Extrapolation.CLAMP, postExtrapolation = Extrapolation.CLAMP } = opts;
  if (times.length !== values.length) {
    throw new Error(`makeObjectCurve: times.length (${times.length}) !== values.length (${values.length})`);
  }
  return {
    __type__: 'cc.ObjectCurve',
    _times: times,
    _values: values,
    preExtrapolation,
    postExtrapolation,
  };
}

// ─────────────────────────────────────────────
// cc.animation.Channel：Track → Curve 的中间层
// ─────────────────────────────────────────────
/**
 * @param {number} curveIdx - RealCurve/ObjectCurve 在 objects 数组里的下标
 */
function makeChannel(curveIdx) {
  return {
    __type__: 'cc.animation.Channel',
    _curve: ref(curveIdx),
  };
}

// ─────────────────────────────────────────────
// cc.animation.HierarchyPath / ComponentPath / TrackPath
// 用于定位轨道的目标节点与属性
// ─────────────────────────────────────────────
/**
 * @param {string} path - 节点层级路径，如 "n4" 或 "content/titleBar"；根节点自身写 ""
 */
function makeHierarchyPath(path) {
  return { __type__: 'cc.animation.HierarchyPath', path };
}

/**
 * @param {string} component - 组件类型，如 "cc.UIOpacity" / "cc.Sprite"
 */
function makeComponentPath(component) {
  return { __type__: 'cc.animation.ComponentPath', component };
}

/**
 * @param {unknown[]} parts - 混合 HierarchyPath/ComponentPath 引用与属性字符串
 *   例：[ref(hierIdx), ref(compIdx), "opacity"]
 *   或根节点属性：[ref(compIdx), "position"]（无 hierarchy path）
 */
function makeTrackPath(parts) {
  return { __type__: 'cc.animation.TrackPath', _paths: parts };
}

// ─────────────────────────────────────────────
// cc.animation.RealTrack（单通道浮点轨道）
// ⚠️ 字段必须是 `_channel`（单数），不是 `_channels`
// ⚠️ 写错会被 CC3 编辑器 schema 验证忽略，轨道形同虚设
// ─────────────────────────────────────────────
/**
 * @param {number} trackPathIdx - TrackPath 在 objects 数组里的下标
 * @param {number} channelIdx - Channel 在 objects 数组里的下标
 */
function makeRealTrack(trackPathIdx, channelIdx) {
  return {
    __type__: 'cc.animation.RealTrack',
    _binding: {
      __type__: 'cc.animation.TrackBinding',
      path: ref(trackPathIdx),
      proxy: null,
    },
    _channel: ref(channelIdx),
  };
}

// ─────────────────────────────────────────────
// cc.animation.ObjectTrack（单通道对象轨道，常用于 spriteFrame 序列帧）
// ⚠️ 字段必须是 `_channel`（单数）
// ─────────────────────────────────────────────
/**
 * @param {number} trackPathIdx
 * @param {number} channelIdx
 */
function makeObjectTrack(trackPathIdx, channelIdx) {
  return {
    __type__: 'cc.animation.ObjectTrack',
    _binding: {
      __type__: 'cc.animation.TrackBinding',
      path: ref(trackPathIdx),
      proxy: null,
    },
    _channel: ref(channelIdx),
  };
}

// ─────────────────────────────────────────────
// cc.animation.VectorTrack（多通道，x/y/z 或 x/y/z/w）
// ⚠️ 字段必须是 `_channels`（复数，数组），且必须提供 `_nComponents`
// ─────────────────────────────────────────────
/**
 * @param {number} trackPathIdx
 * @param {number[]} channelIndices - 各轴 Channel 下标数组（长度 = nComponents）
 * @param {number} nComponents - 2(Vec2) / 3(Vec3) / 4(Vec4/Quat)
 */
function makeVectorTrack(trackPathIdx, channelIndices, nComponents) {
  if (channelIndices.length !== nComponents) {
    throw new Error(`makeVectorTrack: channelIndices.length (${channelIndices.length}) !== nComponents (${nComponents})`);
  }
  return {
    __type__: 'cc.animation.VectorTrack',
    _binding: {
      __type__: 'cc.animation.TrackBinding',
      path: ref(trackPathIdx),
      proxy: null,
    },
    _channels: channelIndices.map(ref),
    _nComponents: nComponents,
  };
}

// ─────────────────────────────────────────────
// cc.animation.ColorTrack（4 通道 r/g/b/a）
// ⚠️ 字段必须是 `_channels`（复数，数组），无 `_nComponents`
// ─────────────────────────────────────────────
/**
 * @param {number} trackPathIdx
 * @param {number[]} channelIndices - [rIdx, gIdx, bIdx, aIdx]
 */
function makeColorTrack(trackPathIdx, channelIndices) {
  if (channelIndices.length !== 4) {
    throw new Error(`makeColorTrack: expected 4 channel indices, got ${channelIndices.length}`);
  }
  return {
    __type__: 'cc.animation.ColorTrack',
    _binding: {
      __type__: 'cc.animation.TrackBinding',
      path: ref(trackPathIdx),
      proxy: null,
    },
    _channels: channelIndices.map(ref),
  };
}

// ─────────────────────────────────────────────
// cc.AnimationClipAdditiveSettings（每个 clip 尾巴一份）
// ─────────────────────────────────────────────
function makeAdditiveSettings() {
  return {
    __type__: 'cc.AnimationClipAdditiveSettings',
    enabled: false,
    refClip: null,
  };
}

// ─────────────────────────────────────────────
// cc.AnimationClip 文件头（objects[0]）
// ─────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.name
 * @param {number} opts.sample - 采样帧率
 * @param {number} opts.duration - 秒
 * @param {number} [opts.speed=1]
 * @param {number} [opts.wrapMode=1] 1=Normal, 2=Loop, 22=PingPong, 36=PingPongLoop
 * @param {number} opts.hash - 哈希值（通常 hashString(name)）
 * @param {number[]} opts.trackIndices - 所有 Track 在 objects 数组里的下标
 * @param {number} opts.additiveIdx - AdditiveSettings 下标
 * @param {number[]} [opts.embeddedPlayerIndices=[]] - EmbeddedPlayer 下标
 */
function makeAnimationClip(opts) {
  const {
    name,
    sample,
    duration,
    speed = 1,
    wrapMode = 1,
    hash,
    trackIndices,
    additiveIdx,
    embeddedPlayerIndices = [],
  } = opts;
  return {
    __type__: 'cc.AnimationClip',
    _name: name,
    _objFlags: 0,
    __editorExtras__: { embeddedPlayerGroups: [] },
    _native: '',
    sample,
    speed,
    wrapMode,
    enableTrsBlending: false,
    _duration: duration,
    _hash: hash,
    _tracks: trackIndices.map(ref),
    _exoticAnimation: null,
    _events: [],
    _embeddedPlayers: embeddedPlayerIndices.map(ref),
    _additiveSettings: ref(additiveIdx),
    _auxiliaryCurveEntries: [],
  };
}

// ─────────────────────────────────────────────
// cc.animation.EmbeddedPlayer / EmbeddedAnimationClipPlayable
// 用于 movieclip 这类「主 clip 触发节点自己 Animation 播子 clip」的结构
// ─────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {number} opts.begin - 主 clip 时间线上子 clip 开始秒
 * @param {number} opts.end - 主 clip 时间线上子 clip 结束秒
 * @param {number} opts.playableIdx - EmbeddedAnimationClipPlayable 下标
 */
function makeEmbeddedPlayer(opts) {
  const { begin, end, playableIdx } = opts;
  return {
    __type__: 'cc.animation.EmbeddedPlayer',
    begin,
    end,
    reconciledSpeed: false,
    playable: ref(playableIdx),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.path - 目标节点路径（相对 clip 所在节点）
 * @param {string} opts.clipUuid - 子 clip 资产 UUID
 */
function makeEmbeddedAnimationClipPlayable(opts) {
  const { path, clipUuid } = opts;
  return {
    __type__: 'cc.animation.EmbeddedAnimationClipPlayable',
    path,
    clip: {
      __uuid__: clipUuid,
      __expectedType__: 'cc.AnimationClip',
    },
  };
}

// ─────────────────────────────────────────────
// 哈希函数：生成 AnimationClip._hash
// 用简单字符串哈希，只需保证同名 clip 得到同一 hash 即可
// ─────────────────────────────────────────────
function hashString(s) {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

module.exports = {
  InterpolationMode,
  Extrapolation,
  makeRealKeyframe,
  makeRealCurve,
  makeObjectCurve,
  makeChannel,
  makeHierarchyPath,
  makeComponentPath,
  makeTrackPath,
  makeRealTrack,
  makeObjectTrack,
  makeVectorTrack,
  makeColorTrack,
  makeAdditiveSettings,
  makeAnimationClip,
  makeEmbeddedPlayer,
  makeEmbeddedAnimationClipPlayable,
  hashString,
};
