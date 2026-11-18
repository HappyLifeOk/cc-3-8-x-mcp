#!/usr/bin/env node
'use strict';

const path = require('path');
const { resolveCliRoot } = require('../src/cli-root.js');

const cli = resolveCliRoot();
require(path.join(cli, 'src', 'index.js'));
const { main } = require(path.join(cli, 'src', 'cli', 'main.js'));

main(process.argv.slice(2));
