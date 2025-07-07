# Python run environment for Platforma Backend

This package is the catalogue of all supported versions of 'python' run environment.

Unlike most other software packages, it keeps entrypoints for all python versions
published earlier.

As we do not maintain/build our own java, the version of this package is not bound to any
specific version of python, but newer python version publications produce newer entrypoints
in this package.

## Package Management

The build system automatically handles package installation with intelligent fallback:
- First attempts to download binary wheels from PyPI
- Falls back to building from source if binary wheels are unavailable
- Supports platform-specific exceptions for packages with limited platform support
- Supports additional PyPI index URLs for custom package sources

### Usage

```bash
# Basic build
npm run build

# Build with additional PyPI index URLs
node ./scripts/build.js 3.12.6 "https://custom.pypi.org/simple/,https://another.pypi.org/simple/"

# Build with single additional index
node ./scripts/build.js 3.12.6 "https://custom.pypi.org/simple/"
```

See [PACKAGE_EXCEPTIONS.md](PACKAGE_EXCEPTIONS.md) for details on configuring package-specific behavior.

## How to release new version of python run environment

1. Update `package.json`:
   1. Add new entrypoint for fresh version of python.
   2. Change version of python built by default in CI (`scripts` section in `package.json`).
2. Generate new entrypoint:
   1. Run `npx pl-pkg build descriptors --entrypoint=<new entrypoint name here>`
   2. Commit new entrypoint descriptor generated in `dist` directory.
3. Bump `<minor>` version part in `package.json`.
