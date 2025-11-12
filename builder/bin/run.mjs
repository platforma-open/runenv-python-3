#!/usr/bin/env node

import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const isWindows = os.platform() === 'win32';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const builderRoot = path.resolve(__dirname, '..');
const tsxBin = path.join(builderRoot, 'node_modules', '.bin', isWindows ? 'tsx.ps1' : 'tsx');
const builderScript = path.join(builderRoot, 'src', 'build.ts');

const result = spawnSync(tsxBin, [builderScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: isWindows ? 'powershell' : 'bash',
});

const status = result.status === null ? 121 : result.status;
process.exit(status);
