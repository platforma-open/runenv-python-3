# @platforma-open/milaboratories.runenv-python-3.12.10-hilary

## 0.2.0

### Minor Changes

- 04c2ade: Add the `3.12.10-hilary` Python run environment: HILARy (`hilary`, invoked as `python -m hilary`) plus its
  runtime closure, for the Lineage Trees block's clonal-lineage clustering.

  `hilary` is declared under `noDeps`, following the `3.10.21-clustcr` precedent. The builder resolves each
  declared package's closure separately, so HILARy's loose requirements (`numpy<3`, `scipy<2,>1.11`,
  `pandas<3,>=2.2`) otherwise pulled the newest of each on top of the pinned versions and vendored duplicates.

  `hilary` ships a universal `py3-none-any` wheel, so nothing here compiles.

  There is no Linux ARM64 root, and the CI matrix omits it. `atriegc`, HILARy's trie-based CDR3 neighbour
  search, publishes no Linux ARM64 wheel for any Python version, and its 0.0.4 sdist cannot substitute: it
  ships `src/main.cpp` but omits the `trie_container.hpp` header that file includes, so a source build fails at
  the first compile.
