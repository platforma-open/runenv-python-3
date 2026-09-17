---
"@platforma-open/milaboratories.runenv-python-3.12.10-antibody-design": minor
"@platforma-open/milaboratories.runenv-python-3": minor
---

Add the `3.12.10-antibody-design` Python run environment for the Antibody Variant Designer block: AntiFold
inverse folding (`torch`, `torch_geometric`), Sapiens humanness (`transformers`), SASA exposure (`freesasa`)
and `promb`, with the whole runtime closure pinned flat.

Both of the block's software packages install this set with pip on every run today, about 2 GiB of it. Shipping
it as a run environment moves that cost to build time.

torch is declared per platform. linux-x64 takes `torch==2.2.2+cpu` from `https://download.pytorch.org/whl/cpu`,
because the PyPI wheel pulls twelve `nvidia-*` CUDA packages this block never uses; the other platforms take
the plain pin, whose PyPI wheels are CPU builds already.

`freesasa` is built on the runner for all five platforms — it publishes no cp312 wheel anywhere — following the
base `3.12.10` environment. `biotite` is built on the runner for linux-aarch64 only, which has no wheel for any
version.

`biotite` is pinned at 0.39.0, not the 0.38.\* the block currently asks for: 0.38 publishes no wheel usable
under Python 3.12, so the block's own bound has to move with this.
