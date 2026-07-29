# Post-sort record addressing

Resolving `data/binaries/multiples.tsv` rows back to `catalog.bin` record
indices *after* the final absmag sort, and the two passes that need
nothing else: the chart-mode wings bit and the component-letter search
designations. Promotion itself is `../README.md` — it runs before the
sort and never reads anything here, so this folder is downstream of it
in one direction only.

## Files in this area

```
scripts/catalog/companions/record-index/
  record-index.ts (+ test)   buildCatalogRowIndexMap (the sidecar),
                             resolvePairComponents (the resolution both
                             passes share), wingRenderablePrimaries,
                             buildComponentDesignations.
```

## The sidecar and why resolution is duplicated from Python

`buildCatalogRowIndexMap` runs after the sort and emits
`public/catalog-row-index-map.json` with three sections — `byGaia`,
`byHip`, `bySynth`. That priority order is how the runtime binaries layer
turns a `multiples.tsv` row back into a record, and
`resolvePairComponents` is the **TypeScript twin of
`build-runtime-binaries.py`'s `resolve_idx`**, including both of that
writer's blended-sibling synth retries: each pair end re-homes onto its
own distinct synth slot whenever promotion minted one, and a synth slot
exists only for a row whose ids were inherited then stripped, so it is
always the truer target (Castor Ca inside the outer pair,
`04049-3527`'s pair-mate-inherited C).

The duplication is deliberate and load-bearing: the wings set has to
match what `binaries.bin` actually renders, and the two are computed by
different languages in different processes. `multi-star-regression.test.ts`
pins the correspondence against the real artifact, so drift on either
side fails.

Two of the writer's post-resolution steps are **not** replicated
(`override_inner_primary_indices`, the relation-winner dedup). They
change *which* index anchors a pair, never the distinct-pair boolean the
wings gate keys on, and root-grouping plus the brightest-participant pick
absorb the difference.

## Renderable-companion wings

The three passes that set `FLAG_BINARY_PRIMARY` in `build-catalog.ts`
(geometric `inferBinaries`, the CCDM pass, the eclipsing sweep) are all
keyed on evidence unaligned with the *presence of a rendered companion*.
A physical pair wider than the `0.005 pc` geometric cell, not CCDM
`C/G/O`, and not eclipsing (16 Cyg A, whose promoted placement exceeds
the geometric cell) shows a companion or a live orbit with no wings on
the anchor. `wingRenderablePrimaries` closes that gap:

- **Renders-a-companion gate.** A pair whose two sides resolve to
  DISTINCT records renders a companion, so the winged set tracks
  `binaries.bin`'s primaries.
- **One glyph per WDS system.** Records participating in a rendered pair
  are grouped by WDS root; the bit lands on the brightest participant
  only (the mutual-primary / CCDM brightest-member contract). A
  hierarchical system (Castor Ca,Cb inside the outer pairs) gets one
  glyph on the system anchor, never one per inner pair. A system any
  earlier pass already flagged is skipped, so it keeps its single glyph.
- **Additive only.** The pass never clears wings, so the
  reverse-direction cases stay correct: eclipsing binaries (an eclipsed
  star is a binary by convention even with a spectroscopically-
  unresolved companion) and iconic CCDM / Hipparcos doubles whose faint
  secondary isn't in the classic-IDs catalog (ν³ CMa = HDS 915, the
  Sirius-B pattern) keep their wings whether or not a second star
  renders.

`renderableCompanionWinged` in build-counts pins the count. It moves
when an earlier pass's brightest-member pick moves: more records
carrying the bit before this pass runs means more systems hit the
already-flagged skip, which lowers this count without lowering the
number of winged systems.

Also returned: every resolved `multiples.tsv` member index — the record
set the `MULTIPLICITY_RESOLVED` status covers (`../../multiplicity/README.md`).
A blended primary whose members all collapse onto it counts, since the
row exists for it even with nothing rendered apart.

## Component-letter search designations

`buildComponentDesignations` maps each component to a system-relative
designation so the runtime can offer "<base> <letter>" aliases ("Alpha
Centauri C" / "α Cen C" → Proxima). The base expands from the SYSTEM
PRIMARY's own designation, never the component's: Proxima carries no
Bayer, and the primary's proper would make it "Rigil Kentaurus C". The
primary is included with its own letter so "α Cen A" focuses it, and a
record shared across pairs takes first-write-wins (α Cen A appears in
both the AB and AC rows).

Emitted as the search index's `cl` / `cp` fields —
`../../README.md` § Search index and `src/client/typeahead/README.md`
§ Star search. `componentDesignations` pins the total.
