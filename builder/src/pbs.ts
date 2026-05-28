import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import * as util from './util';

// python-build-standalone release tag pinned in this repo.
// Each PBS release ships specific CPython patch versions; bump together with
// the python-version field in package.json when upgrading.
// Releases: https://github.com/astral-sh/python-build-standalone/releases
const PBS_RELEASE_TAG = '20250529';

function targetTriple(osType: util.OS, archType: util.Arch): string {
  switch (osType) {
    case 'macosx':
      return archType === 'aarch64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    case 'linux':
      return archType === 'aarch64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
    default:
      throw new Error(`python-build-standalone is not used for OS '${osType}' here`);
  }
}

/**
 * Download a relocatable CPython distribution from python-build-standalone
 * and extract it into installDir.
 *
 * PBS install_only tarballs are already relocatable: dylibs/sos use
 * @executable_path/$ORIGIN-relative load paths, pip is bundled, and the
 * directory layout matches `bin/`, `lib/python3.X/`, `include/python3.X/`.
 * No further consolidation or rpath patching is required.
 */
export async function getPortablePython(
  version: string,
  osType: util.OS,
  archType: util.Arch,
  installDir: string,
): Promise<void> {
  const triple = targetTriple(osType, archType);
  const fileName = `cpython-${version}+${PBS_RELEASE_TAG}-${triple}-install_only.tar.gz`;
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE_TAG}/${fileName}`;

  const stagingDir = path.dirname(installDir);
  const tarPath = path.join(stagingDir, fileName);

  console.log(`[PBS] Downloading ${url}`);
  await util.downloadFile(url, tarPath);

  // PBS tarballs always extract into a top-level `python/` directory.
  // Use a temp dir so we can rename it into place without colliding with
  // the staging dir's siblings.
  const tempExtractDir = path.join(stagingDir, `pbs-extract-${process.pid}`);
  if (fs.existsSync(tempExtractDir)) {
    fs.rmSync(tempExtractDir, { recursive: true });
  }
  fs.mkdirSync(tempExtractDir, { recursive: true });

  console.log(`[PBS] Extracting ${tarPath} to ${tempExtractDir}`);
  tar.x({ sync: true, file: tarPath, cwd: tempExtractDir });

  const extractedRoot = path.join(tempExtractDir, 'python');
  if (!fs.existsSync(extractedRoot)) {
    throw new Error(`PBS archive layout unexpected: ${extractedRoot} not found`);
  }

  util.emptyDirSync(installDir);
  // Move the extracted python/ contents into installDir
  for (const entry of fs.readdirSync(extractedRoot)) {
    fs.renameSync(path.join(extractedRoot, entry), path.join(installDir, entry));
  }

  fs.rmSync(tempExtractDir, { recursive: true });
  fs.rmSync(tarPath);

  console.log(`[PBS] CPython ${version} (${triple}, release ${PBS_RELEASE_TAG}) installed to ${installDir}`);
}
