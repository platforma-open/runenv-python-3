# Python 3 Run Environments for Platforma

This package provides multiple Python runtime environments for Platforma Backend, supporting different Python versions with shared build configuration and version-specific overrides.

## Supported Python Versions

- **Python 3.12.10** - Latest stable version with newest package compatibility
- **Python 3.12.10-atls** - A variant of 3.12.10 with custom ATLS packages.
- **Python 3.10.11** - Legacy version for older package compatibility

## Architecture

This project uses a **monorepo structure** similar to the Java Corretto setup:

```
runenv-python-3/
├── shared-config.json          # Shared configuration for all versions
├── python-3.12.10/            # Python 3.12.10 specific package
│   ├── config.json            # Version-specific overrides
│   └── package.json           # Package metadata
├── python-3.10.11/            # Python 3.10.11 specific package
│   ├── config.json            # Version-specific overrides
│   └── package.json           # Package metadata
├── catalogue/                  # Main package referencing all versions
├── scripts/                   # Build and publish scripts
├── scripts/config-merger.js   # Configuration merger utility
└── package.json               # Root package with all entrypoints
```

## Configuration System

### Shared Configuration (`shared-config.json`)

Contains common settings for all Python versions:
- **Registries**: PyPI.org as default with NVIDIA PyPI as additional source
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

- **shared-config.json**: Contains common settings for all Python versions (registries with PyPI.org as default and NVIDIA PyPI as additional, dependencies, platform rules, build options).
- **python-<version>/config.json**: Contains version-specific overrides (dependencies, overrides, skip/force rules for that version).

### Configuration Structure

#### shared-config.json
```json
{
  "registries": {
    "additional": ["https://pypi.nvidia.com"]
  },
  "packages": {
    "dependencies": [
      "pandas==2.2.3",
      "numpy==2.2.6",
      "scipy==1.15.3"
    ],
    "skip": { ... },
    "forceSource": { ... }
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
    "forceSource": { ... }
  }
}
```

- You only need to specify fields you want to override for a specific version.
- If you omit `dependencies`, the shared ones are used.
- If you provide `overrides`, only those packages are version-overridden.

### Package Exceptions

The build system supports intelligent package handling with two types of exceptions:

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

### Building Specific Version or Variant
```bash
# Using Turbo filter
pnpm build --filter=@platforma-open/milaboratories.runenv-python-3.12.10
pnpm build --filter=@platforma-open/milaboratories.runenv-python-3.12.10-atls
pnpm build --filter=@platforma-open/milaboratories.runenv-python-3.10.11

# Direct script usage
node scripts/build.js 3.12.10
node scripts/build.js 3.12.10-atls
node scripts/build.js 3.10.11
```

### Publishing
```bash
# Publish all packages
pnpm postbuild-publish

# Publish specific version (from version directory)
cd python-3.12.10 && pnpm postbuild-publish
cd python-3.10.11 && pnpm postbuild-publish
```

### Cleanup
```bash
pnpm cleanup
```

The script will automatically merge `shared-config.json` and `python-<version>/config.json`.

### Injecting Custom Files (`copyFiles`)

For advanced use cases, such as creating version variants with pre-compiled binaries or custom modules, the build system supports a `copyFiles` directive in the `config.json`.

This allows you to copy files and directories from your package source into the final Python environment during the build.

#### Configuration

The `copyFiles` directive is an array of objects, where each object specifies a `from` and `to` path.

- `from`: The source path, relative to the package directory (e.g., `python-3.12.10-atls/`).
- `to`: The destination path, relative to the root of the installed Python environment (e.g., `pydist/linux-x64/`).

#### Dynamic `site-packages` Path

The system provides a special placeholder, `{site-packages}`, which automatically resolves to the correct `site-packages` directory for the current Python version and OS. This is the recommended way to install custom Python modules.

#### Example (`python-3.12.10-atls/config.json`)

This configuration copies custom binaries to the `bin/` directory and Python modules to the `site-packages` directory for each platform.

```json
{
  "packages": {
    "dependencies": [
      "torch==2.7.0",
      "ImmuneBuilder==1.2"
    ],
    "platformSpecific": {
      "linux-x64": {
        "copyFiles": [
          { "from": "linux-x64/bin/", "to": "bin/" },
          { "from": "linux-x64/site-packages/", "to": "{site-packages}/" }
        ]
      },
      "macosx-aarch64": {
        "copyFiles": [
          { "from": "macosx-aarch64/bin/", "to": "bin/" },
          { "from": "macosx-aarch64/site-packages/", "to": "{site-packages}/" }
        ]
      }
    }
  }
}
```

The source files for this example would be structured as follows:

```
python-3.12.10-atls/
├── linux-x64/
│   ├── bin/
│   │   └── custom_tool
│   └── site-packages/
│       └── custom_module/
│           └── __init__.py
├── macosx-aarch64/
│   ├── bin/
│   └── site-packages/
└── config.json
```


## Adding a New Python Version or Variant

To add a new standard Python version or a custom variant, follow these steps.

1.  **Create the Package Directory**:
    The directory name defines the version string. Use a suffix for variants.
    ```bash
    # For a standard version
    mkdir python-3.13.0

    # For a custom variant
    mkdir python-3.13.0-custom
    ```

2.  **Create Version-Specific `config.json`**:
    Inside the new directory, create a `config.json`.
    - For a **standard version**, you can start with an empty config or specify overrides.
    - For a **variant**, this is where you define its unique dependencies or `copyFiles` directives.

3.  **Create `package.json`**:
    Copy an existing `package.json` and update the following:
    - `name`: Should include the full version string (e.g., `@platforma-open/milaboratories.runenv-python-3.13.0-custom`).
    - `description`: Update with the correct version.
    - `scripts.build`: Ensure the script calls `build.js` with the correct **full version string**.

    **Crucial point for variants**:
    The `build` script must pass the full version string so the build system can locate the correct configuration.
    ```json
    "scripts": {
      "build": "node ../scripts/build.js 3.13.0-custom"
    }
    ```
    The build script is smart: it will use `3.13.0-custom` to find the config but will use `3.13.0` to download the base portable Python.

4.  **Update Workspace (`pnpm-workspace.yaml`)**:
    Add the new package directory to `pnpm-workspace.yaml`.
    ```yaml
    packages:
      - 'python-3.12.10'
      - 'python-3.12.10-atls'
      - 'python-3.10.11'
      - 'python-3.13.0-custom' # Add new version here
    ```

5.  **Update Catalogue**:
    Add the new package as a dependency and an entrypoint in the `catalogue/package.json`.

6.  **Test the Build**:
    ```bash
    pnpm build --filter=@platforma-open/milaboratories.runenv-python-3.13.0-custom
    ```

## Package Compatibility

Each Python version has different package compatibility:

### Python 3.12.10
- Latest package versions (uses shared configuration)
- Full CUDA support with platform-specific exclusions
- Experimental TensorFlow ARM64 builds
- **Dependencies**: pandas 2.2.3, numpy 2.2.6, scipy 1.15.3, scikit-learn 1.6.1, etc.

### Python 3.10.11
- Legacy package versions for older compatibility
- Limited TensorFlow ARM64 support (excluded on ARM64)
- **Dependencies**: pandas 2.0.3, numpy 1.24.3, scipy 1.10.1, scikit-learn 1.3.0, etc.

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
2. Test with `pnpm build --filter=<package-name>`
3. Run full build with `pnpm build`
4. Publish with `pnpm postbuild-publish`

## Build System

### Turbo Configuration
The project uses Turbo for build orchestration with a simplified configuration:

```json
{
  "tasks": {
    "build": {
      "inputs": ["$TURBO_DEFAULT$"],
      "outputs": ["./dist/**"]
    },
    "postbuild-publish": {
      "dependsOn": ["build"],
      "passThroughEnv": [...]
    }
  }
}
```

### Key Features
- **Independent builds**: Each Python version builds independently
- **Environment passthrough**: Proper AWS and registry credentials handling
- **Cleanup scripts**: Comprehensive cleanup including build directories

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

### Build Artifacts
- **Large packages**: Some builds may produce large artifacts (200MB+) due to dependencies
- **Platform-specific**: Builds are optimized for each platform (Linux, macOS, Windows)
- **Cleanup**: Use `pnpm cleanup` to remove build artifacts and free disk space

## Notes

- There is no longer a `python` section or a single `build-config.json`.
- No config override file is needed; the system is automatic.
- The build system automatically tries binary wheels first, then falls back to source builds.
- Multiple PyPI registries are supported via configuration.
- The catalogue package provides a unified interface to all Python versions.
- Build artifacts are stored in `pydist/` directories for each platform.
