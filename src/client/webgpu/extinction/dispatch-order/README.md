# Extinction dispatch order

The permutation the A_V kernel dispatches in, and the scatter that undoes
it. Pure arithmetic over `catalog.positions` — nothing here imports the
pass that uses it (`../README.md` § The prepass kernel).

## Files in this area

```
src/client/webgpu/extinction/dispatch-order/
  dispatch-order-pure.ts      The Morton key, the slot -> star permutation
    (+ test)                  it sorts into, and the scatter that undoes it.
  dispatch-order-fixture.ts   The spatially unordered lattice both dispatch
                              suites sort. Never in a bundle; the `-fixture`
                              suffix is what marks that.
```

## Dispatch order

`compute(count)` in catalogue order puts unrelated sight-lines on
neighbouring threads, and neighbouring threads are what share a memory
transaction. Two rows of the `stellata-ty4.9` sweep hold fetch count,
ray length and working set identical and move only how the rays are laid
out: **3.3× for coherence alone**, 3.3 against 10.9 G fetches/s
(`../../../../../docs/science-galactic-structure.md`
§ What the fill measured). This
pass is measured rather than inferred from that: a recompute of 18.6M
fetches — the fixed 48 taps per star the march spent when the pair was
taken — cost **12.89 ms in catalogue order against 2.48 ms in Morton
order** at mw120, 5.20×, on every frame a warp moves past
`RECOMPUTE_EPSILON_PC` (`stellata-8cg.58.2` notes carry both arms and
the sol pair). It beats the sweep's 3.3× because catalogue order
scatters worse than the golden-angle row that measured that. The stall is
latency, not bandwidth — 10.9 G one-byte fetches/s is ~11 GB/s against a
base M4's ~120 GB/s — and latency is what a coherent order hides.

**The key is spatial, not angular.** A sky-direction sort is coherent
only from the vantage it was built for, and the camera flies to the LMC
and 3 kpc off-Sol, where a Sol-relative direction order is arbitrary
again (`AGENTS.md` § Camera-anywhere). Stars adjacent in 3D have rays
that converge near the camera *and* near the star from every vantage, so
`mortonDispatchOrder` interleaves 16 quantised bits per axis over the
catalogue's own bounding box into a 48-bit Z-order key. **What fixes 16 is
the spreader, not the mantissa**: `part1By2` takes 8 bits and the key is
assembled from two halves, so a half wider than 8 drops its top bits and
collapses the order with nothing failing. Each half is its own 24-bit
key word, and a 32-bit word has room to spare — 10 bits per half-axis
would still fit it — which is why the pin is on the half-width and not on
the word. The sort is a CPU pass at attach and, when attach sorted a
catalogue still streaming in, once more on the refresh that completes it
(`../README.md` § What a CACHE owes); nothing re-sorts per frame, and the
order is a function of `catalog.positions` alone.

**It is synchronous on the main thread, and its timing is a dev-machine
one**: ~21 ms at 983,068 stars, measured in Node on an M-series laptop, so
budget several times that on the integrated and mobile floor this folder is
sized for. At attach it shares its frame with the volume upload, which
already stalls; the re-sort shares the final chunk's absorb
(`../../../star-pipeline/star-frame/README.md` § Absorbing a chunk).
The two words go low half first through the shared radix sort
(`../../../util/radix-sort.ts`), four passes in all, ties by star index; a
comparator sort over the same keys produces the identical permutation at
~232 ms.

**The A_V buffer stays catalogue-star-indexed** — so the position table
is what moves. Thread *i* reads sorted position *i* and writes
`av[order[i]]`. That trades coherent reads for scattered writes, and the
trade is strongly favourable: 4 bytes each into a 1.48 MiB buffer that
stays in cache, against reads scattered across the whole volume.

The indirection is the one thing here that can be wrong silently: a
position table packed in one order against a slot → star table in
another writes every star's A_V onto some other star, which reads as a
plausible dust field rather than as a failure. `packPositionsVec4Into`
takes the same `order` array the table is built from, the pairing is
pinned in the test, and `verifyExtinction()` is the acceptance
(`../README.md` § The prepass kernel).

**That pin only bites over a field the sort actually permutes.** A
catalogue monotone in all three axes sorts to the identity — Z-order
preserves the dominance order — so slot equals star and a table paired
wrongly passes anyway. The test builds its field from
`dispatch-order-fixture.ts` and asserts the order is not the identity
before it checks a single slot; a fixture swapped for a tidier monotone
one silently retires the check.
