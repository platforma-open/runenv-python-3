# Whitelists Directory Structure

This directory contains platform-specific whitelists for the native import checker. Whitelists are organized hierarchically by Python variant and platform.

## Directory Structure

```
whitelists/
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

## Platform Keys

The platform keys are derived from the build matrix and follow the pattern `{osType}-{archType}`:

| OS Type | Arch Type | Platform Key | CI Runner |
|---------|-----------|--------------|-----------|
| windows | amd64     | windows-amd64 | windows-latest |
| linux   | amd64     | linux-amd64   | ubuntu-large-amd64 |
| linux   | arm64     | linux-arm64   | ubuntu-large-arm64 |
| macosx  | amd64     | macosx-amd64  | macos-15-intel |
| macosx  | arm64     | macosx-arm64  | macos-14 |

## Usage

During the build process, the checker automatically selects the appropriate whitelist based on:
1. The package directory name (e.g., `python-3.12.10`)
2. The current platform (detected from OS and architecture)

The path is constructed as: `checker/whitelists/{packageDirName}/{osType}-{archType}.json`

## Whitelist Format

Each whitelist file is a JSON object mapping wheel filenames to module-error pairs:

```json
{
  "package-1.0.0-cp312-manylinux_2_28_aarch64.whl": {
    "module.name": "error substring to match"
  },
  "another-package-2.0.0-cp312-win_amd64.whl": {
    "some.native.module": "cannot open shared object file"
  }
}
```

Error matching is case-insensitive and uses substring matching.

## Build Integration

The native import checker runs automatically after packages are downloaded in the build process:

1. Build script downloads all packages
2. Copies version-specific files
3. Runs `check_native_imports.py` with the appropriate whitelist
4. Reports results (failures cause build to fail unless whitelisted)

The checker's stdout/stderr is forwarded directly to the build logs for visibility.

## Maintenance

- Empty JSON objects (`{}`) are valid whitelists (no errors are whitelisted)
- Add entries as needed when platform-specific issues are discovered
- The checker will warn about unused whitelist entries that can be removed
- When errors are encountered, the checker automatically generates JSON snippets for easy whitelist updates

