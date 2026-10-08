---
'@platforma-open/milaboratories.runenv-python-3.12.10-embedding-clustering': minor
'@platforma-open/milaboratories.runenv-python-3': minor
---

Add Python 3.12.10 run environment for the Embedding Clustering block: `fast_hdbscan` 0.3.2 and `pynndescent` 0.6.0 on `numba` 0.67.0 / `llvmlite` 0.49.0 (0.62.1 / 0.45.1 on macOS-Intel, the last releases with a cp312 wheel there), with `numpy`, `scipy`, `scikit-learn`, `pandas`, `polars-lts-cpu` and `pyarrow`. Contrib `hdbscan` is not included: the block's B2 path uses `fast_hdbscan` only. The whole closure is pinned and installed with `noDeps`, so the seeded clustering is reproducible across rebuilds.
