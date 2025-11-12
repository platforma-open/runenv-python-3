import path from 'path';
import fs from 'fs';
import * as util from './util';

async function fixPipRegistryIssue(pipRoot: string): Promise<void> {
  const appdirsPath = path.join(pipRoot, '_internal', 'utils', 'appdirs.py');
  const patchPath = path.join(util.repoRoot, 'patches', 'pip-win-reg.patch');
  await util.runCommand("patch", [appdirsPath, patchPath])
}

// Unpack wheel, patch appdirs.py and pack wheel back
async function patchPipWheel(pythonExe: string, pipWheelPath: string): Promise<void> {
  const pipPatchDir = path.join('.', 'pip-patch')
  if (fs.existsSync(pipPatchDir)) {
    fs.rmdirSync(pipPatchDir, { recursive: true });
  }

  await util.runCommand(pythonExe, ["-m", "wheel", "unpack", pipWheelPath, '--dest', pipPatchDir]);
  // wheel unpack extracts .whl file contents into <dest>/<pkg>-<version> directory (pip-patch/pip-25.1)
  // We need to dynamically get name of this target dir to patch and re-assemble wheel
  for (const pkgDir of fs.readdirSync(pipPatchDir)) {
    const whlRootDir = path.join(pipPatchDir, pkgDir);
    await fixPipRegistryIssue(path.join(whlRootDir, 'pip'));
    await util.runCommand(pythonExe, ["-m", "wheel", "pack", whlRootDir, '--dest-dir', path.dirname(pipWheelPath)]);
  }

  fs.rmdirSync(pipPatchDir, { recursive: true });
}


export async function getPortablePython(version: string, archType: util.Arch, installDir: string): Promise<void> {
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

  await util.downloadFile(pythonZipUrl, pythonZipFile);
  await util.downloadFile(pipUrl, pipFile);
  await util.unzipFile(pythonZipFile, pyBinRoot);

  const [major, minor] = version.split('.');
  const pyName = `python${major}${minor}`;

  const stdLibArchive = path.join(pyBinRoot, `${pyName}.zip`);
  const stdLibPath = path.join(pyBinRoot, "python_stdlib");
  await util.unzipFile(stdLibArchive, stdLibPath);
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
  await util.runCommand(pythonExe, [pipFile, 'install', 'pip']);

  // On windows pip has a flaw that causes exceptions during pip init step (confugutations reading).
  //   CSIDL_COMMON_APPDATA registry read issue (Error: FileNotFoundError: [WinError 2])
  // If this command fails, see if https://github.com/pypa/pip/pull/13567 is resolved.
  // If so - patch is not needed any more.
  await fixPipRegistryIssue(path.join(pyBinRoot, 'Lib', 'site-packages', 'pip'));

  // Install rest of the packages required in all environments
  await util.runCommand(pythonExe, ['-m', 'pip', 'install', 'virtualenv', 'wheel']);

  // We have to patch pip embedded into venv package:
  const venvEmbeddedWheelsDir = path.join(pyBinRoot, 'Lib', 'site-packages', 'virtualenv', 'seed', 'wheels', 'embed');
  for (const wheel of fs.readdirSync(venvEmbeddedWheelsDir)) {
    if (wheel.startsWith('pip-') && wheel.endsWith('.whl')) {
      await patchPipWheel(
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
  util.copyDirSync(
    path.join(pyBinRoot, 'Lib', 'site-packages', 'virtualenv'),
    path.join(pyBinRoot, 'Lib', 'site-packages', 'venv')
  );
}
