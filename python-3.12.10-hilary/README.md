Run environment for the HILARy package used by the Lineage Trees block.

Everything is pinned explicitly. A variant does not inherit the base environment's
dependency list, so HILARy's whole runtime closure is named here.

`hilary` is under `noDeps` because the builder resolves each declared package's
closure separately, so HILARy's own loose requirements would vendor a second,
newer copy of numpy, scipy, pandas, tqdm and setuptools alongside the pins. A
consuming block should pin what it wants in its own requirements, since that is
what decides the installed versions.

There is no Linux ARM64 root. `atriegc`, HILARy's trie-based CDR3 neighbour search,
publishes no Linux ARM64 wheel, and its 0.0.4 sdist cannot substitute: it ships
`src/main.cpp` but omits the `trie_container.hpp` header that file includes, so a
source build fails at the first compile. The other four platforms all have wheels
for every pin, which is why `strictMissing` is on.
