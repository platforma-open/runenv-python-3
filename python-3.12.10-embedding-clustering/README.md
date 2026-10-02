Python 3.12.10 run environment for the Embedding Clustering block (`embedding-clustering`): `fast_hdbscan` and `pynndescent` on `numba`, plus `scikit-learn` (PCA, medoid distances), `polars` and `pyarrow` (Parquet loading and output) and `pandas`. Contrib `hdbscan` stays while the block still calls it.

The set is pinned flat and matches the block's `requirements.txt`. The block installs it with `pip --no-index --find-links <runenv packages>`, so each pin in the block must exist here as a wheel. Change the pins here and in the block together.

Every package is declared under `noDeps`, and the transitive dependencies (`joblib`, `threadpoolctl`, `python-dateutil`, `six`, `pytz`, `tzdata`) are pinned explicitly. Otherwise each package's loose requirements pull the newest `numba`, `llvmlite`, `numpy` and `scipy` next to the pinned versions. The `numba`, `llvmlite` and `pynndescent` pins are what keep the seeded clustering identical between runs: other versions can build a different kNN graph and so different clusters.

`hdbscan` has no Linux ARM64 wheel and is compiled on the native runner. macOS-Intel (`macosx-x64`) is intentionally not built: `numba` ships no cp312 wheel for that platform after 0.62.1.
