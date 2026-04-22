---
'@platforma-open/milaboratories.runenv-python-3.12.10-scientific-slim': patch
'@platforma-open/milaboratories.runenv-python-3': minor
---

Add `python-3.12.10-scientific-slim` runenv variant bundling only `polars-lts-cpu`, `numpy`, `scipy`, and `pyarrow`. Intended for blocks with tabular/scientific Python stacks that do not need the full ML toolchain (TensorFlow, torch, transformers, etc.) shipped by the base `3.12.10` runenv. Bundled size is ~100 MB vs. the base runenv's ~2.5 GB.
