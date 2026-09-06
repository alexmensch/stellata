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
writer's blended-sibling synth retries (the wings pass adds a third, below): each pair end re-homes onto its
own distinct synth slot whenever promotion minted one, and a synth slot
exists only for a row whose ids were inherited then stripped, so it is
always the truer target (Castor Ca inside the outer pair,
`04049-3527`'s pair-mate-inherited C).

The duplication is deliberate and load-bearing: the wings set has to
match what `binaries.bin` actually renders, and the two are computed by
different languages in different processes. `multi-star-regression.test.ts`
pins the correspondence against the real artifact, so drift on either
side fails.

The writer's **`override_inner_primary_indices`** — an inner pair's primary
forced onto its PARENT component's slot — is replicated, by
`reHomeToParent`. It was left out while it only changed *which* index
anchors a pair, which root-grouping and the brightest-participant pick
absorb. That stopped being true once the primaries began admitting
components in their own right: where a component carries no identifier of
its own AND its parent does, the re-home is the only thing that resolves
the pair at all, so skipping it drops the system from the wings set
entirely. WDS 02536-6420 is the case — Ba resolves to nothing while B
(HD 18341, an addition) and synth Bb both ship, and `binaries.bin` renders
the pair through B.

The relation-winner dedup is still **not** replicated: it changes only which
of several rows wins one relation, never whether two distinct records face
each other.

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

`buildComponentDesignations` maps each component to its letter plus the
record its system's designation comes from, which the display-name
composer and the runtime's "<base> <letter>" aliases both build on
("Alpha Centauri C" / "α Cen C" → Proxima). The base expands from the
system, never the component's own designation: Proxima carries no Bayer.
The anchor is included with its own letter so "α Cen A" focuses it, and a
record shared across pairs takes first-write-wins (α Cen A appears in both
the AB and AC rows).

**The anchor is the WDS ROOT's, not the pair cursor's**, because a
component letter is stated relative to the root. WDS lists θ¹ Ori C as
component D of the θ² Ori root (`05354-0525`), so taking the cursor
primary composed that root's E as "θ¹ Ori E" — colliding with the real
θ¹ Ori E in root `05353-0523`. Two rules follow, and both cost a wrong
name before they were written:

- **The top-level letter decides which cursor primary is the anchor**,
  then depth. Comparing whole comps by length put "Aa" below every
  single-letter branch, so 15 Mon's root (`06410+0954`, whose only
  A-branch cursor is Aa,Ab) anchored on its E component and every letter
  in it composed against HD 261938. This is deliberately not promotion's
  own `isMoreCanonicalAnchor`, which picks the record a companion inherits
  its POSITION from — that choice decides where records land, so the two
  questions keep their own rules.
- **A root may not borrow its identity from a star another root already
  owns.** `05353-0524` is an Orion Nebula Cluster multiple whose only
  identified member is θ¹ Ori C, arriving as its component I, so every
  letter in it composed against θ¹ Ori — asserting an identity the data
  does not support. Refusing that anchor leaves those records on their own
  designations, which is what `docs/star-naming.md` § 8 means by a
  surviving collision being a data finding rather than a renderer
  concession.

A letter is root-relative, so a component is addressable even when its own
pair cursor is not: Rigil's `Ba,Bb` cursor has an unresolvable Ba, and
requiring the cursor to resolve left Bb with no letter and no base to
compose against. The wings pass genuinely needs both ends of a pair and
keeps `resolvePairComponents`; naming needs only the letter and the root.

Emitted as the search index's `cl` / `cp` fields —
`../../README.md` § Search index, `src/client/typeahead/README.md`
§ Star search, and `../../naming/README.md` § Two callers, one composer.
`componentDesignations` pins the total.
