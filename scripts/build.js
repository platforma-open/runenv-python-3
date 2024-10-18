#!/usr/bin/env node

/*
 * Usage check
 */
const args = process.argv.slice(2);

if (args.length !== 1) {
  console.error(`Usage: ${process.argv[0]} <version>`);
  process.exit(1);
}

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const tar = require('tar');
const os = require('os');
const { get } = require('https');
const unzipper = require('unzipper');

/*
 * Init script state
 */
const packageRoot = path.resolve(__dirname, '..');
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
  const stdLibPath = path.join(pyBinRoot, pyName);
  await unzipFile(stdLibArchive, stdLibPath);
  fs.rmSync(stdLibArchive);

  fs.writeFileSync(
    path.join(pyBinRoot, `${pyName}._pth`),
    `
python312
.
import site
`
  );

  runCommand(path.join(pyBinRoot, 'python.exe'), [pipFile, 'install', 'pip']);
  // drop pip binaries, as they are 'bound' to absolute paths on host and will not work after pl package installation anyway
  fs.rmSync(path.join(pyBinRoot, 'Scripts'), { recursive: true });

  // TODO: check this package really works as we expect. I did not test windows package yet
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

  if (!fs.existsSync(packageDist)) {
    fs.mkdirSync(packageDist, { recursive: true }); // create install dir and all its parents
  }

  if (osType === os_windows) {
    await getPortableWindows(version, archType, installDir);
  } else {
    buildFromSources(version, osType, archType, installDir);
  }

  runCommand('pl-pkg', ['build', 'packages', `--package-id=${version}`]);
})();
