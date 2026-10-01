Python 3.12.10 run environment for the Generation Probability block (`generation-probability`): `olga` (V(D)J generation-probability computation for CDR3s, including its 10 bundled recombination models) plus `numpy` and `polars` for Parquet I/O.

The set is pinned flat and matches the block's `requirements.txt`: `olga`, `numba`, `llvmlite`, `numpy`, `polars`, `polars-runtime-32` and `polars-runtime-compat`. The block installs it with `pip --no-index --find-links <runenv packages>`, so each pin in the block must exist here as a wheel. Change the pins here and in the block together.

`polars-runtime-compat` is the `polars[rtcompat]` extra. It replaces `polars-lts-cpu`. `olga` and `numba` are declared under `noDeps`. Their loose requirements otherwise pull the newest `numba`, `llvmlite` and `numpy` next to the pinned versions.

The block uses olga's `FastPgen`, which runs numba kernels. numpy 2.4.6 has only `manylinux_2_28` wheels on Linux, so the host needs glibc 2.28 or newer. macOS-Intel (`macosx-x64`) is intentionally not built — `llvmlite` ships no cp312 wheel for that platform.
