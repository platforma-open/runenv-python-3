#!/usr/bin/env node

import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const isWindows = os.platform() === 'win32';

import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const builderRoot = path.resolve(__dirname, '..');
const builderScript = path.join(builderRoot, 'src', 'build.ts');

// Set environment variables to disable buffering
const env = {
  ...process.env,
  // Force unbuffered output for Python processes
  PYTHONUNBUFFERED: '1',
  PIP_PROGRESS_BAR: 'off',
};

// Try to use tsx module directly, fallback to binary
// Using node directly avoids shell buffering issues
let command, args;
const tsxModulePath = path.join(builderRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
if (fs.existsSync(tsxModulePath)) {
  command = 'node';
  args = [tsxModulePath, builderScript, ...process.argv.slice(2)];
} else {
  // Fallback to tsx binary (shouldn't happen, but just in case)
  const tsxBin = path.join(builderRoot, 'node_modules', '.bin', isWindows ? 'tsx.ps1' : 'tsx');
  command = tsxBin;
  args = [builderScript, ...process.argv.slice(2)];
}

const child = spawn(command, args, {
  stdio: 'inherit',
  // Don't use shell - it can cause additional buffering
  env,
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
