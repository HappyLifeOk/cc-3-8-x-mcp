# cc-3-8-x-mcp

Cocos Creator 3.8.x 的 MCP 桥接扩展 + 离线 prefab 读写 CLI。

把编辑器的 scene/asset/preview/local 能力以 MCP 协议暴露给 Claude Code；同时提供无需编辑器运行的 offline prefab 编辑能力，支持节点增删克隆与 stub 节点属性覆写。

---

## 文档导航

| 文档 | 内容 | 阅读时机 |
|---|---|---|
| [`QUICK-REF.md`](./QUICK-REF.md) | **一页速查表**：节点定位三式、场景 → op 对照、ops.json 速记、踩坑表 | agent 起手第一份，挑不到再翻 cli.md |
| [`doc/cli.md`](./doc/cli.md) | **CLI 完整手册**：命令、26 个 op 全表、配方、已知坑、源码导航 | 改 `.prefab` / `.anim` 文件前必读 |
| [`doc/prefab-schema.md`](./doc/prefab-schema.md) | CC3 prefab JSON 结构速查（节点 / 组件 / 引用字段格式） | 看不懂 prefab 字段时查 |
| [`doc/nested-prefab-protocol.md`](./doc/nested-prefab-protocol.md) | `cc.TargetOverrideInfo` 协议（跨 nested @property 挂载） | 调试 set-component-ref 跨 stub 失败时 |
| [`doc/prefab-direct-edit.md`](./doc/prefab-direct-edit.md) | offline CLI vs 编辑器路径决策表 | 不确定该用 CLI 还是 scene_set_property 时 |
| [`doc/anim-schema.md`](./doc/anim-schema.md) | `.anim` 文件结构 + Track 字段规范 | 改动画文件结构时 |

---

## 架构

```
Claude Code (MCP client)
        │  stdio (JSON-RPC)
        ▼
┌─────────────────────────────┐
│  router/bin.js              │  ← 统一入口，聚合多个编辑器
│  - 扫 ~/.cocos-mcp/editors/ │
│  - offline prefab tools     │
└───────────┬─────────────────┘
            │  HTTP MCP (JSON-RPC)
    ┌───────┴────────┐
    │                │
    ▼                ▼
编辑器实例 A      编辑器实例 B       ← 每个项目一个编辑器进程
server/mcp-server.js              ← 在 Cocos 编辑器进程内跑 HTTP MCP server
```

offline prefab tools（`prefab_query` / `prefab_edit` / `prefab_batch`）在 router 进程内直接执行，调用 `cli/src/index.js`，不需要编辑器运行。

---

## 三个组件

### 1. 编辑器扩展（`main.js` + panel + server）

在 Cocos Creator 编辑器进程内运行。启动时拉起 `server/mcp-server.js`（HTTP MCP server），并把自身信息写入 `~/.cocos-mcp/editors/<pid>.json`（心跳注册）。

**暴露的 tool 域**：

| 域 | 职责 |
|---|---|
| scene | 查询/修改节点树，打开/保存/重载场景，调用组件方法 |
| asset-db | 资源查询、导入、创建、保存、删除、移动 |
| preview | 预览地址查询、浏览器控制、截图、JS 注入 |
| local | 本地状态、worktree 列表、.dev 目录管理 |

### 2. stdio router（`router/`）

入口：`router/bin.js`

**职责**：

- 扫描 `~/.cocos-mcp/editors/` 发现活跃编辑器（心跳超 120s 视为已死）
- 每隔 15s 自动发现新实例
- 给每个编辑器的 tool 加 `<shortName>__` 前缀，合并后暴露给 Claude Code
- 内置 offline prefab tools（`prefab_query` / `prefab_edit` / `prefab_batch`），不带前缀，全局可用

**tool 路由示例**：

```
forest__scene_query_node_tree  →  forest 编辑器的 HTTP MCP server
another__asset_query_assets    →  another 编辑器的 HTTP MCP server
prefab_query                   →  router 本地执行（cli），无需编辑器
```

### 3. cocos-mcp-cli（`cli/`）

零依赖 Node CLI，直接读写 `.prefab` 文件，无需 Cocos 编辑器运行。详见 [`doc/cli.md`](./doc/cli.md)。

---

## 功能面板

通过菜单「扩展 → Cocos MCP → 功能面板」打开，或在编辑器扩展面板停靠。

| 区块 | 内容 |
|---|---|
| MCP Server | 运行状态指示灯 / 端点地址 / tool 数量 / 请求计数；复制端点、复制 CLI 命令、重启 |
| 编辑器状态 | 当前分支 / HEAD / 预览地址和端口 / 编辑器 PID / Watcher 状态 / 最后更新时间 |
| 快捷动作 | 一键刷新（资源+场景+预览）/ 软重载场景 / 打开预览浏览器 / 截图 / 打开 .dev 目录 / 清理临时文件 / 手动输入路径重新导入 |
| Debug 注入 | 在预览页面执行任意 JS（`eval_js`），结果直接展示；自定义快捷按钮（配置见下方） |
| 同机 Worktree | 列出同机其他 worktree 及其预览端口，方便多开切换 |
| 命令日志 | 最近 30 条操作记录（时间 / 来源 / 命令） |

**自定义 Debug 按钮**：在项目根目录新建 `.dev/cc-mcp-panel.json`：

```json
{ "buttons": [{ "label": "解锁签到", "code": "app.userMod.setUserValue(0,1)" }] }
```

---

## Tools 清单

### scene 域（需编辑器运行）

| Tool | 说明 |
|---|---|
| `scene_query_node_tree` | 查询当前场景节点树；传 uuid 查子树 |
| `scene_query_node` | 查询单节点完整 dump（含所有组件属性） |
| `scene_set_property` | 设置节点/组件属性（path 为 dump path，如 `position`、`__comps__.0.string`） |
| `scene_open_scene` | 打开场景（传场景资源 uuid） |
| `scene_save_scene` | 保存当前场景 |
| `scene_soft_reload` | 软重载场景，不清编辑器状态 |
| `scene_execute_component_method` | 调用指定节点的组件方法 |

> 修改 prefab 资源文件属性建议用 `prefab_edit`（offline），`scene_set_property` 只适用于运行时节点或需要编辑器上下文的情况。

### asset-db 域（需编辑器运行）

| Tool | 说明 |
|---|---|
| `asset_query_assets` | 按 glob pattern 列资源（如 `db://assets/**/*.prefab`） |
| `asset_query_info` | 查资源详情（传 uuid 或 url） |
| `asset_query_url` | 由 uuid 查资源 url |
| `asset_query_uuid` | 由 url 查资源 uuid |
| `asset_refresh` | 刷新资源（全量或指定路径） |
| `asset_reimport` | 重新导入指定资源 |
| `asset_create` | 创建新资源 |
| `asset_save` | 保存资源内容 |
| `asset_delete` | 删除资源 |
| `asset_move` | 移动/重命名资源 |

### preview 域（需编辑器运行）

| Tool | 说明 |
|---|---|
| `preview_query_url` | 查询当前预览 URL |
| `preview_open_browser` | 在系统浏览器打开预览 |
| `preview_refresh_browser` | 刷新预览页面 |
| `preview_screenshot` | 截图，返回图片路径 |
| `preview_eval_js` | 在预览页面执行 JS，返回执行结果 |
| `preview_refresh_and_reload` | 重新导入资源后刷新预览（offline 改完必须调此工具才能看到效果） |

### local 域（需编辑器运行）

| Tool | 说明 |
|---|---|
| `local_get_status` | 获取编辑器本地状态（git branch、预览端口、PID 等） |
| `local_list_worktrees` | 列出同机所有 worktree |
| `local_open_dev_dir` | 在 Finder 中打开 .dev 目录 |
| `local_clean_dev_dir` | 清理 .dev 临时文件 |

### offline 域（router 级，无需编辑器运行）

| Tool | 说明 |
|---|---|
| `prefab_query` | 查询 prefab 节点树或单节点详情 |
| `prefab_edit` | 声明式批量编辑 prefab，所有 op 成功后一次性落盘 |
| `prefab_batch` | 从 JSON 文件读取 ops 后批量编辑 prefab |

完整 op 列表与配方见 [`doc/cli.md`](./doc/cli.md)。

> offline tools 的 `filePath` 和 `opsJsonPath` 必须为绝对路径；router 以 stdio 模式运行，cwd 不确定，相对路径有歧义。

---

## 多开支持

每个 Cocos 编辑器实例启动时向 `~/.cocos-mcp/editors/<pid>.json` 写入注册信息：

```json
{
  "pid": 12345,
  "url": "http://127.0.0.1:7788/mcp",
  "shortName": "forest",
  "projectPath": "/path/to/project"
}
```

router 定期扫此目录，心跳超过 120s 的记录视为死亡自动剔除。tool 名以 `<shortName>__` 为前缀隔离，同机多开不冲突。

---

## 接入 Claude Code

```bash
claude mcp add cocos -- node /path/to/forest/extensions/cc-3-8-x-mcp/router/bin.js
```

接入后 Claude Code 即可调用所有活跃编辑器的 tool，以及全局 offline prefab tools。

---

## `.dev/refresh` 信号协议

外部往 `<project>/.dev/refresh` 文件写一行命令，编辑器扩展的 watcher 读到后执行并清空文件。fire-and-forget，无返回值。

协议精简：**只支持 `restart-package`**——禁用→启用本扩展，让 `main.js` / `tools.js` / `server/*` 的代码改动生效。资源刷新 / 场景重载 / 预览刷新 / 截图等都走 MCP tool（`preview_refresh_and_reload` / `asset_reimport` / `preview_screenshot` 等）或面板按钮。

```bash
echo "restart-package" > .dev/refresh
```

面板上的「重启 MCP Server」按钮只重启 HTTP server 实例，Node require 缓存不动，**改不到 main.js 的代码改动**。`restart-package` 走 `Editor.Package.disable + enable`，整个扩展沙箱重建，所有 JS 重新 require。注意命令是 fire-and-forget，不返回结果；扩展重启过程中 MCP 连接会短暂中断（≈1-2s），重连由 router 自动发现完成。

---

## 已知限制

1. **stub 节点的组件字段**：`set-label-text` / `set-sprite-frame` / `set-nested-component-field` 已通过 `uuid-resolver.js` 解析 `CompPrefabInfo.fileId` 写入 stub 节点的 override
2. **多层嵌套 stub**：CLI 已通过 `refSubNode` 字符串数组路径支持。极端深嵌套场景仍建议走 tools pipeline（`tools/step-3-script/bind-prefab-components.ts`）
3. **offline 改完后需手动触发刷新**：直接写磁盘 Cocos 编辑器不会自动感知。改完后调用 `asset_reimport`（编辑器在线时）或 `preview_refresh_and_reload`，否则编辑器和预览页面看到的仍是旧内容

---

## 反馈

使用本扩展（MCP tool / offline CLI）时遇到 bug、行为异常或文档与实际不符，agent 必须把问题反馈给用户，由用户决定是否修复扩展本身，不要在调用方加 workaround 绕过。
