import * as path from 'path';
import * as fs from 'fs';
import * as util from './util';

// TODO: share this with r-builder
export function getBinDependencies(binaryFile:string): string[] {
  const output = util.run(`ldd '${binaryFile}'`).toString();
  /*
    The output of ldd looks like this:
      linux-vdso.so.1 (0x00007f2f6859d000)
      libRblas.so => not found
      libm.so.6 => /lib/x86_64-linux-gnu/libm.so.6 (0x00007f2f684ac000)
      libreadline.so.8 => not found
      libpcre2-8.so.0 => /lib/x86_64-linux-gnu/libpcre2-8.so.0 (0x00007f2f67f66000)
      liblzma.so.5 => /lib/x86_64-linux-gnu/liblzma.so.5 (0x00007f2f6847a000)
      libbz2.so.1.0 => /lib/x86_64-linux-gnu/libbz2.so.1.0 (0x00007f2f68464000)
      libz.so.1 => /lib/x86_64-linux-gnu/libz.so.1 (0x00007f2f67f4a000)
      libtirpc.so.3 => not found
      libicuuc.so.70 => not found
      libicui18n.so.70 => not found
      libgomp.so.1 => not found
      libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f2f67c00000)
      /lib64/ld-linux-x86-64.so.2 (0x00007f2f6859f000)
  */

  // Split by every space symbol. Lines that start with '/' are most likely absolute paths to libraries.
  return util.uniq(
    output
      .split(/\s/)
      .filter((l) => l.startsWith('/'))
  );
}

// TODO: share this with r-builder
export function collectSoLibs(binaryFiles: string[], libsDir: string, libsToIgnore: util.filterRule[]): string[] {
  const allDependencies = new Set<string>();

  binaryFiles.forEach((binaryFile) => {
    console.log(`[DEBUG] Loading library dependencies of '${binaryFile}'`);

    libLoop: for (const libPath of getBinDependencies(binaryFile)) {
      if (path.resolve(libPath).startsWith(path.resolve(libsDir))) {
        continue libLoop; // already in desired libs dir
      }

      for (const ignoreRule of libsToIgnore) {
        if (
          (typeof ignoreRule === 'function' && ignoreRule(libPath)) ||
          (ignoreRule instanceof RegExp && ignoreRule.test(libPath))
        ) {
          continue libLoop; // lib is ignored
        }
      }

      allDependencies.add(libPath);
    }
  });

  const collectedLibs = Array.from(allDependencies);

  for (const libPath of collectedLibs) {
    console.log(`[DEBUG]  copying '${libPath}'`);
    const targetPath = path.join(libsDir, path.basename(libPath));
    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(libPath, targetPath);
    }
  }

  return collectedLibs;
}

// TODO: share this with r-builder
const systemLibs = [
  // Don't include glibc standard libraries and libstdc++ into the final distribution.
  // We MUST use system glibc to avoid compatibility issues between system and Python runtime.
  // To keep integrity of glibc libraries set, we have to avoid including its parts into our bundle.
  /libc\.so(\.[0-9.]+)?$/,
  /libstdc\+\+\.so(\.[0-9.]+)?$/,
  /libBrokenLocale\.so(\.[0-9.]+)?$/,
  /libanl\.so(\.[0-9.]+)?$/,
  /libc_malloc_debug\.so(\.[0-9.]+)?$/,
  /libdl\.so(\.[0-9.]+)?$/,
  /libm\.so(\.[0-9.]+)?$/,
  /libmemusage\.so(\.[0-9.]+)?$/,
  /libmvec\.so(\.[0-9.]+)?$/,
  /libnsl\.so(\.[0-9.]+)?$/,
  /libnss_compat\.so(\.[0-9.]+)?$/,
  /libnss_dns\.so(\.[0-9.]+)?$/,
  /libnss_files\.so(\.[0-9.]+)?$/,
  /libnss_hesiod\.so(\.[0-9.]+)?$/,
  /libpcprofile\.so(\.[0-9.]+)?$/,
  /libpthread\.so(\.[0-9.]+)?$/,
  /libresolv\.so(\.[0-9.]+)?$/,
  /librt\.so(\.[0-9.]+)?$/,
  /libthread_db\.so(\.[0-9.]+)?$/,
  /libutil\.so(\.[0-9.]+)?$/,

  // Don't include Core libraries that are not part of glibc, but known to be highly
  // dependent on linux core and are known to exist on most of the systems.
  /ld-linux-x86-64\.so(\.[0-9.]+)?$/,
  /libcom_err\.so(\.[0-9.]+)?$/,
  /libcrypt\.so(\.[0-9.]+)?$/,
  /libselinux\.so(\.[0-9.]+)?$/,
  /libacl\.so(\.[0-9.]+)?$/,
  /libattr\.so(\.[0-9.]+)?$/,
  /libblkid\.so(\.[0-9.]+)?$/,
  /libmount\.so(\.[0-9.]+)?$/,

  // Security and authentication libraries
  /libpam\.so(\.[0-9.]+)?$/,
  /libaudit\.so(\.[0-9.]+)?$/,
  /libcap\.so(\.[0-9.]+)?$/,

  // System management libraries
  /libsystemd\.so(\.[0-9.]+)?$/,
  /libudev\.so(\.[0-9.]+)?$/,
  /libapparmor\.so(\.[0-9.]+)?$/,
];

/**
 * Collect all system libraries used by python binary and all its standard module libraries
 */
export function consolidateLibs(installDir: string, patchElf: boolean = false) {
  console.log('[DEBUG] Collecting libraries to make python standard modules portable');

  // Select correct libs directory (i.e. lib/python3.12)
  const pyLibs = util.findFiles(path.join(installDir, 'lib'), /python[\d]+\.[\d]+/, 'dir')[0];
  const libsDir = path.join(pyLibs, 'lib-dynload'); // lib/python3.12/lib-dynload/ keeps all .so for std modules, like 'ctypes'
  
  const allLibs = util.findFiles(installDir, /\.so(\.[0-9.]+)?$/, 'file');
  const executables = [path.resolve(installDir, 'bin/python')];

  console.log(`[DEBUG] Executables to process:\n  ${executables.join('\n  ')}`);
  console.log(`[DEBUG] Python dynamic libraries directory: '${libsDir}'`);
  
  const collected = collectSoLibs(
    [...executables, ...allLibs],
    libsDir,
    systemLibs
  );
  console.log(
    `[DEBUG] Libraries collected into '${libsDir}':\n  ${collected.join('\n  ')}`
  );

  if (patchElf) {
    for (const binName of [...executables]) {
      const relativeLibLocation = path.relative(path.dirname(binName), libsDir);
      const newRPath = `$ORIGIN/${relativeLibLocation}`;
      console.log(`[DEBUG]  patching ELF in '${binName}' (rpath = '${newRPath}')...`);
      patchBinElf(binName, newRPath);
    }

    for (const libPath of [...allLibs]) {
      const newRPath = `$ORIGIN/.`;
      console.log(`[DEBUG]  patching ELF in '${libPath}' (rpath = '${newRPath}')...`);
      patchBinElf(libPath, newRPath);
    }
  }
}

// TODO: share this with r-builder
/**
 * Patch binary file updating its RPATH
 */
function patchBinElf(binaryFile: string, rpath: string) {
  util.runInherit(`patchelf --remove-rpath '${binaryFile}'`);
  util.runInherit(`patchelf --set-rpath '${rpath}' '${binaryFile}'`);
}
