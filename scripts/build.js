#!/usr/bin/env node

/*
 * Usage check
 */
const args = process.argv.slice(2);

if (args.length !== 1) {
  console.error(`Usage: ${process.argv[0]} <version>`);
  process.exit(1);
}

const cp = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const tar = require('tar');
const os = require('os');
const { get } = require('https');
const unzipper = require('unzipper');

const exec = promisify(cp.exec);

/*
 * Init script state
 */
const packageRoot = path.relative(process.cwd(), path.resolve(__dirname, '..'));
const packageDist = path.join(packageRoot, 'pydist');

// supported OSes
const os_macosx = 'macosx';
const os_linux = 'linux';
const os_windows = 'windows';

// supported architectures
const arch_x64 = 'x64';
const arch_aarch64 = 'aarch64';

/*
 * Function definitions
 */

function currentOS() {
  switch (process.env['RUNNER_OS']?.toLowerCase()) {
    case 'macos':
      return os_macosx;
    case 'linux':
      return os_linux;
    case 'windows':
      return os_windows;
  }

  switch (os.platform()) {
    case 'darwin':
      return os_macosx;
    case 'linux':
      return os_linux;
    case 'win32':
      return os_windows;
  }

  return os.platform();
}

function currentArch() {
  switch (process.env['RUNNER_ARCH']?.toLowerCase()) {
    case 'x64':
      return arch_x64;
    case 'arm64':
      return arch_aarch64;
  }

  switch (os.arch()) {
    case 'x64':
      return arch_x64;
    case 'arm64':
      return arch_aarch64;
  }

  return os.arch();
}

function runCommand(command, args) {
  console.log(`running: '${[command, ...args].join("' '")}'...`);

  if (currentOS() === os_windows) {
    args = ['/c', `${command}`, ...args];
    command = 'cmd';
  }

  const result = cp.spawnSync(command, args, {
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status > 0) {
    throw new Error(`command exited with non-zero exit code ${result.status}`);
  }
}

function checkDescriptor(version) {
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

  Looks like you're going to publish new version of python.
  See README.md for the instructions on how to do this properly.
  `);

    exit(1);
  }
}

function detectTarGzArchive(searchDir) {
  const files = fs.readdirSync(searchDir);
  for (const file of files) {
    if (file.endsWith('.tar.gz')) {
      return file;
    }
  }

  throw new Error(`No tar.gz archive found in '${searchDir}' directory`);
}

function untarPythonArchive(archivePath, targetDir) {
  console.log(`using python archive '${archivePath}'`);

  tar.x({
    sync: true,
    file: archivePath,
    cwd: targetDir
  });
}

function buildFromSources(version, osType, archType, installDir) {
  runCommand('pipx', ['install', 'portable-python']);
  runCommand('portable-python', ['build', version]);

  const archiveDir = 'dist'; // portable-python always creates python archive in 'dist' dir
  const tarGzName = detectTarGzArchive(archiveDir);

  const tarGzPath = path.join(packageDist, tarGzName);
  fs.renameSync(path.join(archiveDir, tarGzName), tarGzPath);

  untarPythonArchive(tarGzPath, packageRoot, version);

  // tar.gz archive contains <version>/... directory with all necessary inside. Move it to our package root
  if (!fs.existsSync(installDir)) {
    fs.mkdirSync(installDir, { recursive: true }); // create install dir and all its parents
  }
  fs.rmSync(installDir, { recursive: true }); // remove install dir before renaming
  fs.renameSync(path.join(packageRoot, version), installDir);

  console.log(
    `\nPython ${version} portable distribution for ${osType}-${archType} was saved to ${installDir}\n`
  );
}

async function downloadFile(url, dest) {
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
        file.close(resolve);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function unzipFile(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    console.log(`extracting '${zipPath}' to '${destDir}'`);

    const readStream = fs.createReadStream(zipPath);
    readStream
      .pipe(unzipper.Extract({ path: destDir }))
      .on('close', resolve)
      .on('error', reject);
  });
}

async function getPortableWindows(version, archType, installDir) {
  if (archType != arch_x64) {
    throw new Error(`architecture '${archType}' is not supported for windows`);
  }

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

  runCommand(path.join(pyBinRoot, 'python.exe'), [pipFile, 'install', 'pip']);
  runCommand(path.join(pyBinRoot, 'python.exe'), [pipFile, 'install', 'virtualenv']);
  // drop pip binaries, as they are 'bound' to absolute paths on host and will not work after pl package installation anyway
  fs.rmSync(path.join(pyBinRoot, 'Scripts'), { recursive: true });

  // Also make python binary to be available via python3 name, like we have
  // in Linux and Mac OS X (just for consistency).
  fs.copyFileSync(
    path.join(pyBinRoot, 'python.exe'),
    path.join(pyBinRoot, 'python3.exe'),
  );

  // We have to support the same tool set for all operation systems.
  // Will rename virtualenv to venv. 
  copyDirSync(
      path.join(pyBinRoot, 'Lib', 'site-packages', 'virtualenv'),
      path.join(pyBinRoot, 'Lib', 'site-packages', 'venv')
  );
}

async function isBinaryOSX(filePath) {
  const { stdout } = await exec(`file --no-dereference ${filePath}`);
  const attributes = stdout.split(':')[1].trim().split(' ');
  return (
    attributes.includes('Mach-O') ||
    (attributes.includes('executable') && !attributes.includes('script'))
  );
}

async function alterLibLoadPathOSX(binary, oldLibPath, newLibPath) {
  console.log(`\tPatching library '${oldLibPath}' load path in '${binary}'...`);
  await exec(`install_name_tool -change ${oldLibPath} ${newLibPath} ${binary}`);
}

async function listLibsOSX(binPath) {
  const { stdout } = await exec(`otool -L ${binPath}`);

  const lines = stdout.split('\n');
  const libraries = [];

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

function dropSystemLibsOSX(libraries) {
  const result = [];

  for (const [i, libName] of libraries.entries()) {
    if (libName.startsWith('/System/Library/Frameworks/')) continue;
    if (libName === '/usr/lib/libSystem.B.dylib') continue;

    result.push(libName);
  }

  return result;
}

async function consolidateLibsOSX(installDir) {
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

function downloadPackages(pyBin, dependenciesFile, destinationDir, osType, archType) {
  const depsContent = fs.readFileSync(dependenciesFile, 'utf-8');
  const depsList = depsContent.split('\n');

  for (const depSpec of depsList) {
    const depSpecClean = depSpec.trim();
    if (depSpecClean.startsWith('#') || !depSpecClean) {
      // Skip comments and empty lines
      continue;
    }

    if (archType === arch_aarch64 && depSpecClean.startsWith('parasail')) {
      continue;
    }

    runCommand(pyBin, [
      '-m',
      'pip',
      'download',
      '--extra-index-url=https://pypi.nvidia.com',
      depSpec.trim(),
      '--only-binary',
      ':all:',
      '--dest',
      destinationDir
    ]);
  }
}

function copyDirSync(src, dest) {
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

/*
 * Script body
 */

(async () => {
  const version = args[0];
  const osType = currentOS();
  const archType = currentArch();
  const installDir = path.join(
    packageDist,
    `v${version}`,
    `${osType}-${archType}`
  );

  checkDescriptor(version);

  if (!fs.existsSync(packageDist)) {
    fs.mkdirSync(packageDist, { recursive: true }); // create install dir and all its parents
  }

  if (osType === os_windows) {
    await getPortableWindows(version, archType, installDir);
  } else if (osType === os_macosx) {
    buildFromSources(version, osType, archType, installDir);
    await consolidateLibsOSX(installDir);
  } else {
    buildFromSources(version, osType, archType, installDir);
  }

  const pyBin = path.join(installDir, 'bin', 'python');
  const packagesDir = path.join(installDir, 'packages');
  const dependenciesFile = path.join(packageRoot, 'packages.txt');

  downloadPackages(pyBin, dependenciesFile, packagesDir, osType, archType);
  runCommand('pl-pkg', ['build', 'packages', `--package-id=${version}`]);
})();
