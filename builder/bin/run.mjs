#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const builderRoot = path.resolve(__dirname, '..');
const tsxBin = path.join(builderRoot, 'node_modules', '.bin', 'tsx.ps1');
const builderScript = path.join(builderRoot, 'src', 'build.ts');

const result = spawnSync(tsxBin, [builderScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: os.platform() === 'win32' ? 'powershell' : 'bash',
});

const status = result.status === null ? 1 : result.status;
process.exit(status);
