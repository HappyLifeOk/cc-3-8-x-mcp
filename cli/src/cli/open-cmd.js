'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveCocosExec } = require('./cocos-path.js');

function die(msg) {
    process.stderr.write('Error: ' + msg + '\n');
    process.exit(1);
}

function parseArgs(rest) {
    const a = { project: '', cocos: '', version: '', dryRun: false, wait: false, noLogin: true };
    for (let i = 0; i < rest.length; i++) {
        const k = rest[i];
        if (k === '--project' || k === '-p') a.project = rest[++i];
        else if (k === '--cocos' || k === '-c') a.cocos = rest[++i];
        else if (k === '--version' || k === '-v') a.version = rest[++i];
        else if (k === '--dry-run') a.dryRun = true;
        else if (k === '--wait') a.wait = true;
        else if (k === '--no-login' || k === '--nologin') a.noLogin = true;
        else if (k === '--with-login') a.noLogin = false;
        else if (!a.project && k[0] !== '-') a.project = k;
        else die('unknown argument "' + k + '". See cocos-mcp-cli open --help');
    }
    return a;
}

function buildOpenArgs(projectPath, opts) {
    const args = ['--project', projectPath];
    if (!opts || opts.noLogin !== false) args.push('--nologin');
    return args;
}

function cmdOpen(rest) {
    if (rest[0] === '--help' || rest[0] === '-h') {
        process.stdout.write(
            'cocos-mcp-cli open - open a Cocos Creator project\n\n' +
            'Usage:\n' +
            '  cocos-mcp-cli open <project> --version 3.8.8\n' +
            '  cocos-mcp-cli open --project <project> --cocos <CocosCreator executable>\n\n' +
            'Options:\n' +
            '  --project, -p <path>   Cocos project root. Positional <project> is also accepted.\n' +
            '  --version, -v <ver>    Resolve Cocos Creator by version from common install paths.\n' +
            '  --cocos,   -c <path>   CocosCreator executable path. Takes precedence over --version.\n' +
            '  --no-login             Add Cocos --nologin. Default.\n' +
            '  --with-login           Do not add --nologin.\n' +
            '  --wait                 Wait for the Cocos process to exit instead of detaching.\n' +
            '  --dry-run              Print the command without launching.\n'
        );
        return;
    }

    const a = parseArgs(rest);
    if (!a.project) die('missing project path: pass <project> or --project <path>');
    a.project = path.resolve(a.project);
    if (!fs.existsSync(a.project)) die('project path does not exist: ' + a.project);
    if (!fs.existsSync(path.join(a.project, 'assets'))) die('not a Cocos project root, missing assets/: ' + a.project);

    let cocos;
    try {
        cocos = resolveCocosExec(a);
    } catch (e) {
        die(e.message);
    }

    const argv = buildOpenArgs(a.project, a);
    if (a.dryRun) {
        process.stdout.write('[dry-run] ' + cocos + ' ' + argv.map(function (x) {
            return /\s/.test(x) ? '"' + x + '"' : x;
        }).join(' ') + '\n');
        return;
    }

    process.stdout.write('Opening Cocos project:\n  ' + a.project + '\n');
    const child = spawn(cocos, argv, {
        stdio: a.wait ? 'inherit' : 'ignore',
        detached: !a.wait,
    });
    child.on('error', function (e) { die('failed to start Cocos Creator: ' + e.message); });
    if (a.wait) {
        child.on('exit', function (code) { process.exit(code == null ? 1 : code); });
    } else {
        child.unref();
    }
}

module.exports = { cmdOpen, parseArgs, buildOpenArgs };
