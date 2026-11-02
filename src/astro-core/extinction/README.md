# Dust extinction march — CPU mirror

`dust-raymarch-pure.ts` (+ test) — the CPU mirror of the per-star dust
march: the segment–cube clip, the tap rule, the decode, the midpoint sum —
and the E(B−V) = A_V / R_V reddening. The TSL march imports its constants;
the catalogue build's de-extinction and the dust bakers import its clip
and integral; the runtime never calls it.

What it mirrors, and the cancellation invariant any change must keep, is
the viewer's [The march](/src/client/star-pipeline/extinction/README.md#the-march);
that README stays the authority.
