// cli/help.js — 帮助信息

'use strict';

function printHelp() {
  process.stdout.write(`cocos-mcp-cli — CC3 prefab 离线编辑工具

Usage:
  cocos-mcp-cli query <prefab> [--selector tree|node|find|field] [--name X] [--type cc.Label]
                                [--comp cc.UITransform] [--field _anchorPoint] [--with-comps]
  cocos-mcp-cli set   <prefab> <nodeName> <field> <value>
  cocos-mcp-cli batch <prefab> <ops.json> [--project-root <projectRoot>] [--dry-run]
  cocos-mcp-cli batch <ops.json>  --glob <pattern> [--project-root <path>] [--dry-run]
  cocos-mcp-cli anim  <subcommand> <file> [args]    # subcommand: query | batch
  cocos-mcp-cli diff  <prefabA> <prefabB>            # 字段级 diff
  cocos-mcp-cli create-prefab <out> [--name X] [--width W] [--height H] [--add-spine <uuid>]
  cocos-mcp-cli extract-prefab <src> <out> --node <selector> [--name X] [--dry-run]
  cocos-mcp-cli open <project> --version 3.8.8
  cocos-mcp-cli open --project <project> --cocos <CocosCreator executable>

Commands:
  query           只读查询，输出 JSON
  set             单条属性写入（field: active / label.text / position.x|y|z）
  batch           批量写入，ops.json 是 editPrefab ops 数组；--glob 跨多个 prefab
  anim            操作 .anim 文件（与 prefab 同格式）
  diff            比较两个 prefab 的字段级差异
  create-prefab   创建空白 prefab（root + UITransform，可选 sp.Skeleton）
  extract-prefab  把 src 中的某个子节点闭包提取为独立 prefab（含组件 / PrefabInfo /
                  嵌套 PrefabInstance / overrides 的全部 __id__ 引用）

Query options:
  --selector tree   节点树（默认）
  --selector node   单节点详情，需要 --name <节点名>
  --selector find   按 __type__ 列 id，需要 --type <类型>
  --selector field  单组件单字段值，需要 --name --comp --field
  --with-comps      tree/node 下展开组件字段（输出 components: [{type,id,fields}]）

Batch options:
  --project-root <path>  指定含 assets/+package.json 的项目根；
                         当 prefab 放在 /tmp/ 等非项目目录时必须显式传入，
                         否则 className → classId 自动规范化会抛错（避免写入 className 字符串导致 cocos MissingScript）。
  --dry-run              不写盘，输出会改的字段 diff（{ path: [old, new] } 形式）。

Supported ops:
  set-position / set-label-text / set-sprite-frame / set-active / rename-node
  set-component-field                       # 普通节点改任意组件任意字段，property 接字符串或嵌套路径数组
  set-component-enabled                     # 改 _enabled
  set-anchor / set-size                     # cc.UITransform 锚点 / 尺寸便捷写法
                                             # set-anchor 支持 compensatePosition 自动补偿 lpos
  adjust-position                           # lpos 相对偏移
  reorder-children                          # 调子节点顺序（影响渲染层级）
  bulk-set                                  # 按 selector（byComponent/byNamePrefix/byNameRegex）一次改一批
  add-node / remove-node / clone-node
  add-spine-socket                        # 给 sp.Skeleton 增加/更新 socket 绑定
  add-component / set-component-ref         # componentType 支持 @ccclass 名或压缩 classId
                                             # set-component-ref 的 refSubNode 可用字符串数组走多层嵌套 stub
  set-nested-component-field                # 仅 stub 节点（嵌套 prefab）改组件字段
  dedupe-component                          # 合并同节点重复组件
  ensure-meta                               # 给新建 .ts/.json 创建 .meta（v4 uuid），
                                             # 避免等 cocos 编辑器生成；放在 add-component 前即可
                                             # 联动（同 batch 内 cache invalidate 重扫）

Component shortcuts（组件快捷 op，多字段一次设置）:
  set-editbox   node + inputMode?/maxLength?/placeholder?/string?/inputFlag?/fontSize?
                  inputMode: 0=ANY 1=EMAIL 2=NUMERIC 3=PHONE 4=URL 5=DECIMAL 6=SINGLE_LINE
  set-label     node + text?/fontSize?/lineHeight?/overflow?/horizontalAlign?/verticalAlign?/bold?/italic?/underline?/enableWrapText?
                  overflow: 0=NONE 1=CLAMP 2=SHRINK 3=RESIZE_HEIGHT 4=TRUNCATE
  set-button    node + interactable?/transition?/zoomScale?/duration?
                  transition: 0=NONE 1=COLOR 2=SPRITE 3=SCALE
  set-layout    node + type?/resizeMode?/paddingLeft?/paddingRight?/paddingTop?/paddingBottom?/spacingX?/spacingY?/startAxis?/constraint?/constraintNum?/affectedByScale?
                  type: 0=NONE 1=HORIZONTAL 2=VERTICAL 3=GRID
  set-richtext  node + text?/maxWidth?/fontSize?/lineHeight?
  set-sprite    node + sizeMode?/type?/grayscale?/trim?（换图用 set-sprite-frame）
                  type: 0=SIMPLE 1=SLICED 2=TILED 3=FILLED 4=MESH
  set-node-color node + r?/g?/b?/a?（0-255）

节点定位三种形式（适用所有 op 的 node/parent/target/source/refNode）：
  "name"  /  { id: N }  /  { path: "Canvas/Main/itemList" }

Examples:
  cocos-mcp-cli query HomeUI.prefab --selector tree --with-comps
  cocos-mcp-cli query HomeUI.prefab --selector field --name itemList \\
                --comp cc.UITransform --field _anchorPoint
  cocos-mcp-cli set   HomeUI.prefab btnClose label.text "关闭"
  cocos-mcp-cli batch HomeUI.prefab ops.json
  cocos-mcp-cli batch HomeUI.prefab ops.json --dry-run
`);
}

module.exports = { printHelp };
