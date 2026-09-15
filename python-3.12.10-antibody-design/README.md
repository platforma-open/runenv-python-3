Run environment for the Antibody Variant Designer block: AntiFold inverse folding
(torch + torch_geometric), Sapiens humanness (transformers), SASA exposure
(freesasa) and promb.

Everything is pinned explicitly. A variant does not inherit the base
environment's dependency list, so the whole runtime closure is named here — it
was resolved with `uv pip compile --universal` from the block's two exported
requirement sets and then written out flat.

`biopython`, `promb` and `sapiens` are under `noDeps`. The builder resolves each
declared package's closure on its own, and none of these three pins anything, so
each pulled the newest of everything on top of the pins and vendored a second
copy: numpy 2.5.3 beside 1.26.4, scipy 1.18.1, pandas 3.0.5, torch 2.14, and
transformers 5. The import checker then installed the newest of each and every
numpy-1-ABI extension failed, biotite first.

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
