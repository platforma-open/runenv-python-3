# @platforma-open/milaboratories.runenv-python-3.10.21-clustcr

## 0.2.0

### Minor Changes

- a2b7696: Add the `3.10.21-clustcr` Python run environment: clusTCR (`immunewatch-clustcr`, module `imw_clustcr`)
  plus its runtime closure, faiss-cpu and polars-lts-cpu, for the clusTCR Clustering block.

  Python 3.10 rather than the repo's usual 3.12.10, deliberately: clusTCR requires SciPy 1.8, which no
  Python 3.11+ release supports, and that requirement is load-bearing — on SciPy 1.8 a sparse array is still
  an `spmatrix`, which is what makes clusTCR's Markov-clustering step work, while newer SciPy breaks it and
  NumPy 2 breaks its FAISS-backed paths. Targeting 3.10 lets the package be installed and used unmodified:
  no dependency metadata skipped, no numpy ceiling, and no runtime patching in the consuming block. Intended
  to be temporary — see the package README. Python 3.10 is EOL 2026-10-31.

  `python-louvain` ships no wheel for any version and is built on the runner via `buildWheel` with an
  explicit setuptools backend, since pip's build isolation cannot reach an index for one.
