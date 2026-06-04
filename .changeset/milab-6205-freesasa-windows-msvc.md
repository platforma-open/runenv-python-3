---
"@platforma-open/milaboratories.runenv-python-3.12.10": patch
---

Add freesasa 2.2.1 to python-3.12.10 with cross-platform source builds (linux-x64, linux-aarch64, macosx-x64, macosx-aarch64, windows-x64). Windows requires MSVC activation (vcvars) before `pip wheel` runs setuptools; that's handled at the shared runner workflow via `milaboratory/github-ci/actions/setup-msvc-dev-cmd@v4`, not by the runenv builder.
