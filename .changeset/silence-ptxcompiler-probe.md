---
"@platforma-open/milaboratories.runenv-python-3.12.10-rapids": patch
---

Silence the cudf ptxcompiler numba-codegen probe. Setting `PTXCOMPILER_CHECK_NUMBA_CODEGEN_PATCH_NEEDED=0` skips the import-time subprocess that fails to load `libcudart.so` and prints a misleading `OSError` traceback plus `Not patching Numba` on every run. cuML/CuPy are unaffected — the probe already defaulted to not patching.
