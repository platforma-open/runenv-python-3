// MSVC activation for Windows buildWheel calls.
//
// Plain setuptools / distutils ("python setup.py build_ext" or
// "pip wheel <pkg>" against a sdist) calls into setuptools' MSVC compiler
// shim, which finds `cl.exe` via the Microsoft installer registry plus
// well-known paths under VS. On the GitHub Actions windows-latest runner
// the VS 2022 Build Tools are installed, but the env vars that
// vcvarsall.bat normally sets (INCLUDE / LIB / LIBPATH / PATH plus a few
// others) are missing, so setuptools' lookup fails with:
//
//     error: Microsoft Visual C++ 14.0 or greater is required.
//
// kalign-python sidesteps the issue by going through scikit-build-core +
// cmake + clang-cl, where cmake handles toolchain discovery itself.
// freesasa's source ships a plain setup.py and we'd rather not fork it,
// so we instead resolve the vcvars env once per build and merge it into
// the `pip wheel` subprocess. The activation is opt-in via a
// `needsMsvc: true` flag on the package's buildWheel entry, so any
// package without the flag (today: only kalign-python on Windows) is
// completely unaffected.

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Arch, currentOS } from './util';

// Memoize per-arch: vcvarsall is slow (~3-5s) and re-running it for the
// same arch within a single build job is wasteful.
const cache = new Map<string, NodeJS.ProcessEnv>();

// Map our internal arch label to the vcvarsall argument. vcvarsall uses
// `amd64` for 64-bit Intel/AMD; `arm64` for AArch64. We don't currently
// build a Windows ARM runenv, so `aarch64` is here for future-proofing.
const VCVARS_ARCH: Record<Arch, string> = {
  x64: 'amd64',
  aarch64: 'arm64',
};

// vswhere is shipped with VS Installer 2017+ and is on every GitHub
// Actions windows-* runner. Resolve via the `ProgramFiles(x86)` env var
// rather than hardcoding `C:\` since the system drive may differ (e.g.
// self-hosted runners with Windows on D:); fall back to the conventional
// path only when the env var is missing.
function vswherePath(): string {
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
}

function findVcvarsallBat(): string {
  const VSWHERE = vswherePath();
  if (!fs.existsSync(VSWHERE)) {
    throw new Error(`vswhere.exe not found at ${VSWHERE}; cannot activate MSVC.`);
  }
  // Latest VS install that has the C++ toolset. The `Component.VC.Tools.x86.x64`
  // GUID covers both x86 and x64 toolchains; on a Windows ARM runner we would
  // additionally need `Component.VC.Tools.ARM64`, but vswhere matches any of
  // the listed components by default so passing just the x64 component does
  // not exclude an ARM-only install. Cross-arch builds are still possible
  // because vcvarsall.bat itself selects the toolset via its first argument.
  const out = cp.execFileSync(VSWHERE, [
    '-latest',
    '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath',
  ], { encoding: 'utf8' }).trim();
  if (!out) {
    throw new Error('vswhere returned no VS install with a C++ toolset; install VS Build Tools 2017+.');
  }
  const bat = path.join(out, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat');
  if (!fs.existsSync(bat)) {
    throw new Error(`vcvarsall.bat not found at ${bat}; the VS install at ${out} may be incomplete.`);
  }
  return bat;
}

// Run `vcvarsall.bat <arch> && set`, parse the resulting env dump, and
// return the keys that changed (or were added) relative to the current
// process env. Returning the *delta* (instead of the full activated env)
// keeps the merge clean: cmd's env values that don't change roundtrip
// through `set` would otherwise overwrite identical entries from
// process.env, occasionally with subtly different casing/quoting.
//
// `cp.execSync` runs the command via the system shell (cmd.exe on
// Windows). Pass the command directly: wrapping in `cmd /c
// JSON.stringify(...)` breaks quoting because cmd does not honor JSON's
// backslash-quote escapes. Stderr is intentionally inherited so any
// vcvarsall.bat error (e.g. unsupported arch on a host without that
// toolset) surfaces in the CI log instead of getting swallowed by 2>&1.
function captureVcvarsEnv(vcvarsall: string, arch: string): NodeJS.ProcessEnv {
  const cmd = `"${vcvarsall}" ${arch} >NUL && set`;
  const out = cp.execSync(cmd, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  // Case-insensitive lookup of the current env so we only return what
  // actually changed. Windows env vars are case-insensitive at the OS
  // level but Node preserves the original case in process.env.
  const current = new Map<string, string>();
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) current.set(k.toUpperCase(), v);
  }
  const delta: NodeJS.ProcessEnv = {};
  for (const line of out.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    const val = line.slice(eq + 1);
    if (current.get(key.toUpperCase()) !== val) {
      delta[key] = val;
    }
  }
  return delta;
}

export async function resolveMsvcEnv(arch: Arch): Promise<NodeJS.ProcessEnv> {
  if (currentOS() !== 'windows') return {};
  const key = `${arch}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const vcvarsArch = VCVARS_ARCH[arch];
  if (!vcvarsArch) {
    throw new Error(`No vcvarsall arch mapping for ${arch}.`);
  }
  const vcvarsall = findVcvarsallBat();
  console.log(`[msvc] Activating MSVC (${vcvarsArch}) via ${vcvarsall}`);
  const delta = captureVcvarsEnv(vcvarsall, vcvarsArch);
  console.log(`[msvc] ${Object.keys(delta).length} env vars added/changed (INCLUDE, LIB, LIBPATH, PATH, plus VS-internal markers).`);
  cache.set(key, delta);
  return delta;
}
