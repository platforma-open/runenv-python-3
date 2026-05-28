---
'@platforma-open/milaboratories.runenv-python-3': patch
'@platforma-open/milaboratories.runenv-python-3.12.10': patch
'@platforma-open/milaboratories.runenv-python-3.12.10-atls': patch
'@platforma-open/milaboratories.runenv-python-3.12.10-empty': patch
'@platforma-open/milaboratories.runenv-python-3.12.10-h5ad': patch
'@platforma-open/milaboratories.runenv-python-3.12.10-humanness': patch
'@platforma-open/milaboratories.runenv-python-3.12.10-parapred': patch
'@platforma-open/milaboratories.runenv-python-3.12.10-rapids': patch
'@platforma-open/milaboratories.runenv-python-3.12.10-sccoda': patch
'@platforma-open/milaboratories.runenv-python-3.12.10-scientific-slim': patch
---

Switch CPython provisioning on macOS and Linux from portable-python source builds to prebuilt python-build-standalone tarballs. Eliminates the macOS libinstall parallel-make race that intermittently broke CI, removes the Linux Docker build container, and drops 10–15 minutes of CPython compilation per cache-miss build.
