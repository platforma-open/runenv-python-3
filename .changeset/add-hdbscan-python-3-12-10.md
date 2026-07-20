---
"@platforma-open/milaboratories.runenv-python-3.12.10": patch
---

Add `hdbscan==0.8.44` (scikit-learn-contrib HDBSCAN) to the Python 3.12.10 runenv. Built from prebuilt wheels on linux-x64, macOS (universal2) and win-x64; compiled from the Cython sources on the native runner for linux-aarch64 (no ARM64 wheel on PyPI). Provides density-based clustering with out-of-sample assignment (`approximate_predict`), enabling the embedding-clustering block's large-dataset path.
