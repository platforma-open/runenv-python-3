#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import * as util from './util';
import { mergeConfig, validateConfig, ResolutionPolicy } from './config-merger';
import * as linux from './linux';
import * as macos from './macos';
import * as windows from './windows';

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

const isTestRun = process.env['TEST_RUN'] === 'true';
console.log(`[DIAGNOSTIC] Test run: ${isTestRun}`);

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

// Load and merge configuration using the FULL version string
let config: any;
try {
  config = mergeConfig(util.repoRoot, util.packageRoot);
  validateConfig(config, util.packageDirName);
} catch (error: any) {
  console.error('Configuration error:', error);
  process.exit(1);
}

console.log('[DEBUG] Merged configuration:', JSON.stringify(config, null, 2));

console.log(`Building Python '${pythonVersion}' in '${util.packageDirName}' with configuration:`);
console.log(`- Dependencies: ${config.packages.dependencies.length} packages`);

/*
 * Function definitions
 */

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

async function buildInDocker(): Promise<void> {
  const tagName = `py-builder-${Math.random().toString(32).substring(2, 6)}:local`;
  await util.runCommand('docker', ['build', '-t', tagName, path.join(util.builderDir, 'docker')]);

  const runArgs = [
    '--rm',
    '--volume', `${util.repoRoot}:/app`,
    '--env', `FIX_PERMS=${process.getuid!()}:${process.getgid!()}`,
  ]
  if (isTestRun) {
    runArgs.push('--env', 'TEST_RUN=true');
  }

  await util.runCommand('docker', ['run', ...runArgs, tagName, `/app/${util.packageDirName}`]);
}

async function buildFromSources(version: string, osType: util.OS, archType: util.Arch, installDir: string): Promise<void> {
  await util.runCommand('pipx', ['install', 'portable-python']);
  await util.runCommand('pipx', ['run', 'portable-python', 'build', version]);

  const archiveDir = 'dist'; // portable-python always creates python archive in 'dist' dir
  const tarGzName = detectTarGzArchive(archiveDir);

  const versionPydist = path.dirname(installDir);
  const tarGzPath = path.join(versionPydist, tarGzName);
  fs.renameSync(path.join(archiveDir, tarGzName), tarGzPath);

  // Use a dedicated temporary directory for extraction to avoid relative path issues.
  const tempExtractDir = path.join(util.repoRoot, 'temp-extract');
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
  util.emptyDirSync(installDir);

  // Move the extracted python directory to its final destination
  fs.renameSync(extractedPythonDir, installDir);

  // Clean up the temporary directory
  fs.rmSync(tempExtractDir, { recursive: true });

  console.log(
    `\nPython ${version} portable distribution for ${osType}-${archType} was saved to ${installDir}\n`
  );
}

function getPackageName(packageSpec: string): string {
  // Extract package name from spec (e.g., "parasail==1.3.4" -> "parasail")
  return packageSpec.split(/[<>=!]/)[0].trim();
}

function shouldSkipPackage(packageName: string, osType: util.OS, archType: util.Arch): boolean {
  const platformKey = `${osType}-${archType}`;

  // Check skip configuration
  const skipConfig = config.packages.skip[packageName];
  if (skipConfig && skipConfig[platformKey]) {
    console.log(`  ⚠️  Skipping ${packageName} for ${platformKey}: ${skipConfig[platformKey]}`);
    return true;
  }

  return false;
}

function shouldForceSource(packageName: string, osType: util.OS, archType: util.Arch): boolean {
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

function getResolutionPolicy(osType: util.OS, archType: util.Arch): ResolutionPolicy {
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
function additionalPlatforms(osType: util.OS, archType: util.Arch): string[] {
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

async function downloadPackages(pyBin: string, destinationDir: string, osType: util.OS, archType: util.Arch): Promise<void> {
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
        await util.runCommand(pyBin, pipArgs);
        console.log(`  ✓ Successfully downloaded source for ${depSpecClean}`);
      } catch (sourceError: any) {
        const msg = sourceError.message ?? sourceError.toString();
        console.error(`  ✗ Failed to download source for ${depSpecClean}: ${msg}`);
        throw sourceError;
      }
    } else {
      // Try binary wheel first, then fall back to source
      try {
        console.log(`  Attempting to download binary wheel...`);
        const pipArgs = buildPipArgs(depSpecClean, destinationDir);
        pipArgs.push('--only-binary', ':all:');
        await util.runCommand(pyBin, pipArgs);
        console.log(`  ✓ Successfully downloaded binary wheel for ${depSpecClean} (current platform)`);
        for (const platform of additionalPlatforms(osType, archType)) {
          console.log(`  Downloading additional binary wheel for ${platform}...`);
          await util.runCommand(pyBin, [...pipArgs, '--platform', platform]);
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
          await util.runCommand(pyBin, pipArgs);
          console.log(`  ✓ Successfully downloaded source for ${depSpecClean}`);
        } catch (sourceError: any) {
          const msg = sourceError.message ?? sourceError.toString();
          console.error(`  ✗ Failed to download source for ${depSpecClean}: ${msg}`);
          if (resolution.strictMissing) throw sourceError;
          console.warn(`  ⚠️  Skipping ${packageName} due to source build failure.`);
          continue;
        }
      }
    }
  }
}

function copyVersionSpecificFiles(installDir: string, osType: util.OS, archType: util.Arch): void {
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
    const sourcePath = path.join(util.packageRoot, op.from);
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
        util.copyDirSync(sourcePath, finalDestPath);
      } else {
        fs.copyFileSync(sourcePath, finalDestPath);
      }
      console.log(`  ✓ Successfully copied.`);
    } catch (error: any) {
      const msg = error.message ?? error.toString();
      console.error(`  ✗ Failed to copy from '${sourcePath}' to '${finalDestPath}': ${msg}`);
      throw error;
    }
  }
}


async function loadPackages(installDir: string, osType: util.OS, archType: util.Arch): Promise<void> {
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

async function fakeBuild(installDir: string, osType: util.OS, archType: util.Arch): Promise<void> {
  console.log(`[DEBUG] Performing fake build to imitate script execution for faster CI checks...`);
  util.emptyDirSync(installDir);
  fs.copyFileSync(path.join(util.builderDir, 'assets', 'fake-package-content.md'), path.join(installDir, 'README.md'));
}

/*
 * Script body
 */
(async () => {
  try {
    console.log(`[DEBUG] Starting build for Python ${pythonVersion}`);
    console.log(`[DEBUG] Current working directory: ${process.cwd()}`);
    console.log(`[DEBUG] Repository root: ${util.repoRoot}`);
    console.log(`[DEBUG] Package root: ${util.packageRoot}`);
    console.log(`[DEBUG] Package directory name: ${util.packageDirName}`);

    const osType = util.currentOS();
    const archType = util.currentArch();
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
        if (isTestRun) {
          console.log(`[DEBUG] Skipping Windows distribution build in test run`);
          await fakeBuild(installDir, osType, archType);
          break;
        }

        console.log(`[DEBUG] Building Windows distribution...`);
        await windows.getPortablePython(pythonVersion, archType, installDir);
        await loadPackages(installDir, osType, archType);

        break;
      }
      case 'macosx': {
        if (isTestRun) {
          console.log(`[DEBUG] Skipping MacOS X distribution build in test run`);
          await fakeBuild(installDir, osType, archType);
          break;
        }

        console.log(`[DEBUG] Building macOS distribution...`);
        await buildFromSources(pythonVersion, osType, archType, installDir);
        console.log(`[DEBUG] Consolidating macOS libraries...`);
        await macos.consolidateLibs(installDir);
        await loadPackages(installDir, osType, archType);

        break;
      }
      case 'linux': {
        if (util.isInBuilderContainer) {
          if (isTestRun) {
            console.log(`[DEBUG] Skipping Linux distribution build in test run`);
            await fakeBuild(installDir, osType, archType);
            return;
          }

          console.log(`[DEBUG] Building Linux distribution inside docker container...`);
          await buildFromSources(pythonVersion, osType, archType, installDir);
          linux.consolidateLibs(installDir, true);
          await loadPackages(installDir, osType, archType);
          return
        }
  
        console.log(`[DEBUG] Initializing docker build...`)
        await buildInDocker();

        break;
      }
      default: {
        (x: never): void => { throw new Error(`Unsupported OS: ${x}`); }
      }
    }

    console.log(`[DEBUG] Building pl package...`);
    await util.runCommand('pl-pkg', ['build']);

    if (process.env['CI'] === 'true') {
      console.log(`[DEBUG] Publishing packages...`);
      await util.runCommand('pl-pkg', ['publish', 'packages']);
    }

    console.log(`[DEBUG] Build completed successfully`);
    console.log(`[DEBUG] Package root listing after build:`);
    console.log(fs.readdirSync('.'));

  } catch (error: any) {
    const msg = error.message ?? error.toString();
    const stack = error.stack ?? '';
    console.error(`[ERROR] Build failed: ${msg}`);
    if (stack) {
      console.error(`[ERROR] Stack trace: ${stack}`);
    }
    process.exit(122);
  }
})();
