Run environment for the Antibody Variant Designer block: AntiFold inverse folding
(torch + torch_geometric), Sapiens humanness (transformers), SASA exposure
(freesasa) and promb.

Everything is pinned explicitly. A variant does not inherit the base
environment's dependency list, so the whole runtime closure is named here — it
was resolved with `uv pip compile --universal` from the block's two exported
requirement sets and then written out flat.

Every package with a loose requirement of its own is under `noDeps`. The builder
resolves each declared package's closure separately, so any package that asks for
a bare `numpy` or `scipy` pulls the newest one on top of the pins and vendors a
second copy — numpy 2.5.3 beside 1.26.4, scipy 1.18.1 beside 1.16.3, and earlier
also pandas 3, torch 2.14 and transformers 5. The import checker installs from
that directory and takes the newest wheel a requirement allows, so it built its
test venv on numpy 2 and every numpy-1-ABI extension in the set failed, biotite
loudest at 24 modules.

Naming the whole closure flat is what makes `noDeps` safe here: nothing needs
resolving, because everything any of these packages imports is already pinned
above.

The biotite entries in `checker/whitelists/*.json` cover that same numpy-2 ABI
error. With the `noDeps` set above they should never fire — they are there so one
loose requirement slipping back in cannot fail five platforms again.

torch is declared per platform rather than in the shared list. On linux-x64 the
PyPI wheel depends on twelve `nvidia-*` CUDA packages worth roughly 2 GiB that
this block never uses, so that platform takes `torch==2.2.2+cpu` from
`https://download.pytorch.org/whl/cpu`, which the shared config already lists as
an additional registry. The macOS and Windows PyPI wheels are CPU builds
already, and the `nvidia-*` requirements are marked linux-x86_64 only, so those
platforms take the plain pin.

freesasa publishes no cp312 wheel on any platform and never has, so it is built
on the runner for all five, exactly as the base `3.12.10` environment does it.

biotite is at 0.39.0 rather than the 0.38.\* the block's `pyproject.toml` asks
for: 0.38 predates cp312 and publishes no wheel any Python 3.12 can use, so
pinning it would mean a source build on all five platforms, Windows included.
0.39.0 is the first line with cp312 wheels. The block's bound has to move with
this.

biotite has no Linux ARM64 wheel for any version, so that one platform compiles
its Cython sources on the native ARM runner.
