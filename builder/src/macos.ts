import path from 'path';
import fs from 'fs';
import * as util from './util';

async function isBinary(filePath: string): Promise<boolean> {
  const { stdout } = await util.exec(`file --no-dereference ${filePath}`);
  const attributes = stdout.split(':')[1].trim().split(' ');
  return (
    attributes.includes('Mach-O') ||
    (attributes.includes('executable') && !attributes.includes('script'))
  );
}

async function alterLibLoadPath(binary: string, oldLibPath: string, newLibPath: string): Promise<void> {
  console.log(`\tPatching library '${oldLibPath}' load path in '${binary}'...`);
  await util.exec(`install_name_tool -change ${oldLibPath} ${newLibPath} ${binary}`);
}

async function listLibsOSX(binPath: string): Promise<string[]> {
  const { stdout } = await util.exec(`otool -L ${binPath}`);

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

export async function consolidateLibsOSX(installDir: string): Promise<void> {
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

    if (!(await isBinary(binaryPath))) {
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

      alterLibLoadPath(
        binaryPath,
        lib,
        `@executable_path/../lib/${libName}`
      );
      return;
    }
  }
}
