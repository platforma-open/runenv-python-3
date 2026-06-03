---
"@platforma-open/milaboratories.runenv-python-3.12.10": patch
---

Add freesasa 2.2.1 to python-3.12.10 with cross-platform source builds. Windows requires MSVC activation (vcvars) before `pip wheel` runs setuptools; that's handled at the shared runner workflow via `milaboratory/github-ci/actions/setup-msvc-dev-cmd@v4`, not by the runenv builder. Skipped on macosx-x64 (Apple discontinued Intel Macs in 2023; macOS 15 dropped Intel support).
