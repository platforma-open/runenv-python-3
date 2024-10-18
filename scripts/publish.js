#!/usr/bin/env node

/*
 * Usage check
 */
const args = process.argv.slice(2);
const scriptName = __filename;

if (args.length !== 1) {
  console.error(`Usage: ${scriptName} <version>`);
  process.exit(1);
}

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { exit } = require('process');

/*
 * Init script state
 */
const packageRoot = path.resolve(__dirname, '..');

/*
 * Function definitions
 */

function runCommand(command, args) {
  console.log(`running: '${[command, ...args].join("' '")}'...`);

  const result = spawnSync(command, args, {
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status > 0) {
    throw new Error(`command exited with non-zero exit code ${result.status}`);
  }
}

/*
 * Script body
 */

const version = args[0];
const entrypointPath = path.join(
  packageRoot,
  'dist',
  'tengo',
  'software',
  `${version}.sw.json`
);

if (!fs.existsSync(entrypointPath)) {
  console.log(`
No software descriptor found at '${entrypointPath}'.

Looks like you're going to publish new version of amazon corretto java distribution.
See README.md for the instructions on how to do this properly.
`);

  exit(1);
}

runCommand('pl-pkg', [
  'sign',
  'packages',
  `--package-id=${version}`,
  '--all-platforms',
  `--sign-command=["gcloud-kms-sign", "{pkg}", "{pkg}.sig"]`
]);

runCommand('pl-pkg', [
  'publish',
  'packages',
  `--package-id=${version}`,
  '--force',
  '--all-platforms'
]);
