# @platforma-open/milaboratories.runenv-python-3.12.10-pgen

## 0.3.0

### Minor Changes

- 6a9635a: Update the `3.12.10-pgen` run environment to the pins of the Generation Probability block: `numpy==2.4.6`, `numba==0.66.0`, `llvmlite==0.48.0`, `olga==1.3.0`, `polars==1.43.0`, `polars-runtime-32==1.43.0` and `polars-runtime-compat==1.43.0`.

  The block installs its `requirements.txt` with `pip --no-index --find-links <runenv packages>`. A pin that the run environment does not ship cannot resolve. The old set (`numpy==2.2.6`, `polars-lts-cpu==1.33.1`) did not match the block.

  `polars-lts-cpu` is removed. `polars[rtcompat]` replaces it upstream, and `polars-runtime-compat` is that runtime.

  `olga` and `numba` are declared under `noDeps`. Without it, their loose requirements pull the newest `numba`, `llvmlite` and `numpy` next to the pinned versions. `strictMissing` is on, so a missing wheel fails the build.

## 0.2.0

### Minor Changes

- 203ec06: Add Python 3.12.10 run environment for the Generation Probability block: olga (CDR3 generation probability + its bundled recombination models) with numpy and polars-lts-cpu. macOS-Intel is not built (no llvmlite cp312 wheel).
