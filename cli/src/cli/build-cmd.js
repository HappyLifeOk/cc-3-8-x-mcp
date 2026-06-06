// ============================================================
// cli/build-cmd.js — Cocos CLI 命令行打包（headless，不依赖编辑器/MCP）
//
// 封装 Cocos Creator 的命令行构建：
//   CocosCreator --project <path> --build "configPath=<json>"
//   CocosCreator --project <path> --build "platform=<plat>;debug=<bool>"
//
// 退出码：Cocos 退出非 0 常见于 postBuild 阶段的资源警告等非致命问题（主构建其实成功）。
//   默认照产物存在性判定：产物齐了就退 0（成功），产物缺才透传 Cocos 退出码（失败）。
//   --strict 关掉这个兜底，直接透传 Cocos 退出码。
//
// 用法：
//   cocos-mcp-cli build --project <path> --version 3.8.8 --config <buildConfig.json>
//   cocos-mcp-cli build --project <path> --cocos <CocosCreator可执行> --platform web-mobile
//   cocos-mcp-cli build ... --dry-run     # 只打印命令不真跑
//   cocos-mcp-cli build ... --strict      # 严格透传 Cocos 退出码（不做产物兜底）
// ============================================================

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function die(msg) { process.stderr.write('Error: ' + msg + '\n'); process.exit(1); }

function parseArgs(rest) {
    const a = { project: '', cocos: '', version: '', config: '', platform: '', debug: false, dryRun: false, strict: false };
    for (let i = 0; i < rest.length; i++) {
        const k = rest[i];
        if (k === '--project' || k === '-p') a.project = rest[++i];
        else if (k === '--cocos' || k === '-c') a.cocos = rest[++i];
        else if (k === '--version' || k === '-v') a.version = rest[++i];
        else if (k === '--config') a.config = rest[++i];
        else if (k === '--platform') a.platform = rest[++i];
        else if (k === '--debug') a.debug = true;
        else if (k === '--dry-run') a.dryRun = true;
        else if (k === '--strict') a.strict = true;
        else die(`未知参数 "${k}"。用法见 cocos-mcp-cli build --help`);
    }
    return a;
}

// 解析 CocosCreator 可执行：--cocos 显式优先，否则 --version 拼标准安装路径（macOS）
function resolveCocos(a) {
    if (a.cocos) {
        if (!fs.existsSync(a.cocos)) die(`--cocos 路径不存在: ${a.cocos}`);
        return a.cocos;
    }
    if (a.version) {
        const p = `/Applications/Cocos/Creator/${a.version}/CocosCreator.app/Contents/MacOS/CocosCreator`;
        if (!fs.existsSync(p)) die(`版本 ${a.version} 不在标准路径: ${p}\n  用 --cocos <可执行绝对路径> 显式指定`);
        return p;
    }
    die('需指定 CocosCreator 可执行：--cocos <path> 或 --version <如 3.8.8>');
}

// 退出非 0 时按产物存在性判定主构建是否成功。true=产物齐 / false=产物缺 / null=无法定位产物目录
function checkArtifact(a) {
    let outDir;
    if (a.platform) {
        // outputName 默认等于 platform；非默认场景请用 --config
        outDir = path.join(a.project, 'build', a.platform);
    } else if (a.config) {
        try {
            const cfg = JSON.parse(fs.readFileSync(a.config, 'utf8'));
            const bp = String(cfg.buildPath || 'project://build').replace(/^project:\/\//, a.project + path.sep);
            const on = cfg.outputName || cfg.platform || '';
            outDir = path.join(bp, on);
        } catch (e) { return null; }
    }
    if (!outDir || !fs.existsSync(outDir)) return false;
    // 关键产物标志：index.html(web) / game.json(小游戏) / application.js
    return ['index.html', 'game.json', 'application.js'].some(function (m) { return fs.existsSync(path.join(outDir, m)); });
}

function cmdBuild(rest) {
    if (rest[0] === '--help' || rest[0] === '-h') {
        process.stdout.write(
            'cocos-mcp-cli build — Cocos 命令行打包（headless）\n\n' +
            '  --project, -p <path>   项目根目录（必填）\n' +
            '  --version, -v <ver>    Cocos 版本（拼标准安装路径，如 3.8.8）\n' +
            '  --cocos,   -c <path>   或直接给 CocosCreator 可执行绝对路径（优先于 --version）\n' +
            '  --config <json>        构建配置文件（→ --build "configPath=<json>"）\n' +
            '  --platform <plat>      或按平台构建（→ --build "platform=<plat>"），如 web-mobile / alipay-mini-game\n' +
            '  --debug                平台构建时 debug=true（默认 false）\n' +
            '  --dry-run              只打印将执行的命令，不真跑\n' +
            '  --strict               严格透传 Cocos 退出码（默认会按产物存在性兜底，把 postBuild 非致命的非 0 当成功）\n\n' +
            '示例:\n' +
            '  cocos-mcp-cli build -p /path/to/forest -v 3.8.8 --config /path/build.json\n' +
            '  cocos-mcp-cli build -p /path/to/forest -v 3.8.8 --platform web-mobile --dry-run\n');
        return;
    }

    const a = parseArgs(rest);
    if (!a.project) die('缺 --project <项目路径>');
    if (!fs.existsSync(a.project)) die(`项目路径不存在: ${a.project}`);
    if (!a.config && !a.platform) die('需指定构建配置：--config <buildConfig.json> 或 --platform <平台>');

    const cocos = resolveCocos(a);

    let buildArg;
    if (a.config) {
        if (!fs.existsSync(a.config)) die(`--config 文件不存在: ${a.config}`);
        buildArg = `configPath=${a.config}`;
    } else {
        buildArg = `platform=${a.platform};debug=${a.debug ? 'true' : 'false'}`;
    }

    const argv = ['--project', a.project, '--build', buildArg];

    if (a.dryRun) {
        process.stdout.write('[dry-run] 将执行:\n  ' + cocos + ' --project ' + a.project + ' --build "' + buildArg + '"\n');
        return;
    }

    process.stdout.write('Cocos CLI build 启动（headless，可能耗时几分钟）:\n  --project ' + a.project + '\n  --build "' + buildArg + '"\n\n');
    const child = spawn(cocos, argv, { stdio: 'inherit' });
    child.on('error', function (e) { die('启动 Cocos 失败: ' + e.message); });
    child.on('exit', function (code) {
        if (code === 0) {
            process.stdout.write('\nCocos 退出码: 0 — 构建成功\n');
            process.exit(0);
        }
        const arti = a.strict ? null : checkArtifact(a);
        if (arti === true) {
            process.stdout.write('\nCocos 退出码: ' + code + '（非 0），但产物已生成 → 判定主构建成功（非 0 多为 postBuild 资源警告等非致命问题）。\n');
            process.exit(0);
        }
        if (arti === false) {
            process.stdout.write('\nCocos 退出码: ' + code + '，产物未生成 → 构建失败。\n');
            process.exit(code == null ? 1 : code);
        }
        // null：--strict 或无法定位产物目录（如 --config 解析失败）→ 透传
        process.stdout.write('\nCocos 退出码: ' + (code == null ? '(被信号终止)' : code) +
            (a.strict ? '（--strict，透传）' : '（无法定位产物目录，透传）') + '\n');
        process.exit(code == null ? 1 : code);
    });
}

module.exports = { cmdBuild };
