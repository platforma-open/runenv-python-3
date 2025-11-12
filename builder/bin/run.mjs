#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const builderRoot = path.resolve(__dirname, '..');
const builderBin = path.join(builderRoot, 'node_modules', '.bin', 'tsx');

const result = spawnSync(builderBin, [path.join(builderRoot, 'src', 'build.ts'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false
});

process.exit(result.status ?? 1);
