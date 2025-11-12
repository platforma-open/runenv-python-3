import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { promisify } from 'util';
import { get } from 'https';
import * as unzipper from 'unzipper';

export const exec = promisify(cp.exec);

// By using path.resolve, we get a stable, absolute path to the project root,
// which is always one level above the 'scripts' directory. This avoids
// fragile relative path calculations based on the current working directory,
// which can change depending on how the script is invoked.
const __dirname = path.dirname(new URL(import.meta.url).pathname.slice(1));
export const scriptDir = path.resolve(__dirname);
export const builderDir = path.dirname(scriptDir);
export const repoRoot = path.dirname(builderDir);
export const packageRoot = process.cwd();
export const packageDirName = path.relative(repoRoot, packageRoot);
export const isInBuilderContainer = process.env['BUILD_CONTAINER'] == 'true';

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

export async function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`running: '${[command, ...args].join("' '")}'...`);

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
