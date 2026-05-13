#!/usr/bin/env node

/**
 * Development entry point — runs src/index.ts directly via tsx.
 */

const { register } = require('tsx/cjs/api');
register();
require('../src/index.ts');
