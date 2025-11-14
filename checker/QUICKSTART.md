# Quick Start

Test your wheel packages in 3 steps.

## Step 1: Run the Test

```bash
# Linux/Mac
./bin/python /path/to/checker/check_native_imports.py

# Windows
.\Scripts\python.exe C:\path\to\checker\check_native_imports.py
```

## Step 2: Review Results

```
Test Summary
Total wheels tested: 115
Successful: 110
Failed: 5
```

## Step 3: Handle Failures (Optional)

Copy the generated JSON snippet and create `whitelist.json`:

```bash
vim whitelist.json  # Paste the JSON snippet
./bin/python check_native_imports.py whitelist.json
```

## Docker Example

Test on Rocky Linux 8 (old glibc):

```bash
docker run --rm -ti --platform linux/arm64 \
  -v ~/python-portable:/opt/python \
  rockylinux:8 \
  /opt/python/bin/python /path/to/check_native_imports.py
```

## Understanding Output

| Symbol | Meaning |
|--------|---------|
| ✓ | Import succeeded |
| ❌ | Import failed (needs attention) |
| ⚠️ | Whitelisted (known issue) |

## Common Scenarios

**All tests pass** - You're good to go!

**Some failures** - Fix the issue or add to whitelist if acceptable.

**Unused whitelist entries** - Remove them from whitelist.json.

## Tips

- Start without a whitelist to see all issues
- Use generated JSON snippets for your whitelist
- Check exit code in CI/CD: 0 = success, 1 = failure

See [README.md](README.md) for detailed documentation.
