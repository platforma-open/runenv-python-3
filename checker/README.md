# Native Import Checker

A tool that validates Python wheel packages by testing all native module imports. Ensures package compatibility across different platforms and glibc versions.

## Quick Start

```bash
# Basic usage
./bin/python check_native_imports.py

# With whitelist
./bin/python check_native_imports.py whitelist.json
```

The checker will auto-discover packages, test all native extensions, and report results.

## Features

- Auto-discovers wheel packages from `../packages` directory
- Tests all native extensions (`.so`/`.pyd` files)
- Cross-platform support (Linux, macOS, Windows)
- Whitelist support for known issues
- Generates JSON snippets for easy whitelist updates

## How It Works

### Testing Flow

1. Scans wheel files for native extensions
2. Creates temporary venv for each wheel
3. Installs wheel with local dependencies
4. Attempts to import each native module
5. Reports results with whitelist suggestions

### CI Integration

The checker runs automatically during the build process. Integration point in `builder/src/build.ts`:

```typescript
async function loadPackages(installDir: string, osType: util.OS, archType: util.Arch): Promise<void> {
  // ... download packages ...
  // ... copy files ...
  
  // Run native import checker after all packages are loaded
  await runNativeImportChecker(installDir, osType, archType);
}
```

All checker output is forwarded to CI logs in real-time via `stdio: 'inherit'`.

## Whitelist Format

Suppress known/acceptable errors with a JSON whitelist:

```json
{
  "package-1.0.0-cp312-manylinux_2_28_aarch64.whl": {
    "module.name": "error substring"
  }
}
```

**Key points:**

- Error matching is case-insensitive substring matching
- Whitelist files are organized by variant and platform: `whitelists/{variant}/{platform}.json`
- Empty objects (`{}`) are valid (no errors whitelisted)

### Platform Keys

| OS Type | Arch Type | Platform Key    | CI Runner           |
|---------|-----------|-----------------|---------------------|
| windows | x64       | windows-x64     | windows-latest      |
| linux   | x64       | linux-x64       | ubuntu-large-amd64  |
| linux   | aarch64   | linux-aarch64   | ubuntu-large-arm64  |
| macosx  | x64       | macosx-x64      | macos-15-intel      |
| macosx  | aarch64   | macosx-aarch64  | macos-14            |

## Usage

### Local Testing

```bash
# Navigate to Python variant directory
cd python-3.12.10

# Build (automatically runs checker)
pnpm run build

# Or run checker manually after build
../pydist/linux-x64/bin/python ../checker/check_native_imports.py ../checker/whitelists/python-3.12.10/linux-x64.json
```

### Docker Testing (Old glibc)

Test on Rocky Linux 8:

```bash
docker run --rm -ti --platform linux/arm64 \
  -v ~/python-portable:/opt/python \
  rockylinux:8 \
  /opt/python/bin/python /path/to/check_native_imports.py
```

### Handling CI Failures

When non-whitelisted errors occur:

1. Build fails with exit code 1
2. Error details shown in CI logs
3. Whitelist snippet generated automatically
4. Copy snippet to appropriate whitelist file
5. Commit and push changes
6. Re-run build

## Exit Codes

- `0` - Success (including whitelisted errors)
- `1` - Non-whitelisted failures
