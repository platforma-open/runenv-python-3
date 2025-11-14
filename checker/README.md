# Native Import Checker

Test Python wheel packages by importing all native modules. Useful for validating package compatibility across different platforms and glibc versions.

## Features

- Auto-discovers packages from `../packages` directory
- Tests all native extensions (`.so`, `.pyd`, `.dylib`, `.dll`)
- Cross-platform support (Linux, macOS, Windows)
- Whitelist support for known issues
- Helpful error suggestions and cleanup recommendations

## Quick Start

```bash
# Basic usage
/opt/python-portable/bin/python check_native_imports.py

# With whitelist
/opt/python-portable/bin/python check_native_imports.py whitelist.json
```

See [QUICKSTART.md](QUICKSTART.md) for more examples.

## Requirements

- Python 3.7+
- Wheel files in `../packages` (relative to the Python executable) or in `packages/` (in the current directory).

## Expected Directory Structure

```
python-portable/
├── bin/python          # Your Python executable
└── packages/           # Wheel files (.whl)
```

## Whitelist Format

Suppress known/acceptable errors with a JSON whitelist:

```json
{
  "package-1.0.0-cp312-manylinux_2_28_aarch64.whl": {
    "module.name": "error substring"
  }
}
```

Error matching is case-insensitive substring matching. See [whitelist.example.json](whitelist.example.json) for examples.

## Output

### Summary
```
==================================================
Test Summary
==================================================
Platform: Linux aarch64
Python: 3.12.10
Total wheels tested: 115
Successful: 110
Failed: 5
==================================================
```

### Whitelist Suggestions

Failed imports automatically generate JSON snippets for your whitelist:

```json
{
  "torch-2.7.0+cpu.whl": {
    "functorch._C": "initialization failed"
  }
}
```

### Unused Entries

The script identifies whitelist entries that can be safely removed.

## Common Error Types

| Error | Meaning | Action |
|-------|---------|--------|
| `libgomp.so.1: cannot open shared object` | Missing system library | Install library or whitelist |
| `No module named '_tkinter'` | Optional dependency missing | Whitelist if not needed |
| `initialization failed` | ABI mismatch or missing deps | Investigate or whitelist |
| `circular import` | Package bug | Report upstream or whitelist |

## Platform Notes

| Platform | Extensions | Libraries | venv Path |
|----------|------------|-----------|-----------|
| Linux/Unix | `.so` | `lib*.so` | `bin/python` |
| macOS | `.so`, `.dylib` | `lib*.dylib` | `bin/python` |
| Windows | `.pyd`, `.dll` | `lib*.dll`* | `Scripts\python.exe` |

*Windows libraries: `lib*.dll` without Python version markers

## Use Cases

### Testing on Old glibc

```bash
docker run --rm -ti --platform linux/arm64 \
  -v /path/to/python:/opt/python \
  rockylinux:8 /opt/python/bin/python checker/check_native_imports.py
```

### CI/CD Integration

```yaml
- name: Validate wheels
  run: python checker/check_native_imports.py whitelist.json
```

### Pre-deployment Validation

```bash
# See all issues
./python/bin/python check_native_imports.py > report.txt

# Create whitelist for acceptable issues
vim whitelist.json

# Validate with whitelist
./python/bin/python check_native_imports.py whitelist.json
```

## Exit Codes

- `0` - Success (including whitelisted errors)
- `1` - Non-whitelisted failures

## Troubleshooting

**Can't find packages directory**  
Ensure a `packages` directory exists, either relative to your Python executable (`../packages`) or in your current working directory.

**venv creation fails**  
Verify the `venv` module is available: `python -m venv --help`

**Wheel installation fails**  
All dependencies must be present in the packages directory. The script uses `--no-index --find-links`.

## How It Works

1. Scans wheels for native extensions
2. Filters out C/C++ libraries (`lib*` files)
3. Creates temporary venv for each wheel
4. Installs wheel with local dependencies
5. Attempts to import each native module
6. Reports results with whitelist suggestions

## Contributing

Test on all platforms when making changes. Keep whitelist format backward compatible.
