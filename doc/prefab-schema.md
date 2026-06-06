# CC 3.8.x Prefab 文件结构速查表

> 目标读者：写 cocos-mcp-cli 直接读写 .prefab 文件的 AI / 工具开发者。
> 不是 Cocos 官方文档的复读；只讲这个仓库里 prefab 实际长什么样、改它要注意什么。
> 样本来源：HomeUI.prefab / MergeUI.prefab / PassBar2.prefab / LoadingUI.prefab。

---

## 1. 文件总体结构：顶层数组 + `__id__` 交叉引用

### 例子

```json
[
  { "__type__": "cc.Prefab", "_name": "PassBar2", "data": { "__id__": 1 } },
  { "__type__": "cc.Node",   "_name": "PassBar2",  "_children": [{"__id__": 2}], "_components": [{"__id__": 16}], "_prefab": {"__id__": 22} },
  { "__type__": "cc.Node",   "_name": "bar",       "_parent": {"__id__": 1}, ... },
  ...
  { "__type__": "cc.UITransform", "node": {"__id__": 2}, ... },
  { "__type__": "cc.CompPrefabInfo", "fileId": "xGXA9SOZ9EEId1SlOOZ8ww" },
  ...
  { "__type__": "cc.PrefabInfo", "root": {"__id__": 1}, "asset": {"__id__": 0}, "fileId": "VvRjmVLAOqp/Xn7PjxOSlg", "instance": null, "nestedPrefabInstanceRoots": null }
]
```

### 说明

整个文件是一个 **JSON 数组**，每个元素称为一个"对象（object）"。对象之间的引用全部用 `{ "__id__": N }` 表达，N 是该数组下标（0-based）。没有任何嵌套层级——所有节点、组件、Prefab 元信息都平铺在同一层数组里。

- 下标 0：永远是 `cc.Prefab` 资产描述对象，`data` 字段指向根 Node 的 `__id__`。
- 下标 1：通常是根 `cc.Node`（`_parent: null`）。
- 其余下标：子 Node、组件、PrefabInfo、CompPrefabInfo、CCPropertyOverrideInfo 等，顺序大致遵循"先父后子、先节点后组件"但并非强约束。

### 坑

**读一个 `__id__` 就等于对数组做随机访问，绝对不要假设某类型在固定下标。** 必须先从 `cc.Prefab.data.__id__` 找根节点，再沿 `_children`、`_components`、`_prefab` 递归遍历。

---

## 2. 常见 `__type__` 清单与关键字段

| `__type__` | 职责 | 关键字段 |
|---|---|---|
| `cc.Prefab` | 文件根描述 | `_name`, `data.__id__`（→ 根 Node）, `optimizationPolicy`, `persistent` |
| `cc.Node` | 场景节点 | `_name`, `_parent`, `_children[]`, `_components[]`, `_prefab`, `_lpos`, `_lrot`, `_lscale`, `_euler`, `_layer`, `_active`, `_objFlags` |
| `cc.PrefabInfo` | 节点的 prefab 元信息 | `root`, `asset`, `fileId`, `instance`（→ PrefabInstance 或 null）, `targetOverrides`, `nestedPrefabInstanceRoots` |
| `cc.CompPrefabInfo` | 组件的 prefab 元信息 | `fileId`（该组件在 prefab 内的唯一 ID） |
| `cc.PrefabInstance` | 嵌套 prefab 实例描述 | `fileId`, `prefabRootNode.__id__`（恒为 1，即被嵌套 prefab 的根）, `mountedChildren[]`, `mountedComponents[]`, `propertyOverrides[]`, `removedComponents[]` |
| `cc.TargetInfo` | 覆写目标定位 | `localID: [fileId字符串]`（对应被嵌套节点/组件的 fileId） |
| `CCPropertyOverrideInfo` | 单条属性覆写 | `targetInfo.__id__`, `propertyPath: string[]`, `value` |
| `cc.UITransform` | 尺寸/锚点 | `node.__id__`, `_contentSize`, `_anchorPoint`, `__prefab.__id__`（→ CompPrefabInfo） |
| `cc.Sprite` | 图片渲染 | `node.__id__`, `_spriteFrame.__uuid__`（格式 `uuid@f9941`）, `_type`（0=SIMPLE/3=FILLED）, `_color`, `_isTrimmedMode` |
| `cc.Label` | 文字 | `node.__id__`, `_string`, `_fontSize`, `_horizontalAlign`, `_overflow`, `_font.__uuid__`, `_enableOutline`, `_outlineColor`, `_outlineWidth` |
| `cc.Widget` | 布局对齐 | `node.__id__`, `_alignFlags`（位掩码）, `_left/_right/_top/_bottom`, `_isAbsLeft` 等, `_alignMode` |
| `cc.Button` | 按钮 | `node.__id__`, `_interactable`, `_transition`（0=NONE/1=COLOR/2=SPRITE/3=SCALE）, `_normalColor`, `_zoomScale`, `_target`, `clickEvents[]` |
| `cc.ProgressBar` | 进度条 | `node.__id__`, `_barSprite.__id__`（→ 子节点上的 cc.Sprite 组件）, `_mode`（0=H/1=V/2=FILLED）, `_totalLength`, `_progress` |
| `cc.ScrollView` | 滚动视图 | `node.__id__`, `horizontal`, `vertical`, `elastic`, `inertia`, `_content`（→ 内容节点） |
| `cc.Layout` | 自动布局 | `node.__id__`, `_layoutType`（0=NONE/1=H/2=V/3=GRID）, `_resizeMode`, `_paddingLeft/_Right/_Top/_Bottom`, `_spacingX/_Y` |
| `cc.Mask` | 遮罩 | `node.__id__`, `_type`（0=RECT/1=ELLIPSE/2=GRAPHICS_STENCIL） |
| `cc.ProgressBar` | 进度条 | 同上 |
| `cc.RichText` | 富文本 | `node.__id__`, `_string`（支持 BBCode）, `_fontSize`, `_maxWidth` |

自定义组件（如 `fca1cfQuOlKb5w9Ll8YoEt8`）：`__type__` 是 UUID 压缩串而非 `cc.xxx`，见第 6 节。

---

## 3. Node 的核心字段详解

### 例子（PassBar2.prefab 根节点）

```json
{
  "__type__": "cc.Node",
  "_name": "PassBar2",
  "_objFlags": 0,
  "__editorExtras__": {},
  "_parent": null,
  "_children": [{"__id__": 2}, {"__id__": 10}],
  "_active": true,
  "_components": [{"__id__": 16}, {"__id__": 18}, {"__id__": 20}],
  "_prefab": {"__id__": 22},
  "_lpos": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
  "_lrot": {"__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1},
  "_lscale": {"__type__": "cc.Vec3", "x": 1, "y": 1, "z": 1},
  "_mobility": 0,
  "_layer": 33554432,
  "_euler": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
  "_id": ""
}
```

### 说明

| 字段 | 含义 |
|---|---|
| `_parent` | 父节点引用（`{__id__: N}` 或 `null`） |
| `_children` | 子节点引用数组（顺序即渲染顺序，后面的在上层） |
| `_components` | 该节点挂载的组件引用数组 |
| `_prefab` | 指向 `cc.PrefabInfo` 对象（每个节点都有） |
| `_lpos` | 本地位置，cc.Vec3（x/y/z） |
| `_lrot` | 本地旋转，四元数 cc.Quat（x/y/z/w），w=1 表示无旋转 |
| `_lscale` | 本地缩放，cc.Vec3，默认 (1,1,1) |
| `_euler` | 对应 `_lrot` 的欧拉角（单位°），改旋转时两者必须同步 |
| `_layer` | 渲染层，UI 节点固定为 `33554432`（= 1 << 25） |
| `_active` | 是否显示（false = 隐藏，不等于 opacity=0） |
| `_mobility` | 0=STATIC，1=STATIONARY，2=MOBILE，UI 通常 0 |
| `_id` | 运行时 id（prefab 内节点均为 `""`，场景里才有值） |

### 坑

**`_lrot` 和 `_euler` 必须同时改**，否则编辑器打开后会用 `_lrot` 覆盖 `_euler` 或反之，产生意外旋转。即使只需要改 2D 旋转，也要同步写两处：

```json
"_lrot": {"__type__": "cc.Quat", "x": 0, "y": 0, "z": 0.7071, "w": 0.7071},
"_euler": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 90}
```

---

## 4. PrefabInstance 和 propertyOverrides：嵌套 prefab 改属性必须走这里

这是整个 prefab 格式中最反直觉的部分。当一个 prefab 引用另一个 prefab（嵌套）时，**引用方的节点树里没有子组件的字段**，改哪里都没用——属性全在 `cc.PrefabInstance.propertyOverrides` 里。

### 例子（HomeUI.prefab 引用 taskEntry 子 prefab）

```json
// 嵌套 prefab 的 stub 节点（几乎空的）
{
  "__type__": "cc.Node",
  "_objFlags": 0,
  "_parent": {"__id__": 1},
  "_prefab": {"__id__": 11},
  "__editorExtras__": {}
}

// 该 stub 节点的 PrefabInfo（标识它是哪个 prefab 的实例）
{
  "__type__": "cc.PrefabInfo",
  "root": {"__id__": 10},
  "asset": {"__uuid__": "36cca336-1f01-4c37-8ff4-9effb9279c44", "__expectedType__": "cc.Prefab"},
  "fileId": "as0LdMaKxSWSLxrZB9u9KA",
  "instance": {"__id__": 12},
  "targetOverrides": null
}

// PrefabInstance（propertyOverrides 在这里）
{
  "__type__": "cc.PrefabInstance",
  "fileId": "yNEx5g/jVxdN7FE/+ittNA",
  "prefabRootNode": {"__id__": 1},
  "mountedChildren": [],
  "mountedComponents": [],
  "propertyOverrides": [{"__id__": 14}, {"__id__": 15}, ...],
  "removedComponents": []
}

// TargetInfo：定位要改哪个节点/组件（用 localID 匹配 fileId）
{
  "__type__": "cc.TargetInfo",
  "localID": ["as0LdMaKxSWSLxrZB9u9KA"]
}

// CCPropertyOverrideInfo：实际的属性值
{
  "__type__": "CCPropertyOverrideInfo",
  "targetInfo": {"__id__": 13},
  "propertyPath": ["_lpos"],
  "value": {"__type__": "cc.Vec3", "x": -272, "y": 53, "z": 0}
}
```

### 说明

引用链：stub Node → PrefabInfo（含 fileId + instance 引用）→ PrefabInstance → propertyOverrides[] → CCPropertyOverrideInfo（含 targetInfo）→ TargetInfo（localID = 被嵌套 prefab 内目标节点的 PrefabInfo.fileId）。

**localID 的值**来自被嵌套 prefab 文件内对应节点的 `cc.PrefabInfo.fileId`，两边必须完全一致。根节点的 localID 即 stub 节点自身 `cc.PrefabInfo.fileId`。

覆写组件属性时，TargetInfo.localID 填的是**该组件的 cc.CompPrefabInfo.fileId**（不是节点的 PrefabInfo.fileId）。

### 坑

**直接修改 stub 节点的字段（如 `_lpos`）对嵌套 prefab 完全无效**。编辑器加载时会用 propertyOverrides 覆盖回去。必须找到对应的 CCPropertyOverrideInfo 修改 value，或新增一条覆写记录。

---

## 5. MountedChildren / MountedComponents：动态挂载节点

`cc.PrefabInstance` 的 `mountedChildren` 和 `mountedComponents` 用于在嵌套 prefab 实例上**额外追加**节点或组件（原 prefab 定义里没有的）。

本仓库实际样本中这两个字段均为 `[]`（空数组）。如需 AI 工具新增动态挂载，需要：

1. 把新节点对象 push 进 prefab 数组，分配新的下标。
2. 在 `mountedChildren` 里加入 `{__id__: 新节点下标}`。
3. 新节点的 `_parent` 必须指向该 stub 节点的下标。
4. 新节点也需要一个 `cc.PrefabInfo`（`instance: null`，`asset` 指向当前 prefab `{__id__: 0}`）。

该特性复杂且编辑器兼容性未经充分验证，**非必要不要动**。

---

## 5.5 TargetOverrides：主 prefab 脚本 @property 跨嵌套 prefab 挂载

`cc.PrefabInfo.targetOverrides`（注意是主 prefab **根**节点的 PrefabInfo，不是 stub 节点的）用于：主 prefab 里的某个脚本组件有 `@property` 字段要引用**嵌套 prefab 内部**的节点/组件。

最常见场景：fgui 转 cc3 后，父 prefab 里的按钮 / 容器节点都是 nested stub，真正的 `cc.Button` / `cc.Label` 在子 prefab 里，`BottomView.ts` 等脚本的 `@property` 要指向这些目标时，直接 `comp._btnStore = ref(stubId)` 会让 Cocos 加载时拿到 stub 代理而非真实组件。必须走 `cc.TargetOverrideInfo` + `cc.TargetInfo.localID`（fileId 数组），引擎 `applyTargetOverrides` 从代理节点的 targetInstance.targetMap 逐层查目标对象再挂回源字段。

协议细节、localID 多层语义、踩坑与离线工具接入见：[`nested-prefab-protocol.md`](./nested-prefab-protocol.md)。

cli 入口：`set-component-ref` op（refNode 是 stub 自动走 targetOverrides）；批量场景由 `tools/step-3-script/bind-prefab-components.ts` 覆盖。

---

## 6. fileId 和 UUID 的生成规律

### fileId（节点/组件在 prefab 内的唯一 ID）

格式：**base64 编码的 16 字节随机数**，去掉末尾 `=` 号，22~24 个字符，例如 `xGXA9SOZ9EEId1SlOOZ8ww`。

工具链的确定性生成方式（见 `tools/fgui2cc3/src/utils/DeterministicId.ts`）：

```typescript
export function deterministicFileId(seed: string): string {
  const hash = createHash('sha256').update(seed).digest();
  return hash.subarray(0, 16).toString('base64').replace(/=+$/, '');
}
```

种子格式：`${baseSeed}#fid#${counter++}`，相同种子产生相同 fileId，保证转换产物幂等。

**手工写 prefab 时**，可以用任意不重复的 base64 字符串，只要 prefab 内不冲突。重复 fileId 会导致编辑器覆写时定位错误。

### UUID（资产引用）

引用外部资产（图片/字体/其他 prefab）时用标准 UUID v4，例如 `36cca336-1f01-4c37-8ff4-9effb9279c44`。

SpriteFrame 的 uuid 格式是 `资产uuid@f9941`（`@f9941` 是固定后缀，指向 SpriteFrame 子资产）。

自定义组件脚本的 `__type__` 不是类名，而是**压缩 UUID**（PrefabBuilder.compressUuid）：取 UUID hex 的前 5 字符 + 后 27 字符 base64 编码的前 18 字符，共 23 字符，例如 `fca1cfQuOlKb5w9Ll8YoEt8`。反过来查类名需要在 `.meta` 文件里找。

---

## 7. .meta 文件结构

### 例子（HomeUI.prefab.meta）

```json
{
  "ver": "1.1.50",
  "importer": "prefab",
  "imported": true,
  "uuid": "f3bd038c-fb1d-4abc-9a13-dcbbb422458c",
  "files": [".json"],
  "subMetas": {},
  "userData": {
    "syncNodeName": "HomeUI"
  }
}
```

### 说明

| 字段 | 含义 |
|---|---|
| `uuid` | 该 prefab 的资产 UUID，其他 prefab 用 `__uuid__` 引用它时用此值 |
| `importer` | 固定 `"prefab"` |
| `ver` | 导入器版本，不要手改 |
| `subMetas` | prefab 没有子资产，永远是 `{}` |
| `userData.syncNodeName` | 编辑器同步节点名，改 prefab 根节点名后需同步更新 |

### 什么时候需要改 meta

通常**不需要动 meta**。以下是例外情况：

- 新建 prefab 文件（需要同时创建 .meta，uuid 必须唯一，否则编辑器报冲突）。
- 改了 prefab 根节点的 `_name`（`userData.syncNodeName` 跟着改，否则编辑器显示名不对，不影响功能）。
- **绝对不要改 uuid**——其他 prefab 通过 uuid 交叉引用，改了会让所有引用失效。

---

## 8. 写回时的陷阱

### 缩进

本仓库 prefab 统一使用 **2 空格缩进**。写回时：

```javascript
const newRaw = JSON.stringify(arr, null, 2) + '\n';
fs.writeFileSync(path, newRaw, 'utf8');
```

末尾必须有一个换行符（`\n`），否则 git diff 会多出"no newline at end of file"警告，且编辑器可能重新格式化。

### key 顺序

`JSON.stringify` 的 key 顺序是插入顺序。CC3 编辑器在保存时有自己的 key 顺序（如 `_name` 在 `_objFlags` 前，`__editorExtras__` 紧随其后），但**编辑器加载并不依赖 key 顺序**，所以顺序不同不影响运行，但会产生较大 diff 噪声。

如果用工具批量修改后想减少 diff，应在读取时保留原始 key 顺序（不要 `JSON.parse` 再 `JSON.stringify`，而是用精确字符串替换或保留对象引用顺序）。

### 数组空洞

prefab 数组的某些下标可能在构建过程中被"占位后回填"（工具链内部用 `push(null)` 占位，再 `set(idx, obj)` 回填）。写回前必须确认数组中**没有 `null` 元素**（除非是故意的空槽——本仓库中不存在这种情况）。`JSON.stringify` 会将 `null` 序列化为 `null`，编辑器加载时会报引用错误。

### 编码

prefab 文件是 UTF-8，无 BOM。行尾是 LF（`\n`），不是 CRLF。在 Windows 环境写回时要特别注意（git 配置 `core.autocrlf` 可能干扰）。

---

## 9. 安全改 vs 危险改

### 安全改（可直接修改，无连锁影响）

| 改动 | 字段 | 注意 |
|---|---|---|
| 移动节点位置 | `cc.Node._lpos` | 非嵌套节点直接改；嵌套节点改对应 CCPropertyOverrideInfo.value |
| 改节点名称 | `cc.Node._name` | 非嵌套节点直接改；嵌套节点改对应 CCPropertyOverrideInfo |
| 显隐节点 | `cc.Node._active` | 同上 |
| 改文字内容 | `cc.Label._string` 或 `cc.RichText._string` | 直接改或通过 propertyOverride |
| 改颜色 | `cc.Sprite._color` / `cc.Label._color` | 直接改 |
| 改透明度 | `cc.UIOpacity._opacity` | 直接改（如有该组件） |
| 改尺寸 | `cc.UITransform._contentSize` | 注意 Widget 约束可能覆盖 |
| 改字号 | `cc.Label._fontSize` | 直接改 |
| 改进度 | `cc.ProgressBar._progress` | 直接改 |
| 改 SpriteFrame | `cc.Sprite._spriteFrame.__uuid__` | 必须用 `资产uuid@f9941` 格式 |

### 危险改（有连锁影响，必须同时处理多处）

| 改动 | 必须同步处理的地方 | 风险 |
|---|---|---|
| **新增普通节点** | 1. push Node 对象；2. 在父 Node._children 加引用；3. 新节点需要 cc.PrefabInfo（instance:null，asset:0，fileId 唯一）；4. 根节点 PrefabInfo.nestedPrefabInstanceRoots 不变（普通节点不加） | 漏掉任一步编辑器会报错 |
| **删除节点** | 1. 从父 _children 移除引用；2. 递归清理所有子节点及其组件；3. 检查是否有其他组件引用该节点（如 cc.Button._target）| 悬空 __id__ 引用会导致加载崩溃 |
| **新增嵌套 prefab 实例** | 1. stub Node；2. cc.PrefabInfo（含 instance 引用）；3. cc.PrefabInstance；4. cc.TargetInfo；5. 若干 CCPropertyOverrideInfo；6. 父节点 _children；7. 根节点 PrefabInfo.nestedPrefabInstanceRoots 加入该 stub 节点引用 | 漏掉 nestedPrefabInstanceRoots 编辑器不识别为嵌套 prefab |
| **修改嵌套 prefab 属性** | 不改 stub 节点字段，改对应 CCPropertyOverrideInfo.value | 改 stub 节点本身的字段运行时完全无效 |
| **新增组件** | 1. push 组件对象；2. push 对应 cc.CompPrefabInfo（fileId 唯一）；3. 组件对象含 `__prefab: {__id__: CompPrefabInfo下标}`；4. 节点 _components 加引用 | 缺 CompPrefabInfo 编辑器加载报错 |
| **改根节点名** | 同步改 .meta 的 userData.syncNodeName | 功能正常但编辑器显示名混乱 |
| **数组覆写（如 editorPages）** | 先写 `{propertyPath: ['editorPages', 'length'], value: N}` 再逐元素写 `{propertyPath: ['editorPages', '0'], value: {__id__: X}}` | 漏掉 length 覆写 CC3 不会截断原数组 |

---

## 10. 快速定位某节点的操作流程

1. `JSON.parse` 整个 prefab 数组为 `objects[]`。
2. 从 `objects[0]`（cc.Prefab）的 `data.__id__` 取根节点下标（通常是 1）。
3. 递归 `_children` 找目标节点（按 `_name` 或路径匹配）。
4. 判断目标节点的 `_prefab.__id__` 对应的 PrefabInfo：
   - `instance === null` → 普通节点，直接改字段。
   - `instance !== null` → 嵌套 prefab stub，改 `cc.PrefabInstance.propertyOverrides` 里对应的 CCPropertyOverrideInfo.value。
5. 序列化：`JSON.stringify(objects, null, 2) + '\n'`，写回文件。

---

## 附：本仓库 prefab 的两个最反直觉的坑

**坑一：嵌套 prefab 的 stub 节点没有 `_name`、`_lpos` 等字段，直接改无效。**
stub 节点通常只有 `__type__`、`_objFlags`、`_parent`、`_prefab`、`__editorExtras__` 五个字段。所有可见属性（名称、位置、缩放、可见性）全部在 propertyOverrides 里，改 stub 本身什么都不会发生。第一次踩这个坑的人通常会以为"写入成功了但编辑器没变"。

**坑二：`nestedPrefabInstanceRoots` 只在根节点的 PrefabInfo 上，且必须列出所有嵌套 stub 节点。**
这个字段是 CC3 编辑器识别"哪些节点是嵌套 prefab"的总索引。新增嵌套实例时如果忘记把 stub 节点加进这个数组，编辑器会把它当成普通节点处理，保存时会把原来的嵌套引用关系覆盖掉，造成静默数据损坏（没有报错，但再次打开 prefab 时子组件引用丢失）。
