---
'@platforma-open/milaboratories.runenv-python-3.12.10-rapids': patch
---

Pin `tifffile==2026.4.11` so venv creation resolves on Linux x86_64. Newer `tifffile` (via `cucim` → `scikit-image`) requires `numpy>=2.1`, which conflicts with the pinned `numpy==2.0.2` and with `numba 0.60.0` from cuDF 25.4, so `pip install --no-index` failed with `ResolutionImpossible`.

Pin `nvidia-cuda-nvrtc-cu12==12.9.86`, `nvidia-cublas-cu12==12.9.2.10` and `cupy-cuda12x==14.2.0`, which were listed without exact versions.
