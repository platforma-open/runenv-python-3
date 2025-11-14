# Native Import Checker - CI Integration

## Overview

The native import checker is now integrated into the build process and runs automatically after all packages are downloaded for each build matrix entry.

## How It Works

### Build Flow

1. **Package Download** - Build script downloads all wheel packages to `{installDir}/packages`
2. **Version-Specific Files** - Copies any platform-specific files
3. **Native Import Checker** - Automatically runs `check_native_imports.py` with the appropriate whitelist
4. **Result** - Build fails if any non-whitelisted import errors occur

### Integration Point

The checker is invoked in `builder/src/build.ts` within the `loadPackages()` function:

```typescript
async function loadPackages(installDir: string, osType: util.OS, archType: util.Arch): Promise<void> {
  // ... download packages ...
  // ... copy files ...
  
  // Run native import checker after all packages are loaded
  await runNativeImportChecker(installDir, osType, archType);
}
```

### Whitelist Selection

The checker automatically selects the correct whitelist based on:
- **Package Directory**: e.g., `python-3.12.10`, `python-3.12.10-atls`
- **Platform**: `{osType}-{archType}` (e.g., `linux-amd64`, `macosx-arm64`)

Whitelist path: `checker/whitelists/{packageDirName}/{osType}-{archType}.json`

## Build Matrix

The CI workflow defines 20 build matrix entries across 5 Python variants:

| Variant | Windows | Linux x64 | Linux ARM64 | macOS x64 | macOS ARM64 | Total |
|---------|---------|-----------|-------------|-----------|-------------|-------|
| python-3.12.10 | ✓ | ✓ | ✓ | ✓ | ✓ | 5 |
| python-3.12.10-atls | - | ✓ | - | - | ✓ | 2 |
| python-3.12.10-sccoda | ✓ | ✓ | ✓ | ✓ | ✓ | 5 |
| python-3.12.10-rapids | ✓ | ✓ | ✓ | ✓ | ✓ | 5 |
| python-3.12.10-h5ad | ✓ | ✓ | ✓ | ✓ | ✓ | 5 |

Each build entry gets its own whitelist file (22 total, including README).

## Whitelist Structure

```
checker/whitelists/
├── README.md
├── python-3.12.10/
│   ├── windows-amd64.json
│   ├── linux-amd64.json
│   ├── linux-arm64.json
│   ├── macosx-amd64.json
│   └── macosx-arm64.json
├── python-3.12.10-atls/
│   ├── linux-amd64.json
│   └── macosx-arm64.json
├── python-3.12.10-sccoda/
│   ├── windows-amd64.json
│   ├── linux-amd64.json
│   ├── linux-arm64.json
│   ├── macosx-amd64.json
│   └── macosx-arm64.json
├── python-3.12.10-rapids/
│   ├── windows-amd64.json
│   ├── linux-amd64.json
│   ├── linux-arm64.json
│   ├── macosx-amd64.json
│   └── macosx-arm64.json
└── python-3.12.10-h5ad/
    ├── windows-amd64.json
    ├── linux-amd64.json
    ├── linux-arm64.json
    ├── macosx-amd64.json
    └── macosx-arm64.json
```

## Stdout Forwarding

The checker's output is automatically forwarded to CI logs via the `runCommand()` function in `util.ts`, which uses `stdio: 'inherit'`. This means:

- ✅ All checker output appears in CI logs in real-time
- ✅ Progress indicators are visible
- ✅ Error messages and whitelist suggestions are captured
- ✅ Summary output is displayed

## Usage in CI

### Viewing Checker Output

1. Navigate to the GitHub Actions workflow run
2. Select the specific build matrix entry (e.g., "linux-amd64 - ./python-3.12.10")
3. Expand the "Run build for - ./python-3.12.10" step
4. Scroll to see checker output after package installation

### Handling Failures

When the checker detects non-whitelisted errors:

1. **Build fails** with exit code 1
2. **Error details** are shown in the CI logs
3. **Whitelist snippet** is generated automatically
4. **Action required**: Add the snippet to the appropriate whitelist file

Example checker output in CI:

```
[DEBUG] Running native import checker...
[DEBUG] Checker script: /path/to/checker/check_native_imports.py
[DEBUG] Whitelist: /path/to/checker/whitelists/python-3.12.10/linux-amd64.json

Starting wheel installation tests...
==================================================
Platform: Linux aarch64
Python: 3.12.10

Testing: numpy-2.0.0-cp312-manylinux_2_28_aarch64.whl
  ✓ Created venv
  ✓ Installed
  Found 5 native module(s) to test
  Testing import: numpy.core._multiarray_umath
  ✓ All imports successful

==================================================
Test Summary
==================================================
Total wheels tested: 115
Successful: 115
Failed: 0
==================================================
✓ All wheels installed and imported successfully!

[DEBUG] Native import checker completed
```

### Updating Whitelists

To add entries to a whitelist:

1. Copy the generated JSON snippet from CI logs
2. Edit the appropriate whitelist file (e.g., `checker/whitelists/python-3.12.10/linux-amd64.json`)
3. Commit and push the changes
4. Re-run the build

Example whitelist entry:

```json
{
  "torch-2.7.0+cpu-cp312-linux_aarch64.whl": {
    "functorch._C": "initialization failed"
  }
}
```

## Testing Locally

To test the checker locally before committing:

```bash
# Navigate to a Python variant directory
cd python-3.12.10

# Build (will automatically run checker)
pnpm run build

# Or run checker manually after build
../pydist/linux-amd64/bin/python ../checker/check_native_imports.py ../checker/whitelists/python-3.12.10/linux-amd64.json
```

## Maintenance

### Adding New Python Variants

When adding a new Python variant (e.g., `python-3.12.10-newvariant`):

1. Create whitelist directory: `checker/whitelists/python-3.12.10-newvariant/`
2. Add whitelist files for each platform in the build matrix
3. Initialize with empty JSON objects: `{}`

### Removing Unused Entries

The checker automatically identifies unused whitelist entries:

```
⚠️  Unused whitelist entries (can be removed):
  package-1.0.0.whl
    - some.module
```

Remove these entries to keep whitelists clean.

## Troubleshooting

### Checker Not Running

- Verify `checker/check_native_imports.py` exists
- Check build logs for "[DEBUG] Running native import checker..."

### Whitelist Not Found

- Verify whitelist file exists for the specific platform
- Check path: `checker/whitelists/{variant}/{os}-{arch}.json`
- Checker will run without whitelist but log a warning

### Build Hangs

- Check for import timeouts (120s per module)
- Some modules may hang during import - add timeout error to whitelist

### False Positives

Add to whitelist if the error is acceptable:
- Missing optional dependencies
- Platform-specific limitations
- Known ABI compatibility issues

