# Package Exceptions Configuration

This document explains how to configure package-specific exceptions for different platforms and architectures.

## Overview

The build system supports multiple PyPI index URLs and intelligent package handling:

- **Multiple Index URLs**: Support for additional PyPI repositories via command-line arguments
- **Smart Fallback**: Automatically tries binary wheels first, then falls back to source builds
- **Platform Exceptions**: Configure packages that need special handling for specific platforms

The build system now supports three types of package exceptions:

1. **Skip**: Packages that should be completely skipped for specific platforms
2. **Force Source**: Packages that should always be built from source for specific platforms
3. **Platform Specific**: Advanced configuration with custom actions and reasons

## Configuration File

Package exceptions are configured in `package-exceptions.json` at the root of the project.

## Extra Index URLs

You can specify additional PyPI index URLs when running the build script:

```bash
# Build with additional index URLs
node ./scripts/build.js 3.12.6 "https://custom.pypi.org/simple/,https://another.pypi.org/simple/"

# Build with single additional index
node ./scripts/build.js 3.12.6 "https://custom.pypi.org/simple/"
```

The build system will:
1. Always include the default NVIDIA PyPI index (`https://pypi.nvidia.com`)
2. Add any additional URLs you specify
3. Search all indexes when downloading packages

## Configuration Structure

```json
{
  "skip": {
    "package-name": {
      "platform-key": "reason for skipping"
    }
  },
  "forceSource": {
    "package-name": {
      "platform-key": "reason for forcing source build"
    }
  },
  "platformSpecific": {
    "package-name": {
      "platform-key": {
        "action": "skip|forceSource",
        "reason": "detailed explanation"
      }
    }
  }
}
```

## Platform Keys

Platform keys follow the format: `{os}-{arch}`

- `linux-x64` - Linux AMD64
- `linux-aarch64` - Linux ARM64
- `macosx-x64` - macOS Intel
- `macosx-aarch64` - macOS Apple Silicon
- `windows-x64` - Windows AMD64

## Examples

### Skipping CUDA Packages on Non-Linux Platforms

```json
{
  "skip": {
    "cudf-cu12": {
      "macosx-x64": "CUDA packages not supported on macOS",
      "macosx-aarch64": "CUDA packages not supported on macOS",
      "windows-x64": "CUDA packages not supported on Windows"
    }
  }
}
```

### Forcing Source Build for Packages Without Binary Wheels

```json
{
  "forceSource": {
    "parasail": {
      "linux-aarch64": "parasail has no binary wheels for Linux ARM64",
      "macosx-aarch64": "parasail has no binary wheels for macOS ARM64"
    }
  }
}
```

### Advanced Platform-Specific Configuration

```json
{
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
```

## Adding New Exceptions

1. Edit `package-exceptions.json`
2. Add your package and platform-specific rules
3. Test the build to ensure the exceptions work as expected
4. Commit the changes

## Best Practices

- **Be specific**: Only add exceptions when absolutely necessary
- **Document reasons**: Always provide clear explanations for why exceptions exist
- **Test thoroughly**: Verify that exceptions work on all affected platforms
- **Keep updated**: Remove exceptions when packages add support for new platforms
- **Use simple configs**: Prefer `skip` and `forceSource` over `platformSpecific` when possible

## Troubleshooting

If the build fails to load the exceptions configuration:

1. Check that `package-exceptions.json` is valid JSON
2. Verify the file is in the project root
3. Check file permissions
4. Look for console warnings during build startup

The build will continue with an empty configuration if the file cannot be loaded. 