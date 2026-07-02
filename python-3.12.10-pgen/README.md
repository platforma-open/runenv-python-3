Python 3.12.10 run environment for the Generation Probability block (`generation-probability`): `olga` (V(D)J generation-probability computation for CDR3s, including its 10 bundled recombination models) plus `numpy` and `polars-lts-cpu` for Parquet I/O, and transitives.

Note: olga declares `numba` as a hard dependency (pulling `llvmlite`/LLVM), so these are bundled even though the block only uses olga's pure-NumPy `compute_aa_CDR3_pgen` path, not olga's numba fast-path. macOS-Intel (`macosx-x64`) is intentionally not built — `llvmlite` ships no cp312 wheel for that platform.
