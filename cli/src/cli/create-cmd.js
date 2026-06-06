// ============================================================
// cli/create-cmd.js — create-prefab 子命令
//
// 用法：
//   cocos-mcp-cli create-prefab <output-path>
//     [--name <name>] [--width <w>] [--height <h>]
//     [--add-spine <skel-uuid>] [--dry-run]
//
// 生成最小 prefab（root 节点 + UITransform）+ 配套 .prefab.meta。
//
// 加 --add-spine <uuid> 时，在 root 节点上多挂一个 sp.Skeleton 组件，
// _skeletonData.__uuid__ 指向给定的 .skel 资产 UUID。批量生成 spine prefab
// 推荐外层 shell 循环 + N 次调用：
//
//   for meta in assets/res/<group>/<xxxN>/*.skel.meta; do
//     name=$(basename "$meta" .skel.meta)
//     uuid=$(node -e 'console.log(require("./"+process.argv[1]).uuid)' "$meta")
//     node bin/cocos-mcp-cli.js create-prefab \
//       "assets/packages/<group>/<xxxN>/prefab/${name}.prefab" --add-spine "$uuid"
//   done
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { deterministicUUID, deterministicFileId } = require('../id.js');
const {
  makePrefabRoot,
  makeNode,
  makeUITransform,
  makePrefabInfo,
  makeCompPrefabInfo,
  makeSpSkeleton,
} = require('../primitives.js');

function die(msg) {
  process.stderr.write('Error: ' + msg + '\n');
  process.exit(1);
}

function cmdCreatePrefab(argv) {
  let outputPath = null;
  let name = null;
  let width = null;
  let height = null;
  let dryRun = false;
  let spineSkelUuid = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name') {
      name = argv[++i];
      if (!name) die('--name 需要一个值');
    } else if (arg === '--width') {
      width = Number(argv[++i]);
      if (isNaN(width)) die('--width 必须是数字');
    } else if (arg === '--height') {
      height = Number(argv[++i]);
      if (isNaN(height)) die('--height 必须是数字');
    } else if (arg === '--add-spine') {
      spineSkelUuid = argv[++i];
      if (!spineSkelUuid) die('--add-spine 需要一个 .skel 资产 UUID');
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (!arg.startsWith('--')) {
      if (outputPath !== null) die('多余的位置参数: ' + arg);
      outputPath = arg;
    } else {
      die(`未知参数 "${arg}"`);
    }
  }

  if (!outputPath) {
    die('用法: create-prefab <output-path> [--name <name>] [--width <w>] [--height <h>] [--add-spine <skel-uuid>] [--dry-run]');
  }

  // 确保 .prefab 后缀
  if (!outputPath.endsWith('.prefab')) outputPath += '.prefab';

  // 推断 prefab 名称（basename 去掉 .prefab）
  if (!name) name = path.basename(outputPath, '.prefab');

  // 默认 UITransform 尺寸：spine prefab 走 100×100（sp.Skeleton 自己控制渲染，
  // contentSize 不影响运行时；与现有 sk_loading.prefab 等产物对齐），
  // 普通 UI prefab 走 750×200
  if (width === null) width = spineSkelUuid ? 100 : 750;
  if (height === null) height = spineSkelUuid ? 100 : 200;

  // 确定性 ID（以名称为种子，保证同名 prefab 每次生成相同 UUID）
  const seed = `create-prefab:${name}`;
  const prefabUuid = deterministicUUID(`${seed}:uuid`);
  const rootFileId = deterministicFileId(`${seed}:root:fid`);
  const uitransformFileId = deterministicFileId(`${seed}:uitransform:fid`);

  // 索引分配 — 不带 spine（5 条）：
  //   0  cc.Prefab
  //   1  cc.Node (root)
  //   2  cc.UITransform
  //   3  cc.CompPrefabInfo (UITransform 的)
  //   4  cc.PrefabInfo     (root 的)
  // 带 spine（7 条）：
  //   0  cc.Prefab
  //   1  cc.Node (root, _components: [2, 4])
  //   2  cc.UITransform
  //   3  cc.CompPrefabInfo (UITransform 的)
  //   4  sp.Skeleton
  //   5  cc.CompPrefabInfo (sp.Skeleton 的)
  //   6  cc.PrefabInfo     (root 的)
  let data;
  if (spineSkelUuid) {
    const spineFileId = deterministicFileId(`${seed}:sp.Skeleton:fid`);
    data = [
      makePrefabRoot({ name, rootId: 1 }),
      makeNode({ name, componentIds: [2, 4], prefabId: 6 }),
      makeUITransform({ nodeId: 1, width, height, prefabInfoId: 3 }),
      makeCompPrefabInfo(uitransformFileId),
      makeSpSkeleton({ nodeId: 1, skeletonUuid: spineSkelUuid, prefabInfoId: 5 }),
      makeCompPrefabInfo(spineFileId),
      makePrefabInfo({ rootId: 1, fileId: rootFileId, assetId: 0 }),
    ];
  } else {
    data = [
      makePrefabRoot({ name, rootId: 1 }),
      makeNode({ name, componentIds: [2], prefabId: 4 }),
      makeUITransform({ nodeId: 1, width, height, prefabInfoId: 3 }),
      makeCompPrefabInfo(uitransformFileId),
      makePrefabInfo({ rootId: 1, fileId: rootFileId, assetId: 0 }),
    ];
  }

  const meta = {
    ver: '1.1.50',
    importer: 'prefab',
    imported: true,
    uuid: prefabUuid,
    files: ['.json'],
    subMetas: {},
    userData: { syncNodeName: name },
  };

  if (dryRun) {
    process.stdout.write('=== PREFAB ===\n');
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    process.stdout.write('\n=== META ===\n');
    process.stdout.write(JSON.stringify(meta, null, 2) + '\n');
    return;
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.writeFileSync(outputPath + '.meta', JSON.stringify(meta, null, 2) + '\n', 'utf8');

  process.stdout.write(`created: ${outputPath}\n`);
  process.stdout.write(`created: ${outputPath}.meta\n`);
}

module.exports = { cmdCreatePrefab };
