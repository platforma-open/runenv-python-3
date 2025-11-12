#!/usr/bin/env tsx

import cp from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import os from 'os';
import { get } from 'https';
import * as unzipper from 'unzipper';
import { mergeConfig, validateConfig, ResolutionPolicy } from './config-merger';

const exec = promisify(cp.exec);

/*
 * Argument Parsing and Validation
 */
const args = process.argv.slice(2);
console.log(`[DIAGNOSTIC] Raw arguments received: ${args.join(', ')}`);

if (args.length > 0) {
  console.error(`Usage: node ${path.basename(process.argv[1])}`);
  console.error('  Expects no arguments.');
  console.error('  Example: node build.js');
  process.exit(1);
}

const pythonVersion = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
)['block-software']['entrypoints']['main']['environment']['artifact']['python-version'];

if (!pythonVersion) {
  console.error('Could not determine base python version from entrypoint settings.');
  process.exit(1);
}

/*
 * Init script state
 */
// By using path.resolve, we get a stable, absolute path to the project root,
// which is always one level above the 'scripts' directory. This avoids
// fragile relative path calculations based on the current working directory,
// which can change depending on how the script is invoked.
const scriptDir = path.resolve(__dirname);
const builderDir = path.dirname(scriptDir);
const repoRoot = path.dirname(builderDir);
const packageRoot = process.cwd();
const packageDirName = path.relative(repoRoot, packageRoot);
const isInBuilderContainer = process.env['BUILD_CONTAINER'] == 'true';

// supported OSes
type OS = 'macosx' | 'linux' | 'windows';
// supported architectures
type Arch = 'x64' | 'aarch64';

// Load and merge configuration using the FULL version string
let config: any;
try {
  config = mergeConfig(repoRoot, packageRoot);
  validateConfig(config, packageDirName);
} catch (error) {
  console.error('Configuration error:', error.message);
  process.exit(1);
}

console.log('[DEBUG] Merged configuration:', JSON.stringify(config, null, 2));

console.log(`Building Python '${pythonVersion}' in '${packageDirName}' with configuration:`);
console.log(`- Dependencies: ${config.packages.dependencies.length} packages`);

/*
 * Function definitions
 */

function currentOS(): OS {
  switch (process.env['RUNNER_OS']?.toLowerCase()) {
    case 'macos':
      return 'macosx';
    case 'linux':
      return 'linux';
    case 'windows':
      return 'windows';
  }

  switch (os.platform()) {
    case 'darwin':
      return 'macosx';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
  }

  throw new Error(`Unsupported OS: ${os.platform()}`);
}

function currentArch(): Arch {
  switch (process.env['RUNNER_ARCH']?.toLowerCase()) {
    case 'x64':
      return 'x64';
    case 'arm64':
      return 'aarch64';
  }

  switch (os.arch()) {
    case 'x64':
      return 'x64';
    case 'arm64':
      return 'aarch64';
  }

  throw new Error(`Unsupported architecture: ${os.arch()}`);
}

function runCommand(command: string, args: string[]): void {
  console.log(`running: '${[command, ...args].join("' '")}'...`);

  if (currentOS() === 'windows') {
    args = ['/c', `${command}`, ...args];
    command = 'cmd';
  }

  const result = cp.spawnSync(command, args, {
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (!result.status || result.status > 0) {
    throw new Error(`command exited with non-zero exit code ${result.status}`);
  }
}

function detectTarGzArchive(searchDir: string): string {
  const files = fs.readdirSync(searchDir);
  for (const file of files) {
    if (file.endsWith('.tar.gz')) {
      return file;
    }
  }

  throw new Error(`No tar.gz archive found in '${searchDir}' directory`);
}

function untarPythonArchive(archivePath: string, targetDir: string): void {
  console.log(`using python archive '${archivePath}'`);
  console.log(`  extracting to '${targetDir}'`);

  tar.x({
    sync: true,
    file: archivePath,
    cwd: targetDir
  });
}

function buildInDocker(): void {
  runCommand('docker', ['build', '-t', 'py-builder:local', path.join(builderDir, 'docker')]);
  runCommand('docker', [
    'run',
    '-v', `${repoRoot}:/app`,
    'py-builder:local',
    `/app/${packageDirName}`
  ]);
}

function buildFromSources(version: string, osType: OS, archType: Arch, installDir: string): void {
  runCommand('pipx', ['install', 'portable-python']);
  runCommand('pipx', ['run', 'portable-python', 'build', version]);

  const archiveDir = 'dist'; // portable-python always creates python archive in 'dist' dir
  const tarGzName = detectTarGzArchive(archiveDir);

  const versionPydist = path.dirname(installDir);
  const tarGzPath = path.join(versionPydist, tarGzName);
  fs.renameSync(path.join(archiveDir, tarGzName), tarGzPath);

  // Use a dedicated temporary directory for extraction to avoid relative path issues.
  const tempExtractDir = path.join(repoRoot, 'temp-extract');
  if (fs.existsSync(tempExtractDir)) {
    fs.rmSync(tempExtractDir, { recursive: true });
  }
  fs.mkdirSync(tempExtractDir, { recursive: true });

  untarPythonArchive(tarGzPath, tempExtractDir);

  // Dynamically find the name of the extracted directory.
  // We expect portable-python to create a single directory inside the tarball.
  const files = fs.readdirSync(tempExtractDir, { withFileTypes: true });
  const directories = files.filter(f => f.isDirectory());

  if (directories.length !== 1) {
    throw new Error(
      `Extraction failed: Expected 1 directory in the archive, but found ${directories.length}. ` +
      `Contents: ${files.map(f => f.name).join(', ')}`
    );
  }

  const extractedDirName = directories[0].name;
  const extractedPythonDir = path.join(tempExtractDir, extractedDirName);
  console.log(`[DEBUG] Found extracted directory: '${extractedDirName}'`);


  // Ensure the final destination exists and is empty
  if (fs.existsSync(installDir)) {
    fs.rmSync(installDir, { recursive: true });
  }
  fs.mkdirSync(installDir, { recursive: true });

  // Move the extracted python directory to its final destination
  fs.renameSync(extractedPythonDir, installDir);

  // Clean up the temporary directory
  fs.rmSync(tempExtractDir, { recursive: true });

  console.log(
    `\nPython ${version} portable distribution for ${osType}-${archType} was saved to ${installDir}\n`
  );
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
        return;
      }

      console.log(`downloading '${url}' to '${dest}'`);

      response.pipe(file);

      file.on('finish', () => {
        file.close(() => resolve());
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function unzipFile(zipPath: string, destDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    console.log(`extracting '${zipPath}' to '${destDir}'`);

    const readStream = fs.createReadStream(zipPath);
    readStream
      .pipe(unzipper.Extract({ path: destDir }))
      .on('close', () => resolve())
      .on('error', (err: any) => reject(err));
  });
}

async function getPortableWindows(version: string, archType: Arch, installDir: string): Promise<void> {
  if (archType != 'x64') {
    throw new Error(`architecture '${archType}' is not supported for windows`);
  }

  // Derive the packageDist from the final installDir to ensure it's correct.
  const packageDist = path.dirname(installDir);

  const archiveName = `python-${version}-embed-amd64.zip`;
  const pythonZipFile = path.join(packageDist, archiveName);
  const pythonZipUrl = `https://www.python.org/ftp/python/${version}/${archiveName}`;

  const pipUrl = 'https://bootstrap.pypa.io/pip/pip.pyz';
  const pipName = 'pip.pyz';
  const pipFile = path.join(packageDist, pipName);
  const pyBinRoot = path.join(installDir, 'bin');

  await downloadFile(pythonZipUrl, pythonZipFile);
  await downloadFile(pipUrl, pipFile);
  await unzipFile(pythonZipFile, pyBinRoot);

  const [major, minor] = version.split('.');
  const pyName = `python${major}${minor}`;

  const stdLibArchive = path.join(pyBinRoot, `${pyName}.zip`);
  const stdLibPath = path.join(pyBinRoot, "python_stdlib");
  await unzipFile(stdLibArchive, stdLibPath);
  fs.rmSync(stdLibArchive);

  fs.writeFileSync(
    path.join(pyBinRoot, `${pyName}._pth`),
    `
python_stdlib
.
import site
`
  );

  const pythonExe = path.join(pyBinRoot, 'python.exe');

  // Install pip with bootstrap pip.pyz script
  runCommand(pythonExe, [pipFile, 'install', 'pip']);

  // On windows pip has a flaw that causes exceptions during pip init step (confugutations reading).
  //   CSIDL_COMMON_APPDATA registry read issue (Error: FileNotFoundError: [WinError 2])
  // If this command fails, see if https://github.com/pypa/pip/pull/13567 is resolved.
  // If so - patch is not needed any more.
  fixPipRegistryIssue(path.join(pyBinRoot, 'Lib', 'site-packages', 'pip'));

  // Install rest of the packages required in all environments
  runCommand(pythonExe, ['-m', 'pip', 'install', 'virtualenv', 'wheel']);

  // We have to patch pip embedded into venv package:
  const venvEmbeddedWheelsDir = path.join(pyBinRoot, 'Lib', 'site-packages', 'virtualenv', 'seed', 'wheels', 'embed');
  for (const wheel of fs.readdirSync(venvEmbeddedWheelsDir)) {
    if (wheel.startsWith('pip-') && wheel.endsWith('.whl')) {
      patchPipWheel(
        pythonExe,
        path.join(venvEmbeddedWheelsDir, wheel),
      );
    }
  }

  // drop pip, wheel and other binaries, as they are bound to absolute paths on host and will not work after pl package installation anyway
  fs.rmSync(path.join(pyBinRoot, 'Scripts'), { recursive: true });

  // Also make python binary to be available via python3 name, like we have
  // in Linux and Mac OS X (just for consistency).
  fs.copyFileSync(
    path.join(pyBinRoot, 'python.exe'),
    path.join(pyBinRoot, 'python3.exe'),
  );

  // We have to support the same toolset for all operation systems.
  // Make virtualenv to be available both as 'virtualenv' and 'venv' modules.
  copyDirSync(
    path.join(pyBinRoot, 'Lib', 'site-packages', 'virtualenv'),
    path.join(pyBinRoot, 'Lib', 'site-packages', 'venv')
  );
}

function fixPipRegistryIssue(pipRoot: string): void {
  const appdirsPath = path.join(pipRoot, '_internal', 'utils', 'appdirs.py');
  const patchPath = path.join(repoRoot, 'patches', 'pip-win-reg.patch');
  runCommand("patch", [appdirsPath, patchPath])
}

// Unpack wheel, patch appdirs.py and pack wheel back
function patchPipWheel(pythonExe: string, pipWheelPath: string): void {
  const pipPatchDir = path.join('.', 'pip-patch')
  if (fs.existsSync(pipPatchDir)) {
    fs.rmdirSync(pipPatchDir, { recursive: true });
  }

  runCommand(pythonExe, ["-m", "wheel", "unpack", pipWheelPath, '--dest', pipPatchDir]);
  // wheel unpack extracts .whl file contents into <dest>/<pkg>-<version> directory (pip-patch/pip-25.1)
  // We need to dynamically get name of this target dir to patch and re-assemble wheel
  for (const pkgDir of fs.readdirSync(pipPatchDir)) {
    const whlRootDir = path.join(pipPatchDir, pkgDir);
    fixPipRegistryIssue(path.join(whlRootDir, 'pip'));
    runCommand(pythonExe, ["-m", "wheel", "pack", whlRootDir, '--dest-dir', path.dirname(pipWheelPath)]);
  }

  fs.rmdirSync(pipPatchDir, { recursive: true });
}

async function isBinaryOSX(filePath: string): Promise<boolean> {
  const { stdout } = await exec(`file --no-dereference ${filePath}`);
  const attributes = stdout.split(':')[1].trim().split(' ');
  return (
    attributes.includes('Mach-O') ||
    (attributes.includes('executable') && !attributes.includes('script'))
  );
}

async function alterLibLoadPathOSX(binary: string, oldLibPath: string, newLibPath: string): Promise<void> {
  console.log(`\tPatching library '${oldLibPath}' load path in '${binary}'...`);
  await exec(`install_name_tool -change ${oldLibPath} ${newLibPath} ${binary}`);
}

async function listLibsOSX(binPath: string): Promise<string[]> {
  const { stdout } = await exec(`otool -L ${binPath}`);

  const lines = stdout.split('\n') as string[];
  const libraries: string[] = [];

  // Skip the first line as it contains the binary path
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) {
      const libraryPath = line.split(' ')[0].trim();
      libraries.push(libraryPath);
    }
  }

  return libraries;
}

function dropSystemLibsOSX(libraries: string[]): string[] {
  const result: string[] = [];

  for (const [i, libName] of libraries.entries()) {
    if (libName.startsWith('/System/Library/Frameworks/')) continue;
    if (libName === '/usr/lib/libSystem.B.dylib') continue;

    result.push(libName);
  }

  return result;
}

async function consolidateLibsOSX(installDir: string): Promise<void> {
  console.log(`Consolidating libraries...`);

  const binDir = path.join(installDir, 'bin');
  const libDir = path.join(installDir, 'lib');

  // Ensure libDir exists
  if (!fs.existsSync(libDir)) {
    fs.mkdirSync(libDir, { recursive: true });
  }

  // List all files in bin directory
  const files = fs.readdirSync(binDir);
  for (const file of files) {
    const binaryPath = path.join(binDir, file);
    const fileStat = fs.statSync(binaryPath);

    if (!fileStat.isFile()) {
      console.log(`\t(file '${binaryPath}' was skipped: not a file)`);
      continue;
    }

    if (!(await isBinaryOSX(binaryPath))) {
      console.log(`\t(file '${binaryPath}' was skipped: not a binary file)`);
      continue;
    }

    // Get libraries list for the binary
    const libraries = await listLibsOSX(binaryPath);
    const nonSystemLibs = dropSystemLibsOSX(libraries);

    for (const lib of nonSystemLibs) {
      // Do not patch paths to libraries, that are already relative
      if (!lib.startsWith('/')) continue;

      const libName = path.basename(lib);
      const libDest = path.join(libDir, libName);

      if (!fs.existsSync(libDest)) {
        fs.copyFileSync(lib, libDest);
      }

      alterLibLoadPathOSX(
        binaryPath,
        lib,
        `@executable_path/../lib/${libName}`
      );
      return;
    }
  }
}

function getPackageName(packageSpec: string): string {
  // Extract package name from spec (e.g., "parasail==1.3.4" -> "parasail")
  return packageSpec.split(/[<>=!]/)[0].trim();
}

function shouldSkipPackage(packageName: string, osType: OS, archType: Arch): boolean {
  const platformKey = `${osType}-${archType}`;

  // Check skip configuration
  const skipConfig = config.packages.skip[packageName];
  if (skipConfig && skipConfig[platformKey]) {
    console.log(`  ⚠️  Skipping ${packageName} for ${platformKey}: ${skipConfig[platformKey]}`);
    return true;
  }

  return false;
}

function shouldForceSource(packageName: string, osType: OS, archType: Arch): boolean {
  const platformKey = `${osType}-${archType}`;

  // Check forceSource configuration
  const forceSourceConfig = config.packages.forceSource[packageName];
  if (forceSourceConfig && forceSourceConfig[platformKey]) {
    console.log(`  ℹ️  Forcing source build for ${packageName} on ${platformKey}: ${forceSourceConfig[platformKey]}`);
    return true;
  }

  return false;
}

// --- Resolution policy (config-driven) ---
function normalizePackageName(name: string): string {
  return (name || '').toLowerCase().replace(/_/g, '-');
}

function mergeResolution(base: any, override: any): ResolutionPolicy {
  const lc = (arr: string[]) => (arr || []).map(x => (typeof x === 'string' ? x.toLowerCase().replace(/_/g, '-') : x));
  const dedup = (arr: string[]) => [...new Set(lc(arr))];
  const has = (obj: any, key: string) => obj && Object.prototype.hasOwnProperty.call(obj, key);
  const b = base || {} as ResolutionPolicy;
  const o = override || {} as ResolutionPolicy;
  return {
    allowSourceAll: has(o, 'allowSourceAll') ? o.allowSourceAll : !!b.allowSourceAll,
    strictMissing: has(o, 'strictMissing') ? o.strictMissing : !!b.strictMissing,
    allowSourceList: dedup([...(b.allowSourceList || []), ...(o.allowSourceList || [])]),
    forceNoBinaryList: dedup([...(b.forceNoBinaryList || []), ...(o.forceNoBinaryList || [])]),
    onlyBinaryList: dedup([...(b.onlyBinaryList || []), ...(o.onlyBinaryList || [])])
  };
}

function getResolutionPolicy(osType: OS, archType: Arch): ResolutionPolicy {
  const base = config.packages?.resolution || {} as ResolutionPolicy;
  const platformKey = `${osType}-${archType}`;
  const plat = config.packages?.platformSpecific?.[platformKey]?.resolution || {};
  return mergeResolution(base, plat);
}

function buildPipArgs(packageSpec: string, destinationDir: string): string[] {
  const args = [
    '-m',
    'pip',
    'download',
    packageSpec,
    '--dest',
    destinationDir
  ];

  // Add additional registries (pip will use PyPI.org as default)
  const additionalRegistries = config.registries.additional || [];
  for (const url of additionalRegistries) {
    args.push('--extra-index-url=' + url);
  }

  return args;
}

// Get list of additional platforms for binary wheels.
// Makes pip to download wheels for older Mac OS X versions in addition to current one.
function additionalPlatforms(osType: OS, archType: Arch): string[] {
  if (osType !== 'macosx') {
    return [];
  }

  if (archType === 'x64') {
    return ['macosx_13_0_x86_64'];
  }

  if (archType === 'aarch64') {
    return ['macosx_13_0_arm64'];
  }

  return [];
}

async function downloadPackages(pyBin: string, destinationDir: string, osType: OS, archType: Arch): Promise<void> {
  const depsList = config.packages.dependencies || [];

  // Also include platform-specific dependencies
  const platformKey = `${osType}-${archType}`;
  const platformDeps = config.packages.platformSpecific?.[platformKey]?.dependencies || [];
  const allDeps = [...new Set([...depsList, ...platformDeps])];

  const resolution = getResolutionPolicy(osType, archType);
  console.log(`[DEBUG] Resolution policy: ${JSON.stringify(resolution)}`);

  for (const depSpec of allDeps) {
    const depSpecClean = depSpec.trim();
    if (!depSpecClean) {
      // Skip empty lines
      continue;
    }

    const packageName = getPackageName(depSpecClean);
    const packageNameNorm = normalizePackageName(packageName);
    console.log(`\nProcessing package: ${depSpecClean}`);

    // Check if package should be skipped for this platform
    if (shouldSkipPackage(packageName, osType, archType)) {
      continue;
    }

    // Check if package should be forced to build from source
    let forceSource = shouldForceSource(packageName, osType, archType);
    if (resolution.forceNoBinaryList?.includes(packageNameNorm)) {
      console.log(`  ℹ️  Forcing source build for ${packageName} due to resolution.forceNoBinaryList`);
      forceSource = true;
    }

    if (forceSource) {
      // Skip binary wheel attempt and go straight to source
      console.log(`  Building from source (forced)...`);
      try {
        const pipArgs = buildPipArgs(depSpecClean, destinationDir);
        // Only force source for this package to preserve wheels for its dependencies
        pipArgs.push('--no-binary', packageName);
        runCommand(pyBin, pipArgs);
        console.log(`  ✓ Successfully downloaded source for ${depSpecClean}`);
      } catch (sourceError) {
        console.error(`  ✗ Failed to download source for ${depSpecClean}: ${sourceError.message}`);
        throw sourceError;
      }
    } else {
      // Try binary wheel first, then fall back to source
      try {
        console.log(`  Attempting to download binary wheel...`);
        const pipArgs = buildPipArgs(depSpecClean, destinationDir);
        pipArgs.push('--only-binary', ':all:');
        runCommand(pyBin, pipArgs);
        console.log(`  ✓ Successfully downloaded binary wheel for ${depSpecClean} (current platform)`);
        for (const platform of additionalPlatforms(osType, archType)) {
          console.log(`  Downloading additional binary wheel for ${platform}...`);
          runCommand(pyBin, [...pipArgs, '--platform', platform]);
          console.log(`  ✓ Successfully downloaded additional binary wheel for ${depSpecClean} (${platform} platform)`);
        }
      } catch (error) {
        // Decide fallback according to resolution policy
        if (resolution.onlyBinaryList?.includes(packageNameNorm)) {
          const msg = `Wheel not available and onlyBinaryList forbids source for ${packageName}`;
          if (resolution.strictMissing) {
            throw new Error(msg);
          } else {
            console.warn(`  ⚠️  ${msg}. Skipping.`);
            continue;
          }
        }

        const allowSource = resolution.allowSourceAll || (resolution.allowSourceList?.includes(packageNameNorm));
        if (!allowSource) {
          const msg = `Wheel not available and source fallback disabled for ${packageName}`;
          if (resolution.strictMissing) {
            throw new Error(msg);
          } else {
            console.warn(`  ⚠️  ${msg}. Skipping.`);
            continue;
          }
        }

        console.log(`  ✗ Binary wheel not available for ${depSpecClean}, building from source (policy-allowed)...`);
        try {
          const pipArgs = buildPipArgs(depSpecClean, destinationDir);
          // Only force source for this package, not its dependencies
          pipArgs.push('--no-binary', packageName);
          runCommand(pyBin, pipArgs);
          console.log(`  ✓ Successfully downloaded source for ${depSpecClean}`);
        } catch (sourceError) {
          console.error(`  ✗ Failed to download source for ${depSpecClean}: ${sourceError.message}`);
          if (resolution.strictMissing) throw sourceError;
          console.warn(`  ⚠️  Skipping ${packageName} due to source build failure.`);
          continue;
        }
      }
    }
  }
}

function copyVersionSpecificFiles(installDir: string, osType: OS, archType: Arch): void {
  const genericCopyFiles = config.packages.copyFiles || [];

  const platformKey = `${osType}-${archType}`;
  const platformSpecificConfig = config.packages.platformSpecific?.[platformKey];
  const platformCopyFiles = platformSpecificConfig?.copyFiles || [];

  const allCopyOperations = [...genericCopyFiles, ...platformCopyFiles];

  if (allCopyOperations.length === 0) {
    console.log(`\n[DEBUG] No version-specific files to copy for this platform.`);
    return;
  }

  console.log(`\n[DEBUG] Copying version-specific files...`);

  for (const op of allCopyOperations) {
    console.log(`[DEBUG] Processing copy operation:`, JSON.stringify(op));
    const sourcePath = path.join(packageRoot, op.from);
    console.log(`[DEBUG]   Resolved source path: ${sourcePath}`);

    let destPath = op.to;
    // Dynamically replace site-packages path
    if (destPath.includes('{site-packages}')) {
      console.log(`[DEBUG]   Found '{site-packages}' in destination.`);
      const [major, minor] = pythonVersion.split('.');
      const sitePackagesDir = (osType === 'windows')
        ? 'Lib/site-packages'
        : `lib/python${major}.${minor}/site-packages`;
      destPath = destPath.replace('{site-packages}', sitePackagesDir);
      console.log(`[DEBUG]   Replaced destPath: ${destPath}`);
    }

    const finalDestPath = path.join(installDir, destPath);
    console.log(`[DEBUG]   Resolved final destination path: ${finalDestPath}`);

    console.log(`  Copying from '${sourcePath}' to '${finalDestPath}'...`);

    if (!fs.existsSync(sourcePath)) {
      console.error(`  ✗ ERROR: Source path does not exist: ${sourcePath}`);
      continue; // Skip to the next operation
    }

    try {
      const sourceStats = fs.statSync(sourcePath);
      fs.mkdirSync(path.dirname(finalDestPath), { recursive: true });

      if (sourceStats.isDirectory()) {
        copyDirSync(sourcePath, finalDestPath);
      } else {
        fs.copyFileSync(sourcePath, finalDestPath);
      }
      console.log(`  ✓ Successfully copied.`);
    } catch (error) {
      console.error(`  ✗ Failed to copy from '${sourcePath}' to '${finalDestPath}': ${error.message}`);
      throw error;
    }
  }
}


function copyDirSync(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath); // recursive copy
    } else {
      fs.copyFileSync(srcPath, destPath); // copy file
    }
  }
}

async function loadPackages(installDir: string, osType: OS, archType: Arch): Promise<void> {
  console.log(`[DEBUG] Loading packages...`);

  const pyBin = path.join(installDir, 'bin', 'python');
  const packagesDir = path.join(installDir, 'packages');
  console.log(`[DEBUG] Python binary: ${pyBin}`);
  console.log(`[DEBUG] Packages directory: ${packagesDir}`);

  // Log configured registries and packages
  const additionalRegistries = config.registries.additional || [];
  const allRegistries = ['https://pypi.org', ...additionalRegistries];
  console.log(`\nUsing PyPI registries: ${allRegistries.join(', ')}`);
  console.log(`\nInstalling ${config.packages.dependencies.length} packages from configuration`);

  console.log(`[DEBUG] Starting package downloads...`);
  await downloadPackages(pyBin, packagesDir, osType, archType);

  console.log(`[DEBUG] Checking config for copyFiles before execution:`, JSON.stringify(config.packages.copyFiles, null, 2));
  console.log(`[DEBUG] Copying version-specific files...`);
  copyVersionSpecificFiles(installDir, osType, archType);
}

/*
 * Script body
 */

(async () => {
  try {
    console.log(`[DEBUG] Starting build for Python ${pythonVersion}`);
    console.log(`[DEBUG] Current working directory: ${process.cwd()}`);
    console.log(`[DEBUG] Repository root: ${repoRoot}`);
    console.log(`[DEBUG] Package root: ${packageRoot}`);
    console.log(`[DEBUG] Package directory name: ${packageDirName}`);

    const osType = currentOS();
    const archType = currentArch();
    console.log(`[DEBUG] Detected OS: ${osType}, Arch: ${archType}`);

    // Create version-specific pydist directory
    const installDir = path.join(
      process.cwd(),
      'pydist',
      `${osType}-${archType}`
    );
    console.log(`[DEBUG] Install directory: ${installDir}`);

    console.log(`[DEBUG] Creating install directory and all its parents...`);
    fs.mkdirSync(installDir, { recursive: true });

    console.log(`[DEBUG] Starting Python distribution build...`);
    switch (osType) {
      case 'windows': {
        console.log(`[DEBUG] Building Windows distribution...`);
        await getPortableWindows(pythonVersion, archType, installDir);
        await loadPackages(installDir, osType, archType);
      }
      case 'macosx': {
        console.log(`[DEBUG] Building macOS distribution...`);
        buildFromSources(pythonVersion, osType, archType, installDir);
        console.log(`[DEBUG] Consolidating macOS libraries...`);
        await consolidateLibsOSX(installDir);
        await loadPackages(installDir, osType, archType);
  
      }
      case 'linux': {
        if (isInBuilderContainer) {
          console.log(`[DEBUG] Building Linux distribution inside docker container...`);
          buildFromSources(pythonVersion, osType, archType, installDir);
          await loadPackages(installDir, osType, archType);
          return
        }
  
        console.log(`[DEBUG] Initializing docker build...`)
        buildInDocker();  
      }
      default: {
        (x: never): void => { throw new Error(`Unsupported OS: ${x}`); }
      }
    }

    console.log(`[DEBUG] Building pl package...`);
    runCommand('pl-pkg', ['build']);

    if (process.env['CI'] === 'true') {
      console.log(`[DEBUG] Publishing packages...`);
      runCommand('pl-pkg', ['publish', 'packages']);
    }

    console.log(`[DEBUG] Build completed successfully`);
    console.log(`[DEBUG] Package root listing after build:`);
    console.log(fs.readdirSync('.'));

  } catch (error) {
    console.error(`[ERROR] Build failed: ${error.message}`);
    console.error(`[ERROR] Stack trace: ${error.stack}`);
    process.exit(1);
  }
})();
