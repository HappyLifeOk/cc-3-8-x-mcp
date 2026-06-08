'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function uniqExisting(paths) {
    const out = [];
    const seen = new Set();
    paths.forEach(function (p) {
        if (!p || seen.has(p)) return;
        seen.add(p);
        try {
            if (fs.existsSync(p)) out.push(p);
        } catch (e) { /* ignore */ }
    });
    return out;
}

function envCandidates(env) {
    return [
        env.COCOS_CREATOR,
        env.COCOS_CREATOR_PATH,
        env.COCOS_DASHBOARD_CREATOR,
    ];
}

function buildCocosExecPathCandidates(version, platform, env, homeDir) {
    env = env || process.env;
    const versions = version ? [version] : [];
    const candidates = envCandidates(env);

    if (platform === 'win32') {
        const localAppData = env.LOCALAPPDATA || path.win32.join(homeDir, 'AppData', 'Local');
        const programFiles = env.ProgramFiles || 'C:\\Program Files';
        const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const roots = [
            env.COCOS_EDITOR_ROOT,
            path.win32.join(localAppData, 'CocosCreator'),
            path.win32.join(localAppData, 'Programs', 'CocosCreator'),
            path.win32.join(programFiles, 'CocosCreator'),
            path.win32.join(programFilesX86, 'CocosCreator'),
            'C:\\ProgramData\\cocos\\editors\\Creator',
            'C:\\cocos\\editors\\Creator',
            'D:\\cocos\\editors\\Creator',
            'H:\\cocos\\editors\\Creator',
        ];
        versions.forEach(function (v) {
            roots.forEach(function (root) {
                if (!root) return;
                candidates.push(path.win32.join(root, v, 'CocosCreator.exe'));
            });
            candidates.push(path.win32.join('C:\\', 'CocosCreator_' + v, 'CocosCreator.exe'));
            candidates.push(path.win32.join('D:\\', 'CocosCreator_' + v, 'CocosCreator.exe'));
            candidates.push(path.win32.join('H:\\', 'CocosCreator_' + v, 'CocosCreator.exe'));
        });
    } else if (platform === 'darwin') {
        versions.forEach(function (v) {
            candidates.push('/Applications/Cocos/Creator/' + v + '/CocosCreator.app/Contents/MacOS/CocosCreator');
            candidates.push('/Applications/CocosCreator/Creator/' + v + '/CocosCreator.app/Contents/MacOS/CocosCreator');
            candidates.push('/Applications/CocosCreator_' + v + '.app/Contents/MacOS/CocosCreator');
            candidates.push(path.posix.join(homeDir, 'Applications', 'Cocos', 'Creator', v, 'CocosCreator.app', 'Contents', 'MacOS', 'CocosCreator'));
        });
    } else {
        versions.forEach(function (v) {
            candidates.push('/opt/Cocos/Creator/' + v + '/CocosCreator');
            candidates.push('/opt/cocos/creator/' + v + '/CocosCreator');
            candidates.push(path.posix.join(homeDir, 'Cocos', 'Creator', v, 'CocosCreator'));
        });
    }

    return candidates;
}

function resolveCocosExec(opts) {
    const a = opts || {};
    if (a.cocos) {
        const explicit = path.resolve(a.cocos);
        if (!fs.existsSync(explicit)) {
            throw new Error('--cocos path does not exist: ' + explicit);
        }
        return explicit;
    }

    const found = uniqExisting(buildCocosExecPathCandidates(a.version, process.platform, process.env, os.homedir()));
    if (found.length === 1) return found[0];
    if (found.length > 1) {
        throw new Error('multiple Cocos Creator executables found, pass --cocos explicitly: ' + found.join(', '));
    }
    if (a.version) {
        throw new Error('Cocos Creator ' + a.version + ' not found. Pass --cocos <absolute executable path>.');
    }
    throw new Error('missing Cocos Creator executable. Pass --cocos <path> or --version <version>.');
}

module.exports = {
    buildCocosExecPathCandidates,
    resolveCocosExec,
    uniqExisting,
};
