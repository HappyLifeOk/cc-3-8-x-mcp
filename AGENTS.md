# AGENTS.md

本文是 `cc-3-8-x-mcp` 的 agent 使用规则。只写插件级规则；项目自己的预览参数、业务本地服地址、测试账号和验证步骤写在项目文档里。

## 允许入口

使用本插件时，只允许从下面这些入口进入：

| 入口 | 用途 |
|---|---|
| 当前项目 MCP 实例 | `scene` / `asset-db` / `preview` / `local` 域操作 |
| 当前项目 HTTP MCP endpoint | 当前 agent 没注入 MCP tool 时的等价入口 |
| `cocos-mcp-cli` offline 命令 | `.prefab` / `.anim` 文件查询和修改 |
| Playwright / Chrome | 浏览器里真实游戏页面的交互验证 |
| `.dev/refresh` 的 `restart-package` | 重启本扩展代码 |

其它入口不作为本插件使用路径。项目文档可以补充项目自己的只读兜底信息，但不能覆盖本文件的入口规则。

## 绑定当前项目 MCP

同机可能同时打开多个 Cocos 项目。agent 必须先按项目根目录绑定 MCP 实例，再执行后续操作。

实例注册文件：

```text
~/.cocos-mcp/editors/*.json
```

绑定规则：

1. 扫描 `~/.cocos-mcp/editors/*.json`。
2. 只保留 `projectPath` 与当前项目根目录一致的记录。
3. 校验 `pid` 仍存活。
4. 多个匹配时取 `updatedAt` 最新的记录。
5. 后续所有 HTTP MCP 请求都使用该记录的 `url`。

快速确认脚本：

```bash
python3 - <<'PY'
import glob
import json
import os
from pathlib import Path

def find_project_root(start):
    cur = Path(start).resolve()
    for item in [cur, *cur.parents]:
        if (item / 'assets').is_dir() and (item / 'settings').is_dir() and (item / 'extensions').is_dir():
            return str(item)
    return str(cur)

PROJECT = os.environ.get('PROJECT_ROOT') or find_project_root(os.getcwd())
items = []

for path in glob.glob(os.path.expanduser('~/.cocos-mcp/editors/*.json')):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if os.path.realpath(data.get('projectPath', '')) != os.path.realpath(PROJECT):
            continue
        os.kill(int(data['pid']), 0)
        items.append((data.get('updatedAt', ''), path, data))
    except Exception:
        pass

for _, path, data in sorted(items)[-3:]:
    print(path, data.get('url'), data.get('previewUrl') or '')
PY
```

## Tool 与 HTTP MCP

如果当前 agent 已注入 router 暴露的 MCP tool，使用带项目名前缀的 tool：

```text
forest__preview_query_url
forest__asset_reimport
forest__preview_refresh_and_reload
```

如果当前 agent 没注入这些 tool，按上节解析当前项目 MCP，再直接调用 HTTP endpoint。

HTTP 调用格式：

```bash
curl -sS -X POST http://127.0.0.1:<mcp-port>/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"preview_query_url","arguments":{}}}'
```

## 预览 URL

预览 URL 只允许来自：

| 来源 | 说明 |
|---|---|
| `preview_query_url` | 首选 |
| `local_get_status` | 查预览端口、MCP endpoint、编辑器状态 |
| 项目文档明确声明的只读兜底文件 | 仅在 MCP 不通时使用 |

没有项目文档声明时，不读取旧 `.dev/preview-url`，不猜 `localhost:7456`。

浏览器验证必须在 MCP 返回的 URL 上追加唯一 `tid`：

```text
<preview_url>/?tid=<unique-id>
```

已有 query 时用 `&tid=`。本地服务器、测试账号、业务参数由项目文档声明。

## 资源修改后刷新

offline CLI 直接写磁盘，Cocos 编辑器不会自动感知。改完 `.prefab` / `.anim` / `.json` 等资源后，使用当前项目 MCP 刷新：

| 修改范围 | 后续动作 |
|---|---|
| 单个资源 | `asset_reimport` 指定 `db://` 路径 |
| 多个资源或不确定依赖 | `asset_refresh` 后 `preview_refresh_and_reload` |
| 扩展代码 | `.dev/refresh` 写 `restart-package` |

`.dev/refresh` 只承载 `restart-package`。

## CLI 与 MCP 分工

| 操作 | 推荐入口 |
|---|---|
| 查 prefab 节点树 / 组件字段 | `prefab_query` 或 `cocos-mcp-cli query` |
| 批量改 prefab | `prefab_edit` / `prefab_batch` 或 `cocos-mcp-cli batch` |
| 改 `.anim` 结构 | `cocos-mcp-cli anim` |
| 查 AssetDB 资源信息 | `asset_query_assets` / `asset_query_info` |
| 重导资源 | `asset_reimport` |
| 查场景运行态节点 | `scene_query_node_tree` / `scene_query_node` |
| 调组件方法或改运行态属性 | `scene_execute_component_method` / `scene_set_property` |
| 拿预览 URL | `preview_query_url` |
| 刷新预览 | `preview_refresh_and_reload` |

结构化资源文件优先走 CLI 或 MCP tool。纯文本说明文档才直接编辑。

## 浏览器验证

MCP 负责拿 URL、重导资源、刷新预览；浏览器里真实业务页面的交互验证交给 Playwright / Chrome。

推荐流程：

```text
preview_query_url
browser_navigate -> <preview_url>/?tid=<unique-id>
browser_evaluate
browser_take_screenshot
```

## 失败处理

按顺序排查：

1. 没有匹配 `projectPath` 的注册文件：确认 Cocos 编辑器已打开当前项目，并且扩展已启用。
2. `pid` 不存活：忽略该注册文件，等编辑器重新注册。
3. HTTP MCP endpoint 不通：用 `.dev/refresh` 的 `restart-package` 重启扩展；仍不通就重启编辑器。
4. MCP 返回的预览 URL 为空：确认编辑器预览已启动。
5. 工具行为异常或文档与实际不一致：反馈插件问题，由用户决定是否修插件本身。
