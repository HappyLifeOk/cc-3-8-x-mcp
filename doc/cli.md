# cocos-mcp-cli — CC3 Prefab 离线读写工具

> 单一真相文档。覆盖：定位、命令、op 全表、配方、已知坑、源码导航。
>
> 给 AI agent 也给人类开发者。改 `.prefab` / `.anim` 文件前必读。

---

## 1. 定位与硬规则

**`.prefab` 文件必须用本 CLI 操作，禁止 `Read + Edit` 工具直接编辑。**

prefab 是 JSON 数组，`__id__` 是数组下标，字符串替换会破坏所有引用关系。唯一例外：纯文本字面量替换（如改一个类名字符串）。

**适用场景**：

- 修改节点字段（`_active` / `_lpos` / `_name` / 子节点顺序）
- 修改组件字段（`cc.Label._string` / `cc.Sprite._spriteFrame` / `cc.UITransform` 锚点尺寸 / 自定义脚本字段）
- 给脚本组件 `@property` 挂节点 / 组件引用（含嵌套 prefab 内）
- 增删克隆节点 / 加组件 / 合并重复组件
- 跨多个 prefab 跑同一组 ops（`--glob`）
- 比较两个 prefab（`diff` 子命令）
- 操作 `.anim` 文件（`anim` 子命令，与 prefab 同格式）

**不适用 / 已知限制**：

- 多层嵌套 stub（stub 内还有 stub）：CLI 支持 `refSubNode` 字符串数组路径，但更深层场景仍建议走 tools pipeline（`tools/step-3-script/bind-prefab-components.ts`）
- 改 `.anim` 文件里的 AnimationClip / Track / Curve 结构：用 `cli/src/anim-primitives.js` 在脚本中处理，不通过 op
- 脚本组件本身在 stub 内挂载（`mountedComponents`）的 @property 绑定：CLI 会抛错

---

## 2. 入口与路径约定

```bash
# 必须用 bin/cocos-mcp-cli.js（src/index.js 是 re-export 无 CLI 入口；src/cli/main.js 不自调用）
cd <你的 Cocos 项目根目录>
node extensions/cc-3-8-x-mcp/cli/bin/cocos-mcp-cli.js <command> [args]
```

prefab 路径相对 `forest/` 项目根，不带 `forest/` 前缀：

```
assets/packages/common/setting/ui/SettingUI.prefab
assets/packages/module/sign/prefab/SignUI.prefab
```

零依赖，无需 `npm install`。可选全局链接：

```bash
cd extensions/cc-3-8-x-mcp/cli
npm link
cocos-mcp-cli <command>
```

---

## 3. 标准工作流

```bash
# 1. 查节点树，确认目标 ID 和 isStub 信息
node bin/cocos-mcp-cli.js query <prefab> --selector tree

# 2. 写 ops.json（见 §6 Op 全表）

# 3. 干跑预览改动（不写盘）
node bin/cocos-mcp-cli.js batch <prefab> ops.json --dry-run

# 4. 落盘
node bin/cocos-mcp-cli.js batch <prefab> ops.json

# 5. 类型检查
npx tsc --noEmit
```

成功输出 `{"changed": true, "opsApplied": N, "nodesAffected": [...]}`。任一 op 失败整体不落盘（原子性）。

---

## 4. 命令完整参考

```
cocos-mcp-cli query <prefab> [--selector tree|node|find|field]
                              [--name X] [--type cc.Label]
                              [--comp cc.UITransform] [--field _anchorPoint]
                              [--with-comps]
cocos-mcp-cli set   <prefab> <nodeName> <field> <value>
cocos-mcp-cli batch <prefab> <ops.json> [--project-root <path>] [--dry-run]
cocos-mcp-cli batch <ops.json> --glob <pattern> [--project-root <path>] [--dry-run]
cocos-mcp-cli anim  <subcommand> <file> [args]    # subcommand: query | batch
cocos-mcp-cli diff  <prefabA> <prefabB>            # 字段级 diff，输出与 dry-run 同格式
cocos-mcp-cli create-prefab <out> [--name N] [--width W] [--height H]
                                  [--add-spine <skel-uuid>] [--dry-run]
cocos-mcp-cli extract-prefab <src> <out> --node <selector> [--name X] [--dry-run]
cocos-mcp-cli compact-prefab <prefab> [--dry-run]
```

### query

| selector | 说明 | 必带 flag |
|---|---|---|
| `tree`（默认） | 精简节点树（`id` / `name` / `isStub` / `componentTypes` / `children`） | — |
| `node` | 单节点详情（含 raw + overrides） | `--name <节点名>` |
| `find` | 按 `__type__` 列所有匹配 element 的 id | `--type <类型>` |
| `field` | 单组件单字段值（输出原始 JSON，方便 `jq` 管道） | `--name --comp --field` |
| `overrides` | 列 stub 节点当前所有 propertyOverrides + 关联 root targetOverrides | `--id N` / `--path A/B/C` / `--name <name>` |

`--with-comps`：`tree` / `node` 下展开节点的所有组件字段（输出 `components: [{type, id, fields}]`）。不带这个 flag 只输出 `componentTypes` 类型名列表。

`overrides` 输出每条 override 的落点 `target.kind`：
- `stub-node-field` — stub 节点自身字段（_lpos / _name / _lscale 等）
- `nested-component` — 嵌套 prefab 内某组件字段（带 `componentType` + `ownerNodeName`）
- `nested-node` — 嵌套 prefab 内某子节点字段
- `unknown` — 嵌套 prefab 加载失败或 fileId 不在嵌套索引内

调 stub 字段对不上时先跑 `overrides` 看当前已写入哪些，再用 `reset-overrides` op 清单条或一键回滚。

### set（单字段快捷写入）

支持的 `field`：`active` / `label.text` / `position.x` / `position.y` / `position.z`。

复杂操作请用 `batch`。

### batch

- `--project-root <path>`：当 `<prefab>` 放在项目目录外（如 `/tmp/`）时必须显式传入含 `assets/ + package.json` 的项目根。否则 className → 压缩 classId 查表失败时会抛错（避免写入 className 字符串导致 cocos MissingScript）。同样，刚新建 .ts 但 cocos 编辑器尚未生成 .ts.meta 时也会抛错——等 .meta 出来再跑。
- `--dry-run`：跑完不写盘，输出 `{ changed: false, dryRun: true, diff: [...] }`，`diff` 是字段级差异 `{ "a.b.c": [old, new] }`
- `--glob <pattern>`：第一个位置参数当 ops.json，对所有匹配 pattern 的 prefab 跑同一组 ops。pattern 支持 `**` / `*` / `?`，相对 cwd。每个文件独立执行，单文件失败不阻断后续。**先用 `--dry-run` 确认匹配范围**，再去掉落盘

```bash
# glob 示例
node bin/cocos-mcp-cli.js batch /tmp/ops.json \
  --glob "assets/packages/module/**/ui/*.prefab" --dry-run
```

### anim

`.anim` 与 `.prefab` 同为 JSON 数组 + `__id__` 引用格式，复用 `editPrefab`。op 主要面向 cc.Node 树。改 AnimationClip / Track / Curve 结构请用 `cli/src/anim-primitives.js` 在脚本中处理。

```bash
node bin/cocos-mcp-cli.js anim query my.anim --selector tree
node bin/cocos-mcp-cli.js anim batch my.anim ops.json --dry-run
```

### diff

字段级 diff，输出与 dry-run 同格式：

```bash
node bin/cocos-mcp-cli.js diff old.prefab new.prefab
```

适用：CI 验证转换工具产物 / 对照历史版本 / review 自动 diff。

### ops schema 预校验

`editPrefab` 跑前一次性扫所有 op，发现拼错（`comp` → `componentType` 友好提示）/ 缺必填字段 / 未知 op 类型，一次性报齐，不会跑到一半才发现。

### create-prefab

从零创建一个新 prefab + 配套 `.prefab.meta`。`output-path` 不带 `.prefab` 后缀会自动补全。

`uuid` / `fileId` 走 `deterministicUUID` / `deterministicFileId` 以 `create-prefab:<name>` 为种子推导：**同名 prefab 每次生成相同 UUID**，可重入。

| flag | 默认 | 说明 |
|---|---|---|
| `--name <N>` | 取 basename 去 `.prefab` | prefab 内部 `_name` + `meta.userData.syncNodeName` |
| `--width <W>` | 普通 750 / spine 100 | UITransform 宽 |
| `--height <H>` | 普通 200 / spine 100 | UITransform 高 |
| `--add-spine <skel-uuid>` | — | 在 root 节点多挂 `sp.Skeleton` 组件，`_skeletonData.__uuid__` 指向给定的 `.skel` 资产 UUID；条目数 5 → 7 |
| `--dry-run` | — | 不写盘，把 prefab + meta JSON 输出到 stdout |

不带 `--add-spine`（5 条目）：
```
0  cc.Prefab
1  cc.Node (root)
2  cc.UITransform
3  cc.CompPrefabInfo (UITransform)
4  cc.PrefabInfo     (root)
```

带 `--add-spine`（7 条目）：
```
0  cc.Prefab
1  cc.Node (root, _components: [2, 4])
2  cc.UITransform
3  cc.CompPrefabInfo (UITransform)
4  sp.Skeleton
5  cc.CompPrefabInfo (sp.Skeleton)
6  cc.PrefabInfo     (root)
```

**批量生成 spine prefab**（外层 shell 循环，CLI 自身不扫目录）：

```bash
for meta in assets/res/<group>/<xxxN>/*.skel.meta; do
  name=$(basename "$meta" .skel.meta)
  uuid=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['uuid'])" "$meta")
  node extensions/cc-3-8-x-mcp/cli/bin/cocos-mcp-cli.js create-prefab \
    "assets/packages/<group>/<xxxN>/prefab/${name}.prefab" \
    --add-spine "$uuid"
done
```

已存在 prefab 加 spine 组件用 `add-component`（不走本命令）：
```json
{"op": "add-component", "node": "root", "componentType": "sp.Skeleton",
 "props": {"_skeletonData": {"__uuid__": "<skel-uuid>", "__expectedType__": "sp.SkeletonData"}}}
```

### extract-prefab

从源 prefab 里抠出一个子节点的完整闭包，写成新独立 prefab。

| flag | 说明 |
|---|---|
| `<src>` | 源 prefab 路径 |
| `<out>` | 输出新 prefab 路径 |
| `--node <selector>` | 节点选择器（同 batch 三种：节点名 / `{"id":N}` / `{"path":"A/B"}`） |
| `--name <X>` | 新 prefab 根节点 `_name`（可选，默认沿用源节点名） |
| `--dry-run` | 不写盘，把新 prefab + meta JSON 输出到 stdout |

闭包收集规则（`cli/src/cli/extract-cmd.js`）：
- 从 srcNode 开始递归走所有字段，遇 `{__id__: N}` 把 N 加入闭包队列
- 跳过 `_parent`（反向引用会把父链/兄弟拖进闭包，破坏「只提子树」语义）
- 闭包内元素按原 idx 升序拷贝到新数组（srcNode 永远是 idx 1）

输出语义：
- 新 root: `_parent = null`，`_name = newName`
- 新 root 的 PrefabInfo: `root → {__id__: 1}`, `asset → {__id__: 0}`, 清掉 `instance / targetOverrides / nestedPrefabInstanceRoots`（这些字段在源里是相对宿主的，独立 prefab 不需要）
- meta uuid: 走 `deterministicUUID(extract-prefab:<outPath>:<newName>:uuid)`，**同 src+out+name 每次同 uuid**

例：从 HomeBottom 提取 btnTask 为独立 BottomEntry.prefab
```bash
node extensions/cc-3-8-x-mcp/cli/bin/cocos-mcp-cli.js \
  extract-prefab \
  assets/packages/.../HomeBottom.prefab \
  assets/packages/module/task/prefab/BottomEntry.prefab \
  --node "btnTask" \
  --name "BottomEntry"
```

### compact-prefab

清 prefab `data` 数组里所有 `null` 槽位 + 重映射所有 `__id__` 引用。

**为啥需要这个 op**：Cocos editor 反序列化是「宽容模式」（遇 null 跳过）；但 Cocos build worker 是「严格模式」，scan 整个 data 数组撞 null 就崩 `TypeError: Cannot read properties of undefined (reading '__type__')`。早期手工生成的 prefab（比如 extract-prefab 上线前用 Read+Edit 改 elements[i] = null 这种历史操作）会留下 null 槽位；GUI 能打开 + 运行时正常，但 build 跑不通。

算法（`cli/src/cli/compact-cmd.js`）：
- 跟 extract-cmd line 105-132 同款（紧凑 push + remap），但不剔除任何东西
- 收集所有 null 索引 → 构造 oldIdx → newIdx 映射（newIdx = oldIdx - 前面被删 null 数量）→ `data.filter(el => el !== null)` → 递归 `_remapIds`

| flag | 说明 |
|---|---|
| `<prefab>` | prefab 路径 |
| `--dry-run` | 不写盘，输出统计 + dangling 引用警告 |

输出格式：
```
<prefab> → <oldLen> → <newLen> (清掉 N 个 null) [dry-run]
  原 null 索引: 24,25
  ⚠ K 个 __id__ 引用原本指向 null 槽位（已置 null）：（如有）
     [0].xxxRef → __id__:24
```

**dangling 引用警告**：如果 prefab 里某个 `__id__:N` 指向了被删的 null 槽位（"软删 + 引用残留"场景），compact 会把它置为 `__id__: null` 并打印警告。一般情况下 null 槽位都是孤儿（没人引用），dangling = 0；如果 > 0 需要人工排查那条引用是否本来就该解开。

例：清两个历史 null prefab
```bash
node extensions/cc-3-8-x-mcp/cli/bin/cocos-mcp-cli.js compact-prefab \
  assets/packages/module/task/prefab/TaskRewardItem.prefab --dry-run
# 输出: 29 → 27 (清掉 2 个 null)

# 批量扫整个项目（shell 循环 + dry-run）
for f in $(find assets -name "*.prefab"); do
  node extensions/cc-3-8-x-mcp/cli/bin/cocos-mcp-cli.js compact-prefab "$f" --dry-run 2>&1 | grep -v "无 null"
done
```

适用范围：只清 data 数组**顶层**的 null。Cocos build 还可能崩在「子节点字段里 null 引用」（如 `node._children[i] = null` 这种深层损坏），那种不是 compact-prefab 能修的，要靠 Cocos GUI 重新保存或 query+set 单点修复。

---

## 5. 节点定位三种形式

`node` / `parent` / `target` / `source` / `refNode` 都通用：

```js
"itemList"                                    // 名字（首个匹配）
{ "id": 65 }                                  // __id__（stub 节点必须用这个，见下方踩坑）
{ "path": "Canvas/Main/itemList" }            // DOM-like 路径，从根逐级下钻；同名节点多时用这个
```

### 踩坑：stub 节点不能用字符串名定位

stub 节点（嵌套 prefab 实例）在 prefab JSON 里 `_name = ""`（空字符串），真实显示名挂在 `PrefabInstance.propertyOverrides` 里。**按字符串名查找会失败**：

```bash
# ❌ Inspector 里看到的是 "board"，但底层 _name=""
{"op": "set-label-text", "node": "board", "text": "游戏说明", "labelNode": "title"}
# → Error: 找不到节点 "board"

# ✅ 用 query --tree 先查 id，然后用 __id__ 定位
{"op": "set-label-text", "node": {"id": 2}, "text": "游戏说明", "labelNode": "title"}
```

适用于所有 op 的所有节点引用字段（`node` / `parent` / `target` 等），不限于 set-label-text。

---

## 6. Op 全表

26 个 op，按场景分组。`node` / `parent` / `source` / `target` 均支持上面三种定位形式。

### 6.1 节点字段

| op | 参数 | 说明 |
|---|---|---|
| `set-active` | `node`, `active: bool` | 切换节点显隐 |
| `rename-node` | `node`, `name` | 改 `_name`。stub 走 propertyOverrides |
| `set-position` | `node`, `x`, `y`, `z?` | 设置本地位置（绝对值） |
| `adjust-position` | `node`, `dx?`, `dy?`, `dz?` | `_lpos` 相对偏移，免去先 query 取原值；任一轴缺省视为 0 |
| `set-node-color` | `node`, `r?`, `g?`, `b?`, `a?` | 改节点 `_color` 分量（0-255），至少提供一个分量。不支持 stub |
| `reorder-children` | `node`, `order` | 调整子节点顺序，影响 UI 渲染层级。`order` 是子节点名或 `{id:N}` 数组，**必须包含全部子节点** |

### 6.2 通用组件字段

| op | 参数 | 说明 |
|---|---|---|
| `set-component-field` | `node`, `componentType`, `property`, `value` | **普通节点**改任意组件任意字段。`property` 接字符串（顶层）或字符串数组（嵌套路径，如 `["_color","r"]`）。改 cc.Vec2/Vec3/Size 时 `value` 必须带 `__type__` |
| `set-component-enabled` | `node`, `componentType`, `enabled`, `subNode?` | 改组件 `_enabled`，stub 走 propertyOverrides |
| `set-nested-component-field` | `node`（stub）, `componentType`, `property`, `value`, `subNode?` | **stub 节点**改内部任意组件的任意字段。`property` 支持字符串或嵌套路径数组。SpriteFrame 等资源 `value` 自备 `{__uuid__,__expectedType__}` |
| `reset-overrides` | `node`（stub）, `property?`, `componentType?`, `subNode?`, `all?` | 清 stub 已写入的 propertyOverrides。`all: true` 清空整个数组（一键回滚到嵌套默认）；`property` 单条匹配——无 componentType = 节点字段（_lpos / _name 等），有 componentType = 嵌套内组件字段。幂等 |
| `ensure-meta` | `path` | 给 `.ts` / `.json` 文件创建 `.meta`（v4 uuid + 按扩展名选模板）。`path` 可绝对或相对项目根。已存在时幂等。**典型用法**：新建脚本 → `ensure-meta` → `add-component` 同 batch 内联动，免等 cocos 编辑器异步 import。dry-run 时不写盘。同 batch 内自动 invalidate classid-resolver cache，让后续 op 能查到新 className |

### 6.3 cc.UITransform 便捷

| op | 参数 | 说明 |
|---|---|---|
| `set-anchor` | `node`, `x?`, `y?`, `compensatePosition?` | `_anchorPoint` 便捷写法。`compensatePosition: true` 时按 anchor 差值 × size 自动补偿 `_lpos`，保持节点视觉位置不变。**stub 节点支持**：自动走 propertyOverrides 改嵌套 UITransform；compensate 时 `oldA/size` 从嵌套 prefab 默认值读 |
| `set-size` | `node`, `width?`, `height?` | `_contentSize` 便捷写法。**stub 节点支持**：自动走 propertyOverrides 改嵌套 UITransform |

### 6.4 cc.* 引擎组件多字段快捷 op

不含 stub 支持。改 stub 内同字段请用 `set-nested-component-field`。

| op | 参数 | 关键 enum |
|---|---|---|
| `set-label` | `node`, `text?`, `fontSize?`, `lineHeight?`, `overflow?`, `horizontalAlign?`, `verticalAlign?`, `bold?`, `italic?`, `underline?`, `enableWrapText?` | `overflow`: 0=NONE 1=CLAMP 2=SHRINK 3=RESIZE_HEIGHT 4=TRUNCATE |
| `set-label-text` | `node`, `text`, `labelNode?` | 改 `_string`，stub 节点走 propertyOverrides；`labelNode` 指定嵌套 prefab 内持有 Label 的子节点名 |
| `set-richtext` | `node`, `text?`, `maxWidth?`, `fontSize?`, `lineHeight?` | 支持 BBCode 标签 |
| `set-sprite` | `node`, `sizeMode?`, `type?`, `grayscale?`, `trim?` | `type`: 0=SIMPLE 1=SLICED 2=TILED 3=FILLED 4=MESH。**换图用 `set-sprite-frame`** |
| `set-sprite-frame` | `node`, `uuid: string`, `spriteNode?` | 替换 SpriteFrame uuid，stub 走 propertyOverrides |
| `set-button` | `node`, `interactable?`, `transition?`, `zoomScale?`, `duration?` | `transition`: 0=NONE 1=COLOR 2=SPRITE 3=SCALE |
| `set-editbox` | `node`, `inputMode?`, `maxLength?`, `placeholder?`, `string?`, `inputFlag?`, `fontSize?` | `inputMode`: 0=ANY 1=EMAIL 2=NUMERIC 3=PHONE 4=URL 5=DECIMAL 6=SINGLE_LINE |
| `set-layout` | `node`, `type?`, `resizeMode?`, `paddingLeft?`, `paddingRight?`, `paddingTop?`, `paddingBottom?`, `spacingX?`, `spacingY?`, `startAxis?`, `constraint?`, `constraintNum?`, `affectedByScale?` | `type`: 0=NONE 1=HORIZONTAL 2=VERTICAL 3=GRID |

### 6.5 节点结构

| op | 参数 | 说明 |
|---|---|---|
| `add-node` | `parent`, `node: {name, lpos?, active?, components?, width?, height?, anchor?}` | 新增 cc.Node；parent 是 stub 时走 mountedChildren。`components: ["UITransform"]` 自动建 UITransform |
| `add-spine-socket` | `node`, `path`, `target` | 给普通节点上的 `sp.Skeleton` 新增 / 更新 `sp.Skeleton.SpineSocket`。`path` 是 Spine socket path（如 `root/zk/tou2`），`target` 是绑定节点；同 path 幂等更新 target，不重复追加 |
| `remove-node` | `target` | 从父节点移除引用；元素本身保留（orphan），保持其他 `__id__` 稳定 |
| `sync-nested-roots` | (无) | 重建根 `PrefabInfo.nestedPrefabInstanceRoots`，剔除「删了一半」残留的悬空嵌套实例根（节点 `_parent` 已移除但根登记残留 → 残留嵌套 prefab 的 asset 仍被当依赖加载，运行时 404）。只重写该数组，不删 elements、不动其他 `__id__`、不产生 null 槽；被孤立的残留对象成为不可达 orphan。复用 remove-node 内部同名逻辑 |
| `clone-node` | `source`, `parent`, `name` | 深拷贝整棵子树，分配新 `__id__` + 新 fileId |

#### add-node 的 node 字段

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `name` | string | 必填 | 节点名 |
| `lpos` | [x,y,z] | [0,0,0] | 本地位置 |
| `active` | bool | true | 是否激活 |
| `components` | string[] | [] | `["UITransform"]` 自动创建 cc.UITransform |
| `width` / `height` | number | 100 | UITransform 尺寸（仅 components 含时生效） |
| `anchor` | [x,y] | [0.5,0.5] | UITransform 锚点 |

### 6.6 组件 / 引用

| op | 参数 | 说明 |
|---|---|---|
| `add-component` | `node`, `componentType`, `props?` | 在 `_components` 新挂一个组件 + 配套 CompPrefabInfo。`componentType` 支持 @ccclass 名（`"GMUI"`）、压缩 classId（`"a57b6RRA21B5I70mCpu1pBP"`）、引擎类（`"cc.Button"`） |
| `remove-component` | `node`, `componentType` | 从普通节点 `_components` 移除指定组件引用。组件元素与其 CompPrefabInfo 作为 orphan 保留在数组里，保持其他 `__id__` 稳定（与 `remove-node` 同策略）。**不支持 stub**——嵌套 prefab 的组件归子 prefab 拥有，外层只能用 `set-component-enabled` 禁用 |
| `set-component-ref` | `node`, `componentType`, `property`, `refNode`, `refType?`, `refSubNode?` | 给脚本组件 `@property` 挂节点 / 组件引用。详见 §6.7 |
| `dedupe-component` | `node?` | 合并同节点上同语义但重复挂载的组件条目（cli 写 className + 编辑器 reimport 写压缩 classId 形成两份的场景）。按规范化 classId 分组，留字段非空数最多的为 keeper，losers 字段并入后删除并重映射 `__id__`。`node` 缺省扫整 prefab |

### 6.7 set-component-ref 完整字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `op` | string | ✓ | `"set-component-ref"` |
| `node` | name / `{id}` / `{path}` | ✓ | 挂脚本的节点（持有 @property 字段） |
| `componentType` | string | ✓ | 脚本组件类型，支持 @ccclass 名、压缩 classId、`cc.Button` 等 |
| `property` | string | ✓ | @property 字段名（如 `"_role"`） |
| `refNode` | name / `{id}` / `{path}` | ✓ | 要绑定的目标节点。**stub 必须用 `{id:N}`**（_name 为 null） |
| `refType` | string | 可选 | 目标类型。省略 = 取 refNode 第一个非引擎组件；`"cc.Node"` = 绑节点本身（localID = 嵌套 prefab 根节点 PrefabInfo.fileId） |
| `refSubNode` | string \| string[] | 可选 | stub 内部子节点定位。**字符串**指定单层 stub 的子节点名；**字符串数组**走多层嵌套（每层一段名字，最后一段配合 refType 决定终点） |

**常见拼错**：`"comp"` → `componentType`，`"ref"` → `refNode`。schema 校验会友好提示。

`refNode` 是 stub 时自动走 `cc.TargetOverrideInfo` 协议（详见 [`nested-prefab-protocol.md`](./nested-prefab-protocol.md)）。

### 6.8 按场景速查

| 场景 | op |
|---|---|
| 改节点 _active / _name / _lpos | `set-active` / `rename-node` / `set-position`（普通+stub 通用） |
| _lpos 相对偏移 | `adjust-position` |
| cc.UITransform 锚点 + 自动补偿 lpos | `set-anchor`（带 `compensatePosition: true`） |
| cc.UITransform 尺寸 | `set-size` |
| 改普通节点任意组件字段（含嵌套路径） | `set-component-field` |
| 改 stub 内任意组件字段 | `set-nested-component-field` |
| 启用/禁用某组件 | `set-component-enabled` |
| 改子节点渲染顺序 | `reorder-children` |
| 一次改一批节点（按组件类型 / 名前缀 / 正则） | `bulk-set` |
| 改 cc.Label / Sprite / Button / EditBox / Layout / RichText 多字段 | `set-label` / `set-sprite` / `set-button` / `set-editbox` / `set-layout` / `set-richtext` |
| 改节点 _color | `set-node-color` |
| 给脚本 @property 挂引用（节点 / 组件 / 单层 stub / 多层 stub） | `set-component-ref`（多层用 `refSubNode: ["A","B"]`） |
| 加 / 删 / 复制节点 | `add-node` / `remove-node` / `clone-node` |
| 加 / 删组件 | `add-component` / `remove-component` |
| 合并重复组件 | `dedupe-component` |
| 跨多 prefab 跑同一组 ops | `batch --glob` |
| 比较两个 prefab | `diff` 子命令 |
| 操作 .anim 文件 | `anim query` / `anim batch` |

---

## 7. Op 配方（按场景示例）

### 7.1 绑定 @property 到普通节点上的组件

```json
{
  "op": "set-component-ref",
  "node": "SettingUI",
  "componentType": "SettingUI",
  "property": "_btnClose",
  "refNode": "btnClose",
  "refType": "cc.Button"
}
```

### 7.2 绑定 @property 到嵌套 prefab（stub）内部的组件

```json
{
  "op": "set-component-ref",
  "node": "SettingUI",
  "componentType": "SettingUI",
  "property": "_someLabel",
  "refNode": {"id": 33},
  "refType": "cc.Label"
}
```

`refNode` 必须用 `{"id": N}`（stub `_name` 为 null）。CLI 自动在 `cc.PrefabInfo.targetOverrides` 写 `cc.TargetOverrideInfo`。

### 7.3 绑定 @property 到 stub 根节点本身（cc.Node 类型）

```json
{
  "op": "set-component-ref",
  "node": "SettingUI",
  "componentType": "SettingUI",
  "property": "_role",
  "refNode": {"id": 33},
  "refType": "cc.Node"
}
```

`refType: "cc.Node"` 表示绑定节点本身。CLI 找嵌套 prefab 根节点（`_parent === null`）的 `cc.PrefabInfo.fileId`，生成 `localID: [fileId]`。

### 7.4 多层嵌套 stub @property 挂载

```json
{
  "op": "set-component-ref",
  "node": "Main",
  "componentType": "MainUI",
  "property": "_innerLabel",
  "refNode": {"id": 12},
  "refType": "cc.Label",
  "refSubNode": ["B", "C"]
}
```

主 prefab stub → 第一层嵌套内的 stub `B` → 第二层嵌套内的 `C` 节点上的 `cc.Label`。每跨一层 PrefabInstance 边界 push 一个 fileId 到 localID 链。1 层时仍可写字符串 `"B"`，向后兼容。

### 7.5 改 stub 内部某组件的字段

```json
{
  "op": "set-nested-component-field",
  "node": {"id": 33},
  "componentType": "cc.Label",
  "property": "_string",
  "value": "新文字"
}
```

### 7.6 改普通节点 cc.UITransform 锚点 + 保持视觉位置不变

```json
{
  "op": "set-anchor",
  "node": "itemList",
  "y": 1,
  "compensatePosition": true
}
```

内部按 `lpos.y += height * (newAnchorY - oldAnchorY)` 自动调整位置。

### 7.7 改普通节点的组件字段（嵌套路径）

```json
{
  "op": "set-component-field",
  "node": "label",
  "componentType": "cc.Label",
  "property": ["_color", "r"],
  "value": 255
}
```

`property` 接字符串（顶层）或字符串数组（嵌套路径，逐级下钻）。中间路径不是对象会报错，不会自动建中间结构。

### 7.8 bulk-set：批量改一类节点

```json
{
  "op": "bulk-set",
  "selector": { "byComponent": "cc.Label" },
  "target": "component:cc.Label",
  "property": "_isItalic",
  "value": true
}
```

`selector` 可组合（AND）：

- `{ byComponent: "cc.X" }`：节点上挂指定组件
- `{ byNamePrefix: "btn" }`：`_name` 前缀匹配
- `{ byNameRegex: "^icon_\\d+$" }`：正则

`target`：`"node"`（改节点字段）或 `"component:<Type>"`（改节点上某组件字段）。匹配 0 个不算错。**bulk-set 不处理 stub 节点**（避免代码路径混用）。

### 7.9 reorder-children

```json
{"op": "reorder-children", "node": "list", "order": ["item3", "item1", "item2"]}
```

`order` 必须包含全部子节点（数量校验），元素是 `string`（_name）或 `{id:N}`。

### 7.10 path 选择器（同名节点多 / id 不稳）

```json
{"op": "set-active", "node": {"path": "Canvas/Main/itemList"}, "active": false}
```

从根节点逐级按 `_name` 匹配 `_children`，遇 stub 不下钻。根节点名匹配第一段时可省略。同名段会取首个匹配。

### 7.11 dry-run 预览

```bash
node bin/cocos-mcp-cli.js batch <prefab> ops.json --dry-run
```

输出：

```json
{
  "changed": false,
  "opsApplied": 2,
  "nodesAffected": ["itemList"],
  "dryRun": true,
  "diff": [
    { "id": 65, "type": "cc.Node", "name": "itemList",
      "changes": { "_lpos.y": [-28, 412] } },
    { "id": 66, "type": "cc.UITransform", "name": "",
      "changes": { "_anchorPoint.y": [0.5, 1] } }
  ]
}
```

`diff` 是字段级，路径用点分（嵌套对象会展平）。

### 7.12 query 单字段值（脚本管道）

```bash
node bin/cocos-mcp-cli.js query <prefab> --selector field \
  --name itemList --comp cc.UITransform --field _anchorPoint
# → {"__type__": "cc.Vec2", "x": 0.5, "y": 1}
```

### 7.13 query 树带组件字段

```bash
node bin/cocos-mcp-cli.js query <prefab> --selector tree --with-comps
```

每个节点附 `components: [{type, id, fields}]`，`fields` 过滤掉系统字段（`__type__` / `node` / `_enabled` / `__prefab` 等）后的业务字段。

---

## 8. 已知坑

### 坑 1：stub 节点 `_name` 为 null

prefab JSON 里 stub 节点的 `_name` 是 `null`（不是字符串）。名字来自 `cc.PrefabInstance.propertyOverrides`，运行时才填。

**做法**：先 `query --selector tree` 拿 `id`，然后用 `{"id": N}` 定位。

### 坑 2：入口文件错

- `bin/cocos-mcp-cli.js` ✓
- `src/index.js` ✗（只是 re-export，无 CLI 入口）
- `src/cli/main.js` ✗（导出 `main()` 但不自调用）

### 坑 3：localID 链多层嵌套

CLI 的 `resolveLocalIdChain`（`src/editor/nested.js`）支持 `refSubNode` 字符串数组路径走多层。但每层都假定能按节点名定位 stub；不支持靠组件类型在中间层定位。极端深嵌套场景仍建议走 tools pipeline（`step-3-script/bind-prefab-components.ts`）。

### 坑 4：root 节点检测依赖 `_parent === null`

`getNestedNodeFileId` 通过 `el._parent === null` 判断嵌套 prefab 的根节点。不是靠 `cc.PrefabInfo.asset.__uuid__`——嵌套 prefab JSON 里所有节点的 PrefabInfo.asset 都是 `{__id__: 0}`（in-file 引用），`__uuid__` 字段不存在。

### 坑 5：`sourceInfo` 为 null vs cc.TargetInfo

- `source`（挂 @property 的脚本组件）在主 prefab 根节点上 → `sourceInfo: null`
- 脚本组件本身在某个 stub 内（`mountedComponents`）→ `sourceInfo` 要填 `cc.TargetInfo`。CLI 当前不支持，会抛错

### 坑 6：set-component-field vs set-nested-component-field 不通用

- **普通节点**改组件字段 → `set-component-field`（直改 elements 数组）
- **stub 节点**改组件字段 → `set-nested-component-field`（写 PrefabInstance.propertyOverrides + 嵌套 prefab fileId）

用错时 CLI 抛明确错误：「节点 X 是 stub 代理，请用 set-nested-component-field」。判别 stub 看 `query --selector tree` 输出的 `isStub` 字段。

### 坑 7：cc.Vec2/Vec3/Size 写入必须带 `__type__`

`set-component-field` 改这类字段时 `value` 必须形如 `{"__type__": "cc.Vec2", "x": 0.5, "y": 1}`，缺 `__type__` 会被 Cocos 反序列化为普通对象，运行时 `getAnchorPoint()` 等 API 拿不到正确值。

`set-anchor` / `set-size` op 内部已带 `__type__`，无需自己处理。

### 坑 8：bulk-set 跳过 stub 节点

`bulk-set` 实现不处理 stub。要批量改 stub 内字段，先 `query --selector find` 拿 stub id 列表，再逐个 `set-nested-component-field`。

### 坑 9：reorder-children.order 必须含全部子节点

不允许只列要前置的几个、剩下的自动补尾。order 长度 ≠ _children 长度直接抛错。避免「你以为剩下的会按原序，但 CLI 默认丢掉了」这种隐式行为。

### 坑 10：path 选择器同名段必须消歧

`{path: "A/B/C"}` 走每段时如果 `A._children` 下有 ≥2 个同名 B，CLI 直接抛错并列出候选 `__id__`，**不静默取首个**。同名场景请用 `{id:N}`，或组合"父用 path、当前层用 id"。

### 坑 11：schema 类型校验（已加）

schema 校验既检查"字段拼写 + 必填存在"也检查字段类型。`width: "100"` 这种类型错跑前直接报，不会进 handler 才崩。复杂值（`value` / `props` / `selector` / `refSubNode`）走 `any`，仍由 handler 报场景错。

### 坑 12：className → 压缩 classId 自动规范化

Cocos 编辑器反序列化时 `__type__` 可填 @ccclass 名（`"GMUI"`）或压缩 classId（`"a57b6RRA21B5I70mCpu1pBP"`），但**保存 prefab 时会 round-trip 为后者**。如果 TS 脚本注册前触发 reimport，@property refs 会被丢，导致出现「字符串版 + 压缩版」两份组件。

CLI 两端防护：

1. **写入前**：`add-component` / `set-component-ref` 的 `componentType` / `refType` 自动扫 `assets/scripts` 反查 `.ts.meta` uuid，转 23 字符压缩 classId 写入。引擎类（`cc.*`/`sp.*`/`dragonBones.*`）和已压缩格式原样透传
2. **写入后兜底**：用 `dedupe-component` op 合并已经被 round-trip 过的 prefab

### 坑 13：stub-node-field override 的 localID 用错 fileId

`set-position` / `rename-node` / `adjust-position` / `set-active` 等 op 对 stub 节点（嵌套 prefab 代理）写入字段时，走 `setOverrideProperty`，产物形如：

```json
{ "__type__": "cc.TargetInfo", "localID": ["<某 fileId>"] }
{ "__type__": "CCPropertyOverrideInfo", "targetInfo": { ... }, "propertyPath": ["_lpos"], "value": ... }
```

**正确的 localID 是「嵌套 prefab 内部根节点 PrefabInfo.fileId」**，不是「外层主 prefab 里 stub 自己的 PrefabInfo.fileId」。Cocos 运行时 `generateTargetMap` 按嵌套 prefab 内 fileId 建 targetMap，外层 stub fileId 在 map 里查不到，override 静默失效。

早期 fgui→cc3 转出的 prefab 设计上让这两个 fileId 一致（PrefabBuilder 复用同一 fileId），所以本工具早期版本里用 stubFileId 巧合工作；手编 prefab 或重新设计的标杆 prefab（如 `common-new/button/btnClose.prefab`）两个 fileId 一般不同，必须读嵌套 prefab JSON 拿真实根 fileId。

CLI 行为（2026-05-20 修，`cli/src/overrides.js`）：

1. **写入前**：`setOverrideProperty` 通过 `prefabInfo.asset.__uuid__` + `resolveUuidToPath` 加载嵌套 prefab，找根节点（`_parent === null`）的 `PrefabInfo.fileId` 作为 localID。**解析失败抛错**（不再 fallback 到 stubFileId），调用方需保证嵌套 prefab 可用。
2. **历史脏数据自动矫正（一次性迁移）**：识别旧版 cli 写入的 `stubFileId` 形式条目，命中同 propertyPath 时把 localID 改写成真值。仓库里现存的 fgui→cc3 转出 prefab 跑一次新 cli 就会逐步收敛到真值，无需手工迁移。
3. **`listOverrides` / `reset-overrides`**：只识别真值 localID（已迁移完的状态）。如果手工保留旧 stubFileId 条目不跑 cli 矫正，list/reset 会忽略它们。

诊断方法：在主 prefab JSON 里 grep `CCPropertyOverrideInfo` 找到目标条目，看 `targetInfo.localID[0]` 是否等于「嵌套 prefab 内根节点的 PrefabInfo.fileId」（在嵌套 prefab JSON 里直接 grep 根节点的 `fileId` 字段，或用 `query --selector overrides --id <stubId>` 看 cli 报告）。

### 坑 14：rootTargetOverrides 单字段 override 必须排在数组字段 override 之前

Cocos 加载 prefab 时遍历 `cc.PrefabInfo.targetOverrides` 数组应用 override。**实测 cocos 3.8.x 行为**：若数组前面有数组字段 override（`propertyPath = ["_items", N]`），数组后面的单字段 override（`propertyPath = ["_btnClose"]`）会被静默跳过，运行时 `ui._btnClose === null`。

最小可复现：TurnUI 有 14 个 `_items[N]` override，新 `set-component-ref _btnClose` 追加到数组末尾 → cocos 加载后 `ui._btnClose` 为 null。把这条 `_btnClose` 用 Python 移到数组首位 → 立即正常。对照实验同样的文件 mtime + reimport 流程，仅位置差异就触发不同结果，确认是顺序问题不是 reimport 时机。

CLI 防护（2026-05-20 修，`cli/src/editor/nested.js` `addRootTargetOverride`）：

1. **新条目按 `propertyPath.length` 分插**：
   - `length === 1`（单字段，如 `["_btnClose"]`）：`splice` 到第一个数组字段 override 之前
   - `length > 1`（数组字段，如 `["_items", 0]`）：`push` 到末尾
2. 已有的单字段 override 之间相对顺序不变（每次插入都在最后一个单字段之后、第一个数组字段之前）
3. 历史脏数据需手工迁移（Python `pop(idx) + insert(0, ref)` 或者 `splice(arrayBoundary, 0, ref)`）

诊断方法：用 `query --selector tree` 拿 prefab 整体结构，然后看 root `cc.PrefabInfo.targetOverrides` 数组里第一个 `propertyPath.length > 1` 条目的位置——之前的所有条目（包括目标单字段）能正常加载，之后的单字段都会被跳过。

---

## 9. 验证 targetOverrides 已写入

```bash
python3 -c "
import json
data = json.load(open('assets/packages/common/setting/ui/SettingUI.prefab'))
for el in data:
    if isinstance(el, dict) and el.get('__type__') == 'cc.PrefabInfo' and el.get('rootUuid'):
        print('targetOverrides count:', len(el.get('targetOverrides', [])))
        break
"
```

或 jq：

```bash
jq '[.[] | select(.__type__ == "cc.TargetOverrideInfo")] | length' \
  assets/packages/common/setting/ui/SettingUI.prefab
```

---

## 10. 协议参考

- `cc.TargetOverrideInfo` 协议细节：[`nested-prefab-protocol.md`](./nested-prefab-protocol.md)
- prefab JSON 结构速查：[`prefab-schema.md`](./prefab-schema.md)
- offline vs 编辑器路径决策：[`prefab-direct-edit.md`](./prefab-direct-edit.md)
- `.anim` 文件结构：[`anim-schema.md`](./anim-schema.md)

多层嵌套 localID 链的 tools pipeline 实现：`tools/step-3-script/bind-prefab-components.ts` 的 `resolveLocalIdChain`。

---

## 11. 源码导航

```
extensions/cc-3-8-x-mcp/cli/
├── bin/cocos-mcp-cli.js        # CLI 入口（require src/cli/main.js）
└── src/
    ├── index.js                 # 公开 API re-export（parsePrefab / writePrefab / editPrefab / queryPrefab / ...）
    ├── parse.js / write.js      # JSON 数组 + __id__ 引用格式的读写
    ├── id.js                    # deterministic fileId / classId 压缩
    ├── primitives.js            # cc.Node / cc.PrefabInfo / cc.UITransform 等节点对象构造原语
    ├── overrides.js             # cc.PrefabInstance.propertyOverrides 读写
    ├── classid-resolver.js      # @ccclass 名 → 压缩 classId（扫 assets/scripts/*.ts.meta）
    ├── uuid-resolver.js         # uuid → 磁盘路径（扫 assets/**/*.prefab）
    ├── anim-primitives.js       # .anim 文件构造原语
    │
    ├── editor/                  # editPrefab 主入口 + op handler
    │   ├── index.js             # editPrefab + OP_HANDLERS 注册表
    │   ├── helpers.js           # resolveNode（name/id/path）/ findComponent / isStub / normalizeComponentType
    │   ├── nested.js            # stub / 嵌套 prefab fileId 协议（多层支持）
    │   ├── id-utils.js          # fileId 分配 / 子树断开 / __id__ 重映射
    │   ├── diff.js              # 字段级 diff（dry-run + diff 子命令共用）
    │   ├── op-schema.js         # ops 跑前 schema 校验
    │   └── ops/                 # 26 个 op handler，一文件一个
    │
    ├── query/                   # 只读查询
    │   ├── index.js / tree.js / node.js / find.js / field.js
    │   └── comp-fields.js
    │
    └── cli/                     # 命令行子命令分发
        ├── main.js / flags.js / help.js
        ├── query-cmd.js / set-cmd.js
        ├── batch-cmd.js         # 含 --glob 实现
        ├── anim-cmd.js
        └── diff-cmd.js
```

### 加新 op 流程

1. `src/editor/ops/<new-op>.js` 写 handler，导出 `execXxx`
2. `src/editor/index.js` 在 `OP_HANDLERS` 加一行 + import
3. `src/editor/op-schema.js` 在 `SCHEMAS` 登记必填 / 可选字段
4. 本文档 §6（op 全表）+ §6.8（按场景速查）补一行
5. `test/api.test.js` 加测试用例

### 测试

```bash
# 6 个测试文件 116 个用例
for f in extensions/cc-3-8-x-mcp/cli/test/*.test.js; do
  node --test "$f" 2>&1 | grep -E "^# (pass|fail)"
done
```
