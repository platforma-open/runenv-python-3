---
'@platforma-open/milaboratories.runenv-python-3.12.10-rapids': patch
---

Fix the RAPIDS runenv `PATH` env var breaking every non-docker run: use `$PATH` instead of `${PATH}`.
`envVars` feeds two consumers with different syntaxes. The Dockerfile generator emits each entry as an `ENV` line, where Docker expands both `${PATH}` and `$PATH` at build time. The native (venv) path renders each entry through the backend's expr-lang renderer, whose scanner regex `{.*?[^\\]}` matches the `{PATH}` inside `${PATH}` and fails with `cannot evaluate expression: "PATH" (variable is not defined)` — rejecting the venv-creation RunCommand, so any block on this runenv failed on a local/desktop backend while docker-backed backends were fine.
`$PATH` carries no braces, so it expands correctly in the Dockerfile and is passed through literally on the native path, where the backend already appends the host `PATH` after any `PATH` entry in `envVars`.

Add `pyarrow==19.0.1` to the RAPIDS runenv.
Blocks on this runenv install their `requirements.txt` with `pip --no-index --find-links <runenv packages>`, so a requirement the runenv does not ship cannot resolve. `pyarrow` was never declared here (every sibling runenv declares it), so any block importing it failed with `No matching distribution found for pyarrow` on every platform where the `cu12` packages are skipped — macOS, Windows and linux-aarch64. On linux-x64 it resolved only incidentally, as a transitive dependency of `cudf-cu12`.
Version is capped by RAPIDS: `cudf-cu12==25.4.0` requires `pyarrow>=14.0.0,<20.0.0a0` (plus `!=17.0.0` on aarch64), making 19.0.1 the highest usable release. That is why it differs from the 21.0.0 / 24.0.0 pinned by the non-RAPIDS runenvs. cp312 wheels exist for all five target platforms.
