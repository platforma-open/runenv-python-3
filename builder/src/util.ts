import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { promisify } from 'util';
import { get } from 'https';
import * as unzipper from 'unzipper';

export const exec = promisify(cp.exec);

export type OS = 'macosx' | 'linux' | 'windows';
export type Arch = 'x64' | 'aarch64';

const defaultExecOpts = {
  env: {
    ...process.env,
    // Disable Python output buffering
    PYTHONUNBUFFERED: '1',
    // Disable pip progress bar buffering
    PIP_PROGRESS_BAR: 'off',
  }
};

export function currentOS(): OS {
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

export function currentArch(): Arch {
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

const pathFromMetaURL = (url: string) => {
  const p = new URL(url).pathname
  if (currentOS() === 'windows') {
    return p.slice(1); // /D:/a/b/c -> D:/a/b/c
  }

  return p;
}

// By using path.resolve, we get a stable, absolute path to the project root,
// which is always one level above the 'scripts' directory. This avoids
// fragile relative path calculations based on the current working directory,
// which can change depending on how the script is invoked.
const __dirname = path.dirname(pathFromMetaURL(import.meta.url));
export const scriptDir = path.resolve(__dirname);
export const builderDir = path.dirname(scriptDir);
export const repoRoot = path.dirname(builderDir);
export const packageRoot = process.cwd();
export const packageDirName = path.relative(repoRoot, packageRoot);
export const isInBuilderContainer = process.env['BUILD_CONTAINER'] == 'true';

export async function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[DEBUG] running '${[command, ...args].join("' '")}'...`);

    if (currentOS() === 'windows') {
      args = ['/c', `${command}`, ...args];
      command = 'cmd';
    }

    const child = cp.spawn(command, args, {
      ...defaultExecOpts,
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`command '${[command, ...args].join("' '")}' was killed with signal ${signal}`));
      } else if (code === null) {
        reject(new Error(`command '${[command, ...args].join("' '")}' exited with null exit code`));
      } else if (code > 0) {
        reject(new Error(`command '${[command, ...args].join("' '")}' exited with non-zero exit code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

export async function downloadFile(url: string, dest: string): Promise<void> {
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

export async function unzipFile(zipPath: string, destDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    console.log(`extracting '${zipPath}' to '${destDir}'`);

    const readStream = fs.createReadStream(zipPath);
    readStream
      .pipe(unzipper.Extract({ path: destDir }))
      .on('close', () => resolve())
      .on('error', (err: any) => reject(err));
  });
}

export function copyDirSync(src: string, dest: string): void {
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

// Ensure the directory exists and is empty
export function emptyDirSync(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}


// TODO: share this with r-builder
export function uniq(list: string[]): string[] {
  return [...new Set(list)];
}

// TODO: share this with r-builder
export function run(command: string, opts: { env?: Record<string, string> } = {}): string {
  const processOpts: cp.ExecSyncOptions = {
    ...opts,
    env: {
      ...process.env,
      ...opts.env,
    },
    stdio: 'pipe'
  }

  const stdout = cp.execSync(command, processOpts);
  return stdout.toString();
}

// TODO: share this with r-builder
export function runInherit(command: string, opts: { env?: Record<string, string> } = {}): void {
  const processOpts: cp.ExecSyncOptions = {
    ...opts,
    env: {
      ...process.env,
      ...opts.env,
    },
    stdio: 'inherit'
  }
  cp.execSync(command, processOpts);
}

// TODO: share this with r-builder
export type filterRule = ((n: string) => boolean) | RegExp;
export function applyFilter(filter: filterRule, file: string): boolean {
  return (typeof filter === 'function' && filter(file)) ||
    (filter instanceof RegExp && filter.test(file));
}
export function findFiles(dir: string, filter: filterRule, type: 'file' | 'dir' | 'any' = 'file'): string[] {
  let results: string[] = [];

  const selectDirs = type === 'dir' || type === 'any';
  const selectFiles = type === 'file' || type === 'any';

  const list = fs.readdirSync(dir);
  list.forEach((item) => {
    const filePath = path.join(dir, item);
    const stat = fs.statSync(filePath);

    if (!stat.isDirectory()) {
      if (selectFiles && applyFilter(filter, item)) {
        results.push(filePath);
      }
      return;
    }

    // Item is directory here
    if (selectDirs && applyFilter(filter, item)) {
      results.push(path.resolve(filePath));
    }

    results = results.concat(findFiles(filePath, filter, type));
  });

  return uniq(results);
}
