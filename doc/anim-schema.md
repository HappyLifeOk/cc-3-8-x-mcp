# CC 3.8.x AnimationClip (.anim) 文件结构速查表

> 目标读者：读写 .anim 文件的 AI / 工具开发者。
> .anim 和 .prefab 都是「JSON 数组 + `__id__` 交叉引用」的同构格式，parse/write 复用 [prefab-schema.md](./prefab-schema.md) 里描述的规则；本文只补 .anim 独有的对象类型与字段。
> 样本来源：`assets/packages/module/game/merge/effect/component/prefab/Skwjquchuquchu.anim`。

---

## 1. 整体结构

```
objects[0]  = cc.AnimationClip                 ← 文件头（引用 _tracks / _embeddedPlayers / _additiveSettings）
objects[1..N-3] = Tracks + TrackPaths + Channels + Curves + HierarchyPath/ComponentPath
objects[N-2]   = cc.AnimationClipAdditiveSettings
objects[N-1]   = （可选）EmbeddedPlayer / EmbeddedAnimationClipPlayable
```

依赖链：

```
AnimationClip
  └─ _tracks[]          →  Track
                            ├─ _binding.path  →  TrackPath
                            │                     └─ _paths[] → HierarchyPath / ComponentPath / string(propName)
                            └─ _channel / _channels → Channel
                                                        └─ _curve → RealCurve / ObjectCurve
                                                                      └─ _times[] / _values[]（对齐等长）
```

---

## 2. Track 类型与字段（**最容易踩的坑**）

| `__type__` | 通道数 | 字段名 | 额外字段 | 典型属性 |
|---|---|---|---|---|
| `cc.animation.RealTrack` | 1 | **`_channel`**（单数） | — | `opacity`, `active`, 单个标量属性 |
| `cc.animation.ObjectTrack` | 1 | **`_channel`**（单数） | — | `spriteFrame`, 资产引用 |
| `cc.animation.VectorTrack` | 2/3/4 | **`_channels`**（复数数组） | `_nComponents` | `position`, `scale`, `eulerAngles` |
| `cc.animation.ColorTrack` | 4 | **`_channels`**（复数数组） | — | `color`（r/g/b/a） |

### ⚠️ 历史踩过的坑

**给 `RealTrack` 写 `_channels: [ref(idx)]`（复数数组）而不是 `_channel: ref(idx)`（单数）。**

CC3 编辑器按 schema 验证 .anim 文件，RealTrack / ObjectTrack 的通道字段必须是 `_channel`（单数、单对象）。字段名写错会：

- **编辑器里看不到这条轨道的关键帧**（属性列表不显示）
- **运行时不播**（track 被忽略）
- **文件能写进去、也不报错**（CC3 对未知/缺失字段静默忽略）

排查路径：打开 .anim 看节点 UIOpacity.opacity / spriteFrame 这类单值属性没显示时，第一件事是检查 `_channel` vs `_channels`。

**正确写法请用 [cli/src/anim-primitives.js](../cli/src/anim-primitives.js) 的 `makeRealTrack` / `makeObjectTrack` / `makeVectorTrack` / `makeColorTrack` 工厂函数**，绑定了正确的字段名，编译期避免拼错。

---

## 3. 曲线与关键帧

### cc.RealCurve（浮点曲线）

```json
{
  "__type__": "cc.RealCurve",
  "_times": [0, 0.1, 0.4666...],
  "_values": [{RealKeyframeValue}, ...],
  "preExtrapolation": 1,
  "postExtrapolation": 1
}
```

- `_times` 递增秒数，和 `_values` 等长
- `preExtrapolation` / `postExtrapolation`：`0=LINEAR / 1=CLAMP / 2=REPEAT / 3=PINGPONG`，最常用 `1`

### cc.RealKeyframeValue

```json
{
  "__type__": "cc.RealKeyframeValue",
  "interpolationMode": 1,
  "tangentWeightMode": 0,
  "value": 255,
  "rightTangent": 0, "rightTangentWeight": 1,
  "leftTangent": 0,  "leftTangentWeight": 1,
  "easingMethod": 0,
  "__editorExtras__": null
}
```

- `interpolationMode`：**`0=LINEAR / 1=CONSTANT / 2=CUBIC`**
  - LINEAR：两关键帧之间平滑线性过渡（视觉上看到淡入淡出）
  - CONSTANT：保持当前值到下一帧瞬变（FGUI 非 tween item 语义）
  - CUBIC：带缓动曲线（`easingMethod` 配 `cc.EasingMethod` 枚举）

### cc.ObjectCurve（对象引用曲线，如 spriteFrame 序列）

和 RealCurve 结构一样，`_values` 换成 `{ __uuid__, __expectedType__ }` 资产引用。

---

## 4. TrackPath 路径寻址

TrackPath 定位"哪个节点 → 哪个组件 → 哪个属性"：

```json
{
  "__type__": "cc.animation.TrackPath",
  "_paths": [
    { "__id__": hierIdx },   // HierarchyPath: { path: "n4" }
    { "__id__": compIdx },   // ComponentPath: { component: "cc.UIOpacity" }
    "opacity"                // 属性名字符串
  ]
}
```

规则：

- **根节点自身**（`path === ""`）：省略 HierarchyPath，直接 `[ComponentPath, propName]` 或 `[propName]`（Node 本身的属性如 position）
- **Node 本身属性**（`position` / `scale` / `eulerAngles` / `active`）：不需要 ComponentPath，`[HierarchyPath, propName]`
- **组件属性**（`UIOpacity.opacity` / `Sprite.color` / `Sprite.spriteFrame`）：需要 ComponentPath，`[HierarchyPath, ComponentPath, propName]`

---

## 5. EmbeddedPlayer（movieclip 子动画触发）

FGUI 的 movieclip 节点在 CC3 里用「主 clip 挂 EmbeddedPlayer + 目标节点自己的 cc.Animation 播子 clip」这种双层结构表达。

```
主 AnimationClip
  └─ _embeddedPlayers[] → cc.animation.EmbeddedPlayer
                              ├─ begin, end                       ← 主 clip 时间线上的起止秒
                              └─ playable → EmbeddedAnimationClipPlayable
                                              ├─ path  = "n4"     ← 目标节点（从主 clip 挂载节点算相对路径）
                                              └─ clip  = UUID     ← 子 clip 资产 UUID
```

### ⚠️ 子 clip 的关键帧时序

子 clip 的 `t=0` **必须对应 `EmbeddedPlayer.begin` 那一刻**，不能把主 clip 的绝对时间当子 clip 的时间来写。

举例：FGUI 在 frame 3（0.1s）触发 movieclip 播放，子 clip 20 帧。

- ❌ 错：子 clip keyframes `[t=0, t=0.1, t=0.133, ...]`（t=0 是静态占位、t=0.1 才是播放命令）→ EmbeddedPlayer begin=0.1 时，子 clip 从自己的 t=0 开始，frame 0 会显示 0.1 秒才切 frame 1
- ✅ 对：子 clip keyframes `[t=0, t=0.033, t=0.067, ...]`（t=0 直接是第一帧），sub-clip `_duration = transitionDuration - begin`

### ⚠️ 主 clip / 子 clip 职责划分

**主 clip 做所有"业务逻辑"动画**（fade in/out、rotation、scale、position 等），**子 clip 只做 spriteFrame 逐帧切换**。原因：

- 节点的 cc.Animation 播子 clip 时，子 clip 的 TrackPath 写空 HierarchyPath 直接驱动节点本身；主 clip 通过 HierarchyPath 也能驱动该节点其他属性
- 两边同时驱动同一属性会产生混合（blending）冲突
- 把业务轨道留在主 clip，子 clip 只管图片切换，最干净

---

## 6. 初始值关键帧

**非 tween 轨道的首个关键帧若不在 `t=0`，必须额外补一帧 `t=0` 表示初始值**。否则 `preExtrapolation=CLAMP` 会把首帧值倒推到 `-∞`，产生视觉异常。

典型例子：Rotation 只在 `t=0.1` 设 `Z=269°`，要在 `t=0` 补 `Z=0`，否则 clip 一开始节点就已经是旋转 269°。

Alpha 通常 FGUI 自己会写 `time=0, value=0`，所以 opacity 轨道天然有初始帧；Rotation/Scale 常常缺首帧，需要转换器主动补。

---

## 7. 用 anim-primitives 构建完整 .anim

最小示例：给 "n4" 节点 `cc.UIOpacity.opacity` 加一条 `[0→0, 0.1→255, 0.467→0]` 的 CONSTANT 轨道。

```js
const { parsePrefab, writePrefab, anim, ref } = require('./cli/src');
const {
  makeHierarchyPath, makeComponentPath, makeTrackPath,
  makeRealKeyframe, makeRealCurve, makeChannel, makeRealTrack,
  makeAdditiveSettings, makeAnimationClip,
  InterpolationMode, hashString,
} = anim;

const objects = [];
objects.push(null);                                              // [0] 占位 AnimationClip

const hierIdx = objects.length; objects.push(makeHierarchyPath('n4'));     // [1]
const compIdx = objects.length; objects.push(makeComponentPath('cc.UIOpacity')); // [2]
const pathIdx = objects.length;
objects.push(makeTrackPath([ref(hierIdx), ref(compIdx), 'opacity']));       // [3]

const curveIdx = objects.length;
objects.push(makeRealCurve({
  times: [0, 0.1, 0.4667],
  values: [
    makeRealKeyframe({ value: 0,   interpolationMode: InterpolationMode.CONSTANT }),
    makeRealKeyframe({ value: 255, interpolationMode: InterpolationMode.CONSTANT }),
    makeRealKeyframe({ value: 0,   interpolationMode: InterpolationMode.CONSTANT }),
  ],
}));                                                              // [4]

const chIdx = objects.length; objects.push(makeChannel(curveIdx));          // [5]
const trackIdx = objects.length; objects.push(makeRealTrack(pathIdx, chIdx)); // [6]

const additiveIdx = objects.length; objects.push(makeAdditiveSettings());   // [7]

objects[0] = makeAnimationClip({
  name: 'demo',
  sample: 30,
  duration: 0.7333,
  hash: hashString('demo'),
  trackIndices: [trackIdx],
  additiveIdx,
});

require('fs').writeFileSync('demo.anim', JSON.stringify(objects, null, 2));
```

**关键点**：`makeRealTrack` 自动生成 `_channel`（单数）字段，保证编辑器能识别；改用 `makeVectorTrack` / `makeColorTrack` 自动生成 `_channels`（复数数组）+ 必要的 `_nComponents`。
