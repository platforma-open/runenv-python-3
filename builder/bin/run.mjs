#!/usr/bin/env node

import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const isWindows = os.platform() === 'win32';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const builderRoot = path.resolve(__dirname, '..');
const tsxBin = path.join(builderRoot, 'node_modules', '.bin', isWindows ? 'tsx.ps1' : 'tsx');
const builderScript = path.join(builderRoot, 'src', 'build.ts');

const child = spawn(tsxBin, [builderScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: isWindows ? 'powershell' : 'bash',
  env: {
    ...process.env,
  }
});

child.on('error', (error) => {
  console.error('Failed to start process:', error);
  process.exit(1);
});

child.on('close', (code, signal) => {
  if (signal) {
    console.error(`Process was killed with signal ${signal}`);
    process.exit(128 + signal);
  } else {
    if (code === null) {
      console.error(`Process exited with null code`);
      process.exit(121);
    }
    process.exit(code);
  }
});
