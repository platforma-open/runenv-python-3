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

export async function runCommand(command: string, args: string[], opts: { timeoutMs?: number; captureToFile?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[DEBUG] running '${[command, ...args].join("' '")}'...`);

    if (currentOS() === 'windows') {
      args = ['/c', `${command}`, ...args];
      command = 'cmd';
    }

    // When capturing, pipe stdout/stderr through this process (so the parent's
    // log captures grandchild output that 'inherit' would route past it) and
    // also persist it to a file we can tail if the command hangs/fails.
    const capture = !!opts.captureToFile;
    const captureStream = capture ? fs.createWriteStream(opts.captureToFile!, { flags: 'w' }) : undefined;

    const child = cp.spawn(command, args, {
      ...defaultExecOpts,
      stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    });

    if (capture) {
      const tee = (chunk: Buffer) => { process.stdout.write(chunk); captureStream!.write(chunk); };
      child.stdout?.on('data', tee);
      child.stderr?.on('data', tee);
    }

    // Guard against commands that hang indefinitely (e.g. a compiler stalling on
    // a kalign translation unit), which would otherwise keep the CI job alive
    // until the global GitHub timeout with no useful output.
    //
    // child.kill() only signals the direct child. On Windows that child is cmd.exe,
    // whose descendants (python -> pip -> cmake -> ninja -> the compiler) survive as
    // orphans and keep the step hung. Kill the whole process tree instead.
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        console.error(`[ERROR] command '${[command, ...args].join("' '")}' timed out after ${opts.timeoutMs}ms; killing process tree.`);
        if (currentOS() === 'windows' && child.pid !== undefined) {
          // /T = tree (kill children too), /F = force.
          cp.spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'inherit' });
        } else {
          child.kill('SIGKILL');
        }
      }, opts.timeoutMs);
      timer.unref?.();
    }

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      captureStream?.end();
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      captureStream?.end();
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

export async function downloadFile(url: string, dest: string, redirectsLeft = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`downloading '${url}' to '${dest}'`);
    get(url, (response) => {
      const status = response.statusCode ?? 0;

      // Follow redirects (e.g. nuget.org -> CDN). The original write stream must not
      // be created until we have a 200, otherwise a redirect would truncate dest.
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume(); // drain the redirect response
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects for '${url}'`));
          return;
        }
        const next = new URL(response.headers.location, url).toString();
        downloadFile(next, dest, redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (status !== 200) {
        response.resume();
        reject(new Error(`Failed to get '${url}' (${status})`));
        return;
      }

      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve());
      });
      file.on('error', (err) => reject(err));
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
