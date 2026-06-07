# Quick Ref — Agent 速查表

> 一页搞定。复杂场景看 [`doc/cli.md`](./doc/cli.md)。

## 入口（在 `forest/` 项目根执行）

```bash
node extensions/cc-3-8-x-mcp/cli/bin/cocos-mcp-cli.js <command>
```

## 节点定位三种形式（`node` / `parent` / `target` / `source` / `refNode` 通用）

| 写法 | 用途 |
|---|---|
| `"itemList"` | 名字，首个匹配 |
| `{"id": 65}` | __id__；**stub 节点 `_name` 为 null，必须用这个** |
| `{"path": "Canvas/Main/itemList"}` | DOM-like 路径；同名节点多时用 |

## 我要做什么 → 用什么

### 看 prefab

| 场景 | 命令 |
|---|---|
| 看节点树 | `query <prefab> --selector tree` |
| 看节点树 + 所有组件字段 | `query <prefab> --selector tree --with-comps` |
| 看单节点详情 | `query <prefab> --selector node --name X --with-comps` |
| 拿单组件单字段值（脚本管道） | `query <prefab> --selector field --name X --comp cc.UITransform --field _anchorPoint` |
| 列所有 cc.Label 的 id | `query <prefab> --selector find --type cc.Label` |
| 看 stub 节点已写入的所有 propertyOverrides | `query <prefab> --selector overrides --id 58` |
| 比较两个 prefab 字段差异 | `diff <a> <b>` |

> ⚠️ **下方「改 prefab」各表列的是 op 名，不是独立子命令**——统一通过 `batch <prefab> ops.json` 执行（单条改动也要包成 `[{"op":"...",...}]`）。直接 `cli set-sprite-frame ...` 会报「未知子命令」。CLI 真正的子命令只有 `query` / `set`（单字段快捷写入 `set <prefab> <node> <field> <value>`）/ `batch` / `anim` / `diff`。写法见下方 §写 ops.json 速记。

### 改 prefab — 节点字段

| 场景 | op |
|---|---|
| 改 _active | `set-active` |
| 改 _name | `rename-node` |
| 改 _lpos（绝对值 x/y/z） | `set-position` |
| 改 _lpos（相对偏移 dx/dy/dz） | `adjust-position` |
| 改 _color（r/g/b/a，0-255） | `set-node-color` |
| 调子节点顺序 | `reorder-children`（order 必须含全部子节点） |
| 把节点搬到另一个父节点下 | `reparent`（node + parent + index?；不复制；普通 inline 节点；自带循环检测）|

### 改 prefab — 组件字段

| 场景 | op |
|---|---|
| 改普通节点任意组件任意字段（含嵌套路径 `["_color","r"]`） | `set-component-field` |
| 改 stub 内部组件字段 | `set-nested-component-field` |
| 清 stub 字段 override（回滚嵌套默认） | `reset-overrides`（单条 + property / `all:true` 清空） |
| 启用/禁用某组件 | `set-component-enabled` |
| cc.UITransform 锚点（含自动补偿 lpos，stub 也支持） | `set-anchor`（带 `compensatePosition: true`） |
| cc.UITransform 尺寸（stub 也支持） | `set-size` |
| cc.Label 文字 | `set-label-text` |
| cc.Label 多字段（fontSize / overflow / bold 等） | `set-label` |
| cc.Sprite 换图 | `set-sprite-frame` |
| cc.Sprite 模式字段（sizeMode / type / grayscale） | `set-sprite` |
| cc.Button 多字段（interactable / transition 等） | `set-button` |
| cc.EditBox 多字段（inputMode / maxLength / placeholder） | `set-editbox` |
| cc.Layout 多字段（type / spacing / padding） | `set-layout` |
| cc.RichText 多字段（text / maxWidth） | `set-richtext` |
| 一次改一批（按组件类型 / 名前缀 / 正则筛选） | `bulk-set` |

### 改 prefab — 节点结构 / 引用

| 场景 | op |
|---|---|
| 加节点 | `add-node` |
| 加嵌套 prefab 实例（stub） | `add-nested-prefab`（parent + prefabUuid + name? + lpos?） |
| 替换嵌套 prefab 的 asset uuid（保留 stub 结构） | `replace-nested-prefab`（target + prefabUuid + clearOverrides?） |
| 删节点 | `remove-node` |
| 清悬空嵌套实例根（删了一半的 prefab 残留：父引用没了但根 PrefabInfo 登记还在，残留 asset 仍被加载 → 404）| `sync-nested-roots`（无参，重建根 nestedPrefabInstanceRoots） |
| 复制节点 | `clone-node` |
| 加组件 | `add-component` |
| 删组件（普通节点） | `remove-component`（stub 不支持，用 `set-component-enabled` 禁用） |
| **新建 .ts / .json 后让 cli 当场可识别** | `ensure-meta`（path 相对项目根或绝对路径，建 v4 uuid meta）。**新建脚本必须用**——不然 add-component 会因 cli 查不到 .meta 抛错。同 batch 内放在 `add-component` 前 |
| 给脚本 @property 挂节点引用 | `set-component-ref`（refType=`cc.Node`） |
| 给脚本 @property 挂组件引用 | `set-component-ref`（refType=`cc.Button` 等） |
| 给脚本 @property 挂 stub 内组件 | `set-component-ref`（refNode 是 stub，自动走 TargetOverrideInfo） |
| 给脚本 @property 挂多层嵌套 stub 内组件 | `set-component-ref`（refSubNode 用字符串数组 `["A","B"]`） |
| 给脚本 @property **数组字段** 按索引挂载（`_items[0]`/`_items[1]`…） | `set-component-ref`（property 写 `"_items.0"` 或 `"_items[0]"`，多次调用各索引共存） |
| 合并同节点重复组件（cli 字符串版 + 编辑器压缩版） | `dedupe-component` |

### 跨文件 / 其他

| 场景 | 命令 |
|---|---|
| 跑 ops.json | `batch <prefab> <ops.json>` |
| 干跑预览（不写盘） | `batch <prefab> <ops.json> --dry-run` |
| 跨多个 prefab 跑同一组 ops | `batch <ops.json> --glob "<pattern>"`（先 `--dry-run` 确认匹配） |
| 操作 .anim 文件 | `anim query` / `anim batch <file> <ops.json>` |
| 单字段快捷写入（active / label.text / position.x\|y\|z） | `set <prefab> <nodeName> <field> <value>` |
| 创建新 prefab（最小 root + UITransform） | `create-prefab <out> [--name X] [--width W] [--height H]` |
| 创建 spine prefab（root + UITransform + sp.Skeleton） | `create-prefab <out> --add-spine <skel-uuid>`，批量靠 shell `for` 循环喂 .skel.meta 的 uuid |
| **从 src 提取某子节点为独立 prefab**（含组件 + PrefabInfo + stub 嵌套等所有引用闭包） | `extract-prefab <src> <out> --node <selector> [--name X]`。selector 同 batch 三种（名/`{id:N}`/`{path:"A/B"}`）。新根 `_parent=null`，PrefabInfo.root 指自己、asset 指 idx 0；适合"把 HomeBottom.btnTask 拆成 task BottomEntry.prefab" 这类场景 |
| **清 prefab data 数组 null 槽位 + 重映射 __id__**（早期手工生成的历史包袱） | `compact-prefab <prefab> [--dry-run]`。Cocos editor 反序列化容错跳过 null，但 build worker 严格 scan 撞 null 崩 `Cannot read properties of undefined (reading '__type__')`。算法同 extract-cmd line 105-132 紧凑 push + remap，但不剔除任何东西。dry-run 输出 dangling 引用警告（指向已删 null 的 `__id__`）。只清顶层 data 数组 null；子节点字段里的 null 引用要靠 GUI 重存或 query+set 单点修复 |

## 写 ops.json 速记

```json
[
  {"op": "set-active", "node": "X", "active": false},
  {"op": "rename-node", "node": "X", "name": "Y"},
  {"op": "reparent", "node": "child", "parent": "newParent"},
  {"op": "reparent", "node": {"id": 33}, "parent": "container", "index": 0},
  {"op": "set-anchor", "node": "X", "y": 1, "compensatePosition": true},
  {"op": "set-size", "node": "X", "width": 600, "height": 800},
  {"op": "set-component-field", "node": "X", "componentType": "cc.UITransform", "property": "_anchorPoint", "value": {"__type__": "cc.Vec2", "x": 0.5, "y": 1}},
  {"op": "set-component-field", "node": "X", "componentType": "cc.Label", "property": ["_color", "r"], "value": 255},
  {"op": "set-nested-component-field", "node": {"id": 33}, "componentType": "cc.Label", "property": "_string", "value": "新文字"},
  {"op": "set-component-ref", "node": "X", "componentType": "MyUI", "property": "_role", "refNode": {"id": 33}, "refType": "cc.Node"},
  {"op": "set-component-ref", "node": "X", "componentType": "MyUI", "property": "_items.0", "refNode": {"id": 27}, "refType": "ItemComp"},
  {"op": "set-component-ref", "node": "X", "componentType": "MyUI", "property": "_items[1]", "refNode": {"id": 40}, "refType": "ItemComp"},
  {"op": "bulk-set", "selector": {"byComponent": "cc.Label"}, "target": "component:cc.Label", "property": "_isItalic", "value": true},
  {"op": "reorder-children", "node": "list", "order": ["item3", "item1", "item2"]}
]
```

## 高频踩坑（详见 doc/cli.md §8）

| 症状 | 原因 / 解法 |
|---|---|
| `找不到节点 "xxx"` 但 query 看见了 | xxx 是 stub，`_name` 为 null。改用 `{id:N}` |
| 修改后 Cocos 编辑器打开发现字段没生效 | stub 节点要走 propertyOverrides。`set-component-field` 用错了，stub 改字段必须用 `set-nested-component-field` |
| 改 anchor 后视觉位置偏了 | 加 `compensatePosition: true` 自动补偿 lpos |
| 字段拼错 / 缺必填 / 未知 op / 类型错 | schema 校验跑前一次报齐（`comp` → `componentType` 拼写提示；`width:"100"` 类型错明示期望类型） |
| 改 cc.Vec2/Vec3/Size 字段后运行时取值不对 | `value` 必须带 `__type__: "cc.Vec2"`，`set-anchor` / `set-size` 已自动带 |
| `reorder-children` 抛错 "order 长度 ≠ _children 长度" | order 必须列全部子节点（不允许只列要前置的几个） |
| `{path:...}` 抛错"同名子节点 N 个" | path 不能消歧。用 `{id:N}` 精确定位 |
| `_name` 为 null（query tree 输出里看到） | stub 节点正常现象，名字在 PrefabInstance.propertyOverrides，运行时填 |
| `set-component-ref` 报"未挂 XXX 组件"，但 add-component 刚刚加上 | `componentType` 格式不一致：add-component 传了原始 UUID，set-component-ref 传了 @ccclass 名，两者被规范化成不同字符串。**修复已合入**：三种形式（@ccclass 名 / 原始 UUID / 压缩 classId）现在可混用，同 batch add+ref 也不再需要拆分。 |
| `set-component-ref` 多次挂同一数组字段（`_items`），后一条覆盖前一条 | 旧版幂等检查按 `propertyPath[0]` 去重，同字段名只保留一条。**修复已合入**：`property` 支持 `"_items.0"` / `"_items[0]"` 写法，幂等 key 改为完整路径数组，各索引独立共存。 |
| nested prefab 数组字段 override 写入后 Cocos inspector 显示空 / 运行时 `_items[N]` 全是 null | **数组索引 propertyPath 必须 int 不是 string**：propertyPath 末段（数组索引）类型必须是 number，不是 string。Cocos 编辑器按 string key 匹配不到数组槽，override 静默失效。CLI `addRootTargetOverride` 已在写入前自动 normalize（2026-05-18 修），调用 `set-component-ref` 传 `"_items.0"` 或 `"_items[0]"` 均安全，直接传 `["_items", "0"]` string 数组也会被自动转 int。 |
| stub 节点 `set-position` / `rename-node` 写入后，Cocos 加载该 prefab 时 _name / _lpos override 没生效（嵌套实例显示默认值） | **stub-node-field 类型 override.targetInfo.localID 必须是「嵌套 prefab 内根节点 PrefabInfo.fileId」**，不是「外层 stub 自己的 PrefabInfo.fileId」。早期 fgui→cc3 转出的 prefab 设计上两个 fileId 一致，所以巧合工作；手编/重设计的 prefab 一般不一致就暴露。CLI `setOverrideProperty` 已在写入前加载嵌套 prefab 拿真实根 fileId（2026-05-20 修，**解析失败抛错**），并在命中旧版 stubFileId 写入的条目时**自动矫正** localID（一次性迁移历史脏数据）。`listOverrides` / `reset-overrides` 只识别真值 localID。 |
| `set-component-ref` 新加单字段引用（如 `_btnClose`）后，Cocos 加载时 `ui._xxx` 仍为 null，对应字段没赋值 | **Cocos 加载 rootTargetOverrides 数组时，单字段 override 必须排在数组字段 override（`_items[N]`）之前**，否则被静默跳过。CLI `addRootTargetOverride` 已自动按 propertyPath 长度分插（2026-05-20 修，`cli/src/editor/nested.js`）：`propertyPath.length === 1` 插到第一个数组字段 override 之前，`length > 1` 追加到末尾。原 `rootPrefabInfo.targetOverrides.push(...)` 改为 `splice(firstArrayIdx, 0, ...)`。 |
| `remove-node` 删嵌套 stub 后，Cocos 加载父 prefab 报错 / 外层脚本对该 stub 内部的引用（如 `_passScoreView`）悬空 | 删 stub 时只移除了 `_children`/`mountedChildren`/`nestedPrefabInstanceRoots`，**根 PrefabInfo.targetOverrides 里 source/target 指向被删子树的条目没清**——外层脚本 @property 引用嵌套实例内部组件/节点走 targetOverride，残留为**可达**悬空引用（区别于软删保留的不可达孤儿，后者无害）。**修复已合入**（2026-06-01，`cli/src/editor/ops/remove-node.js` 加 `collectSubtreeIds` + `cleanupRootTargetOverrides`）：删子树前收集全部 __id__，从根 targetOverrides 过滤掉 source/target 落入子树的条目（被删 override 对象本身保留为孤儿，符合软删策略）；`target=null`（走 targetInfo.localID）的无关条目保留。 |

## 标准工作流

```bash
# 1. 看节点树拿 id
node extensions/cc-3-8-x-mcp/cli/bin/cocos-mcp-cli.js query <prefab> --selector tree

# 2. 写 /tmp/ops.json

# 3. 干跑预览
node extensions/cc-3-8-x-mcp/cli/bin/cocos-mcp-cli.js batch <prefab> /tmp/ops.json --dry-run

# 4. 落盘
node extensions/cc-3-8-x-mcp/cli/bin/cocos-mcp-cli.js batch <prefab> /tmp/ops.json

# 5. 类型检查
npx tsc --noEmit
```

## 完整文档

- [`README.md`](./README.md) — MCP 扩展定位 + 架构 + tools 清单
- [`doc/cli.md`](./doc/cli.md) — **CLI 完整手册**（命令、配方、已知坑、源码导航）
- [`doc/prefab-schema.md`](./doc/prefab-schema.md) — prefab JSON 结构
- [`doc/nested-prefab-protocol.md`](./doc/nested-prefab-protocol.md) — `cc.TargetOverrideInfo` 协议
- [`doc/anim-schema.md`](./doc/anim-schema.md) — `.anim` 文件结构
