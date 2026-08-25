---
"@platforma-open/milaboratories.runenv-python-3.12.10-clustcr": minor
"@platforma-open/milaboratories.runenv-python-3": minor
---

Add the `3.12.10-clustcr` Python run environment: clusTCR (`immunewatch-clustcr`, module `imw_clustcr`)
plus its runtime closure, faiss-cpu and polars-lts-cpu, for the clusTCR Clustering block.

clusTCR's own metadata is skipped via `noDeps` because it hard-pins `scipy==1.8`, which is unsatisfiable on
Python 3.12 (every 1.8.x release declares `Requires-Python >=3.8,<3.11`) and unnecessary — clusTCR runs on
scipy 1.11/1.18. numpy is held below 2.0 because clusTCR's faiss path (the `two-step` method and
`include_vgene`) breaks under numpy 2.x. See the package README for the full rationale.
