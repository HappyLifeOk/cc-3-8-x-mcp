'use strict';

const fs = require('fs');
const path = require('path');

function resolveCliRoot() {
  const bundled = path.resolve(__dirname, '..');
  const link = path.resolve(bundled, '..', '.cli-source');
  const entry = fs.lstatSync(link, { throwIfNoEntry: false });
  if (!entry) return bundled;
  if (!entry.isSymbolicLink() || !fs.existsSync(path.join(link, 'src', 'index.js'))
      || !fs.existsSync(path.join(link, 'src', 'cli', 'main.js'))) {
    throw new Error(`CLI 源码链接无效: ${link}。请重新关联源码或执行 link-cli-source.js --unlink。`);
  }
  return fs.realpathSync(link);
}

module.exports = { resolveCliRoot };
