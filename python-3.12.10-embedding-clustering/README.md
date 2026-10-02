Python 3.12.10 run environment for the Embedding Clustering block (`embedding-clustering`): `fast_hdbscan` and `pynndescent` on `numba`, plus `scikit-learn` (PCA, medoid distances), `polars` and `pyarrow` (Parquet loading and output) and `pandas`. Contrib `hdbscan` stays while the block still calls it.

The set is pinned flat and matches the block's `requirements.txt`. The block installs it with `pip --no-index --find-links <runenv packages>`, so each pin in the block must exist here as a wheel. Change the pins here and in the block together.

Every package is declared under `noDeps`, and the transitive dependencies (`joblib`, `threadpoolctl`, `python-dateutil`, `six`, `pytz`, `tzdata`) are pinned explicitly. Otherwise each package's loose requirements pull the newest `numba`, `llvmlite`, `numpy` and `scipy` next to the pinned versions. The pins keep the seeded clustering stable across rebuilds of this run environment.

`numba` and `llvmlite` are pinned per platform under `platformSpecific`. macOS-Intel (`macosx-x64`) gets `numba` 0.62.1 / `llvmlite` 0.45.1, the last releases with a cp312 wheel for that platform; every other platform gets 0.67.0 / 0.49.0. The block's `requirements.txt` must select the same pair with environment markers, for example `numba==0.62.1; sys_platform == "darwin" and platform_machine == "x86_64"` and `numba==0.67.0; sys_platform != "darwin" or platform_machine != "x86_64"`. PEP 508 has no `not`, so the negated condition is written out with `!=` and `or`.

The two numba versions give byte-identical clusters on the same CPU. numba compiles for the CPU it runs on by default, so clusters can differ slightly between CPUs (arm64 vs x86, or x86 CPUs with different SIMD support). The block's environment variable `NUMBA_CPU_NAME=generic` makes them identical across platforms, at a cost of about 6% in fit time.

`hdbscan` has no Linux ARM64 wheel and is compiled on the native runner.
