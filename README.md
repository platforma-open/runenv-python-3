# Python 3 Run Environments for Platforma

This package provides multiple Python runtime environments for Platforma Backend, supporting different Python versions with shared build configuration and version-specific overrides.

## Supported Python Versions

- **Python 3.12.10** - Latest stable version with newest package compatibility
- **Python 3.11.9** - LTS version with broad package support
- **Python 3.10.18** - Legacy version for older package compatibility

## Architecture

This project uses a **monorepo structure** similar to the Java Corretto setup:

```
runenv-python-3/
├── shared-config.json          # Shared configuration for all versions
├── python-3.12.10/            # Python 3.12.10 specific package
│   ├── config.json            # Version-specific overrides
│   └── package.json           # Package metadata
├── python-3.11.9/             # Python 3.11.9 specific package
│   ├── config.json            # Version-specific overrides
│   └── package.json           # Package metadata
├── python-3.10.18/            # Python 3.10.18 specific package
│   ├── config.json            # Version-specific overrides
│   └── package.json           # Package metadata
├── scripts/                   # Build and publish scripts
├── scripts/config-merger.js   # Configuration merger utility
└── package.json               # Root package with all entrypoints
```

## Configuration System

### Shared Configuration (`shared-config.json`)

Contains common settings for all Python versions:
- **Registries**: PyPI mirrors and additional sources
- **Build settings**: Timeouts, logging, parallel downloads
- **Platform-specific rules**: Skip/force source rules for different platforms
- **Common dependencies**: Base package list

### Version-Specific Configuration (`python-<version>/config.json`)

Each Python version can override shared settings:
- **Package overrides**: Version-specific package versions
- **Additional skip rules**: Version-specific exclusions
- **Custom dependencies**: Version-specific package lists

### Configuration Merging

The `config-merger.js` utility:
1. Loads shared configuration
2. Loads version-specific configuration
3. Merges settings with version-specific overrides taking precedence
4. Validates the final configuration

## Configuration Details

### Configuration Files

- **shared-config.json**: Contains common settings for all Python versions (registries, dependencies, platform rules, build options).
- **python-<version>/config.json**: Contains version-specific overrides (dependencies, overrides, skip/force rules for that version).

### Configuration Structure

#### shared-config.json
```json
{
  "registries": {
    "default": ["https://pypi.nvidia.com"],
    "additional": []
  },
  "packages": {
    "dependencies": [
      "pandas==2.2.3",
      "numpy==2.2.6",
      "scipy==1.15.3"
    ],
    "skip": { ... },
    "forceSource": { ... },
    "platformSpecific": { ... }
  },
  "build": {
    "enableLogging": true,
    "parallelDownloads": false,
    "timeout": 300
  }
}
```

#### python-<version>/config.json
```json
{
  "packages": {
    "dependencies": [ ... ],
    "overrides": { ... },
    "skip": { ... },
    "forceSource": { ... },
    "platformSpecific": { ... }
  }
}
```

- You only need to specify fields you want to override for a specific version.
- If you omit `dependencies`, the shared ones are used.
- If you provide `overrides`, only those packages are version-overridden.

### Package Exceptions

The build system supports intelligent package handling with three types of exceptions:

#### 1. Skip Packages
Packages that should be completely skipped for specific platforms:

```json
{
  "packages": {
    "skip": {
      "cudf-cu12": {
        "macosx-x64": "CUDA packages not supported on macOS",
        "macosx-aarch64": "CUDA packages not supported on macOS",
        "windows-x64": "CUDA packages not supported on Windows"
      }
    }
  }
}
```

#### 2. Force Source Build
Packages that should always be built from source for specific platforms:

```json
{
  "packages": {
    "forceSource": {
      "parasail": {
        "linux-aarch64": "parasail has no binary wheels for Linux ARM64",
        "macosx-aarch64": "parasail has no binary wheels for macOS ARM64"
      }
    }
  }
}
```

#### 3. Platform-Specific Configuration
Advanced configuration with custom actions:

```json
{
  "packages": {
    "platformSpecific": {
      "tensorflow": {
        "linux-aarch64": {
          "action": "skip",
          "reason": "TensorFlow has limited ARM64 support"
        },
        "macosx-aarch64": {
          "action": "forceSource",
          "reason": "TensorFlow ARM64 builds are experimental"
        }
      }
    }
  }
}
```

### Platform Keys

Platform keys follow the format: `{os}-{arch}`

- `linux-x64` - Linux AMD64
- `linux-aarch64` - Linux ARM64
- `macosx-x64` - macOS Intel
- `macosx-aarch64` - macOS Apple Silicon
- `windows-x64` - Windows AMD64

### Build Options

```json
{
  "build": {
    "enableLogging": true,
    "parallelDownloads": false,
    "timeout": 300
  }
}
```

- **enableLogging**: Enable detailed build logging
- **parallelDownloads**: Enable parallel package downloads (experimental)
- **timeout**: Build timeout in seconds

## Usage

### Building All Versions
```bash
pnpm build
```

### Building Specific Version
```bash
pnpm build:3.12.10
pnpm build:3.11.9
pnpm build:3.10.18
```

### Publishing All Versions
```bash
pnpm publish:packages
```

### Publishing Specific Version
```bash
pnpm publish:3.12.10
pnpm publish:3.11.9
pnpm publish:3.10.18
```

### Cleanup
```bash
pnpm cleanup
```

### Direct Script Usage
```bash
# Build a specific Python version
node scripts/build.js 3.12.10
```

The script will automatically merge `shared-config.json` and `python-3.12.10/config.json`.

## Adding a New Python Version

1. **Create version directory**:
   ```bash
   mkdir python-3.13.0
   ```

2. **Create version-specific config** (`python-3.13.0/config.json`):
   ```json
   {
     "packages": {
       "overrides": {
         "numpy": "2.3.0"
       }
     }
   }
   ```

3. **Create package.json** (`python-3.13.0/package.json`):
   ```json
   {
     "name": "@platforma-open/milaboratories.runenv-python-3.13.0",
     "version": "1.0.0",
     "scripts": {
       "build": "node ../scripts/build.js 3.13.0",
       "publish:packages": "node ../scripts/publish.js 3.13.0"
     }
   }
   ```

4. **Update workspace** (`pnpm-workspace.yaml`):
   ```yaml
   packages:
     - python-3.13.0
   ```

5. **Update root package.json** entrypoints

6. **Test the build**:
   ```bash
   pnpm build:3.13.0
   ```

## Package Compatibility

Each Python version has different package compatibility:

### Python 3.12.10
- Latest package versions
- Full CUDA support
- Experimental TensorFlow ARM64 builds

### Python 3.11.9
- Stable package versions
- Limited TensorFlow ARM64 support
- Full CUDA support

### Python 3.10.18
- Legacy package versions
- No TensorFlow ARM64 support
- Limited CUDA support on ARM64

## Platform Support

All versions support:
- **Linux**: x64, aarch64
- **macOS**: x64, aarch64
- **Windows**: x64

## Development

### Prerequisites
- Node.js >= 20
- pnpm >= 9.14.4

### Setup
```bash
pnpm install
```

### Development Workflow
1. Make changes to shared or version-specific configs
2. Test with `pnpm build:<version>`
3. Run full build with `pnpm build`
4. Publish with `pnpm publish:packages`

## Best Practices

### Configuration
- **Be specific**: Only add exceptions when absolutely necessary
- **Document reasons**: Always provide clear explanations for why exceptions exist
- **Test thoroughly**: Verify that exceptions work on all affected platforms
- **Keep updated**: Remove exceptions when packages add support for new platforms
- **Use simple configs**: Prefer `skip` and `forceSource` over `platformSpecific` when possible

### Package Management
- **Version Management**: Keep supported versions up to date
- **Registry Selection**: Only include registries you trust and need
- **Package Exceptions**: Document clear reasons for all exceptions
- **Configuration Reuse**: Create version-specific configs for different needs
- **Validation**: Test configurations on all target platforms

## Troubleshooting

### Configuration Loading Issues
1. Check that config files are valid JSON
2. Verify the files are in the correct locations
3. Check file permissions
4. Look for console warnings during build startup

### Version Validation
The build will warn if you try to build an unsupported Python version.

### Registry Issues
If packages fail to download, check:
1. Registry URLs are accessible
2. Registry URLs are in the correct format
3. Network connectivity to all registries

### Package Exception Issues
If the build fails to load the exceptions configuration:
1. Check that config files are valid JSON
2. Verify the files are in the correct locations
3. Check file permissions
4. Look for console warnings during build startup

The build will continue with an empty configuration if the files cannot be loaded.

## Notes

- There is no longer a `python` section or a single `build-config.json`.
- No config override file is needed; the system is automatic.
- The build system automatically tries binary wheels first, then falls back to source builds.
- Multiple PyPI registries are supported via configuration.
