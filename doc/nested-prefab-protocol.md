# CC3 Nested Prefab 组件引用协议

> 针对"主 prefab 里的脚本组件 @property 字段要引用嵌套 prefab（stub 代理）内部节点/组件"这一场景，cc3 有专门的 `cc.TargetOverrideInfo` 协议。本文档给出离线工具直接写 prefab JSON 时必须遵循的格式，附 Cocos 引擎运行时的展开走法与踩过的坑。
>
> 样本来源：`packages/module/game/merge/base/prefab/BottomView.prefab`（27 条 targetOverrides）、tools/step-3-script/bind-prefab-components.ts 的 `resolveLocalIdChain` + `addTargetOverride`。

---

## 1. 问题场景

fgui 转 cc3 后，父 prefab（`BottomView.prefab`）里的 `btnStore` / `content` 节点是**嵌套 prefab 代理**（stub），真正的 `cc.Button` / `cc.Label` 等组件在孙 prefab 里：

```
BottomView.prefab
├── touchArea (普通节点)
├── btnStore [stub, _prefab.instance ≠ null]  → StoreBtn.prefab (内部有 cc.Button)
├── btnHome  [stub]                            → HomeBtn.prefab
└── content  [stub]                            → BottomViewContent.prefab
                                                  ├── txtName   (cc.Label)
                                                  ├── btnSell   (cc.Button)
                                                  └── btnSpeed  [stub]  → GemBtn.prefab (内部 cc.Button，两层 nested)
```

BottomView 根节点挂 BottomView.ts 脚本，声明：

```typescript
@property({ type: cc.Button })  private _btnStore: cc.Button;    // 1 层
@property({ type: cc.Label })   private _txtName:  cc.Label;     // 1 层（在 content stub 内部）
@property({ type: cc.Button })  private _btnSpeed: cc.Button;    // 2 层（content > btnSpeed）
```

cc3 **不允许**在主 prefab JSON 里直接写 `comp._btnStore = { __id__: stubNodeId }`——运行时 stub 展开后，主 prefab 里的 stub 子节点全部被替换为子 prefab 内容，按 `__id__` 引用作废。必须通过 **`cc.TargetOverrideInfo`**，用 fileId 链定位目标。

---

## 2. 协议对象

三个关键 `__type__`：

| 类型 | 位置 | 字段 |
|---|---|---|
| `cc.TargetOverrideInfo` | 宿主 prefab root `cc.PrefabInfo.targetOverrides[]` | `source`、`sourceInfo`、`propertyPath`、`target`、`targetInfo` |
| `cc.TargetInfo` | 被 `targetInfo` 引用 | `localID: string[]` |
| `cc.CompPrefabInfo` | 子 prefab 内每个组件的 `__prefab` 指向 | `fileId: string` |

### 2.1 `cc.TargetOverrideInfo` 字段

- **`source`**: `{ __id__: 主 prefab 里源组件的数组下标 }`，如 `BottomView` 脚本组件本身
- **`sourceInfo`**: 源组件也在 stub 内部时填 `cc.TargetInfo`；源在主 prefab 根组件时填 `null`
- **`propertyPath`**: `[fieldName]`，如 `["_btnStore"]`
- **`target`**: `{ __id__: 主 prefab 里 stub 代理节点的下标 }`
- **`targetInfo`**: `{ __id__: 关联的 cc.TargetInfo 下标 }`

### 2.2 `cc.TargetInfo.localID` — 多层 fileId 链

`localID` 是**字符串数组**，每一段对应 Cocos 运行时展开 stub 后的一层查找 key：

| 层数 | 场景 | localID 元素 |
|---|---|---|
| 1 | stub 展开后根组件匹配 | `[组件 cc.CompPrefabInfo.fileId]`（子 prefab 里该组件的 fileId） |
| 1 | stub 展开后根节点引用 | `[节点 cc.PrefabInfo.fileId]` |
| 2 | stub 里还有孙 stub | `[孙 stub instance.fileId, 孙 prefab 内组件的 CompPrefabInfo.fileId]` |
| N | N-1 层孙代理 | 每过一层 PrefabInstance 边界压一段 fileId |

**每过一层 PrefabInstance 边界取的是 `instance.fileId`**（从 `cc.PrefabInstance.fileId` 读），不是代理节点自身 `PrefabInfo.fileId`，也不是子 prefab root 的 `PrefabInfo.fileId`。

---

## 3. 引擎运行时走法（Cocos 3.8.x）

### 3.1 `generateTargetMap`（为代理节点生成 targetMap）

```js
function generateTargetMap(node, targetMap, isRoot) {
  let curTargetMap = targetMap;
  const prefabInstance = node.prefab?.instance;
  if (!isRoot && prefabInstance) {
    // 过 PrefabInstance 边界 → 新开子 map，key = instance.fileId
    targetMap[prefabInstance.fileId] = {};
    curTargetMap = targetMap[prefabInstance.fileId];
  }
  const prefabInfo = node.prefab;
  if (prefabInfo) curTargetMap[prefabInfo.fileId] = node;
  for (const comp of node.components) {
    if (comp.__prefab) curTargetMap[comp.__prefab.fileId] = comp;
  }
  for (const child of node.children) generateTargetMap(child, curTargetMap, false);
}
```

### 3.2 `getTarget`（按 localID 逐层查）

```js
function getTarget(localID, targetMap) {
  let targetIter = targetMap;
  for (let i = 0; i < localID.length; i++) {
    targetIter = targetIter[localID[i]];
  }
  return targetIter;
}
```

### 3.3 `applyTargetOverrides`

```js
const targetAsNode = targetOverride.target;          // 主 prefab 里 stub 节点
const targetInstance = targetAsNode.prefab.instance; // 该 stub 的 PrefabInstance
const target = getTarget(targetOverride.targetInfo.localID, targetInstance.targetMap);
// targetPropOwner 就是 source（或按 propertyPath 走到最末段的 owner）
targetPropOwner[propertyName] = target;              // 把真正的目标对象挂上去
```

引擎源文件（仅参考）：`/Applications/Cocos/Creator/3.8.5/CocosCreator.app/.../3d/engine/bin/.editor/bundled/index.js` 的 `prefabUtils`（`generateTargetMap` / `applyTargetOverrides` / `expandPrefabInstanceNode`）。

---

## 4. 产出正确格式的最小例子

主 prefab（`BottomView.prefab`）根节点下挂 `BottomView` 脚本，字段 `_btnStore` 要指向 `btnStore` stub 里的 `cc.Button`。

离线写入（简化伪代码，见 `cli/src/api.js` 的 `_execSetComponentRef` 实际实现）：

```js
// 1. 找子 prefab (StoreBtn.prefab) 里 cc.Button 的 __prefab.fileId
const btnFileId = findCompFileId(subPrefabJson, 'cc.Button'); // e.g. 'jJyfx2p9Mlc7QuNfNGOGMg'

// 2. push TargetInfo
const tiIdx = elements.length;
elements.push({ __type__: 'cc.TargetInfo', localID: [btnFileId] });

// 3. push TargetOverrideInfo
const toIdx = elements.length;
elements.push({
  __type__: 'cc.TargetOverrideInfo',
  source:       { __id__: sourceCompIdx },   // BottomView 脚本组件
  sourceInfo:   null,                        // 源在主 prefab 根，不需要 sourceInfo
  propertyPath: ['_btnStore'],
  target:       { __id__: stubNodeIdx },     // 主 prefab 里 btnStore 节点
  targetInfo:   { __id__: tiIdx },
});

// 4. 挂到主 prefab root cc.PrefabInfo.targetOverrides
rootPrefabInfo.targetOverrides = rootPrefabInfo.targetOverrides || [];
rootPrefabInfo.targetOverrides.push({ __id__: toIdx });
```

### 两层 nested 的 localID 示例

BottomView `_btnSpeed` → `content` stub → `btnSpeed`（在 content 子 prefab 里又是 stub）→ GemBtn.prefab.cc.Button：

```json
{
  "__type__": "cc.TargetInfo",
  "localID": [
    "gFhDEJwJ9nzsN6Ckb087BQ",   // content 子 prefab (BottomViewContent) 里 btnSpeed stub 的 PrefabInstance.fileId
    "njVtqkHLesyiqmBwtic1eg"    // GemBtn.prefab 里 cc.Button 的 CompPrefabInfo.fileId
  ]
}
```

`target` 仍指向**主 prefab 里最外层 stub**（`content` 节点）。运行时从 content PrefabInstance 的 targetMap 开始，`targetMap[btnSpeed_instance.fileId][cc.Button_comp.fileId]` → `cc.Button`。

---

## 5. 踩坑

### 5.1 stub 代理节点 `_name` 为 `undefined`，不要按 `_name` 遍历

fgui 转 cc3 的 nested stub 节点 JSON 里没有 `_name` 字段——名字靠 `cc.PrefabInstance.propertyOverrides` 运行时填（`CCPropertyOverrideInfo.propertyPath=['_name']`）。按 `_name` 遍历 `_children` 会对 stub 节点返回 `undefined`，走不下去。

**正确做法**：用 tools 侧 stage 2 产出的 `prefab-node-paths.json` cache（`PrefabBuilder` 按 fgui 原始对象名建的 path → idx 映射）。cli 场景没有该 cache 时，按 "stub 节点 `_prefab.instance` 非空" 识别 stub，然后 `parsePrefab` 加载子 prefab 按需查子结构。

### 5.2 localID 段的取法不一致

- 过 PrefabInstance 边界 → 读 `cc.PrefabInstance.fileId`（不是代理节点 `PrefabInfo.fileId`）
- 到组件 → 读 `cc.CompPrefabInfo.fileId`
- 到节点 → 读 `cc.PrefabInfo.fileId`（即嵌套 prefab 根节点 `_parent === null` 对应 PrefabInfo 的 fileId）

混用会让 `getTarget` 返回 undefined。

**cc.Node 型绑定（localID 取法）**：当 @property 字段声明是 `Node` 而非某个组件时，`localID = [嵌套 prefab 根节点的 cc.PrefabInfo.fileId]`。cli 的 `set-component-ref` 传 `refType: "cc.Node"` 即自动走这条路径（`_getNestedNodeFileId`），加载子 prefab JSON，找 `_parent === null` 的节点，读其 PrefabInfo.fileId。实际案例：`SettingUI._role: Node` → `refNode: {"id": 33}, refType: "cc.Node"`（2026-05-07 验证）。

### 5.3 `sourceInfo` 什么时候必填

`cc.TargetOverrideInfo.source` 如果是主 prefab 根节点上直接挂的组件 → `sourceInfo: null`。

源组件也在某个 stub 内部（典型：脚本组件本身被 mountedComponents 方式挂到 stub 上）→ `sourceInfo` 要填 `cc.TargetInfo`，`localID` 用跟 `targetInfo` 同样规则逐层查到源组件。cli 当前 `_execSetComponentRef` **暂不支持**源在 stub 的场景（抛错提示）。

### 5.4 fgui→cc3 的 "Empty 占位 + 运行时绑定组件"

fgui 里 `@inject(SpineView, "path", { res: xxx })` 这种运行时加载组件的字段，fgui 源文件里用通用 `Empty.xml` 占位。直接转 cc3 nested stub 会让目标节点是 Empty.prefab 代理，里面**没有** sp.Skeleton 组件，bind 挂不上。

tools 侧的修法：`step-2-prefab/src/converter/PrefabBuilder.ts` 检测到 `nodeTypeMap` 要求挂内建组件 + 孙 prefab 是 `Empty` → 退化为 inline 普通节点，sp.Skeleton 直接挂节点。

### 5.5 localID 数组只有 1 段 vs 多段

单层 nested（stub 展开后的根组件匹配）→ 1 段 fileId。多层 nested → N 段。cli 当前 `_resolveLocalIdChain` 实现只支持 1 层；多层由 tools/step-3-script/bind-prefab-components 的 `resolveLocalIdChain` 递归展开（见该文件的 fileId 链构造）。cli 要支持多层场景需要扩展，暂未实现。

---

## 6. 相关工具

| 操作 | 入口 |
|---|---|
| 给 @property 字段挂跨 nested 引用 | `set-component-ref` op（refNode 是 stub 自动走 targetOverrides） |
| 改 stub 内部组件字段（cc.Label._string 等） | `set-nested-component-field` op |
| 批量跨 nested 挂载（数百字段） | tools/step-3-script/bind-prefab-components.ts（stage 3 pipeline） |
| 手工修单个 prefab 快速验证 | `set-component-ref` + dry-run 查 targetOverrides 数组 |

---

## 7. 调试

- 查当前 prefab 的 targetOverrides：`jq '.[1]._prefab | { id: .__id__ }' *.prefab` → 找 PrefabInfo，看 `targetOverrides` 数组长度
- 验 localID 是否正确：在子 prefab JSON 里 grep fileId，确认对应组件 `__type__` 匹配
- Cocos 编辑器看到 "Missing Component" 或字段空 → 多半是 localID 错，或 target 指向的 stub 节点 `_prefab.instance` 为 null（漏写 PrefabInstance）
