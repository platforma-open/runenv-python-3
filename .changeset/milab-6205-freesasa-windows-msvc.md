---
"@platforma-open/milaboratories.runenv-python-3.12.10": patch
"runenv-python-builder": patch
---

Add freesasa 2.2.1 to python-3.12.10 with cross-platform source builds. Builder now optionally sources `vcvarsall.bat` before invoking `pip wheel` on Windows, opt-in via `needsMsvc: true` on a package's `buildWheel` entry. Other Windows buildWheel paths (kalign-python via scikit-build-core + clang-cl) keep their own toolchain discovery and are unaffected.
