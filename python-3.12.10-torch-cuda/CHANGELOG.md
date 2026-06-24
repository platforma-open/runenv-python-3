# @platforma-open/milaboratories.runenv-python-3.12.10-torch-cuda

## 0.2.0

### Minor Changes

- 06121fd: Add antibody (AbLang2) and TCR (SCEPTR) specialist embedding libraries plus rdkit to the torch-cuda run environment.

  - `ablang2==0.2.1` — AbLang2 antibody language model (pulls einops + rotary-embedding-torch)
  - `sceptr==1.2.0` — SCEPTR paired-chain TCR model (pulls libtcrlm + tidytcells + pandas + blosum)
  - `rdkit==2026.3.3` — cheminformatics toolkit for the PeptideCLM-2 amino-acid→SMILES conversion (pulls Pillow)

  All install conflict-free on top of the existing pins (transformers 4.53.2, polars-lts-cpu 1.33.1, numpy 2.2.6, pyarrow 21.0.0, torch 2.7.0); `pip check` clean.

## 0.1.0

### Minor Changes

- 2da5c46: New env for GPU torch

### Patch Changes

- 4e51c72: Fix incorrect merge with main
