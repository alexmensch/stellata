# Post-sort record addressing

Resolving `data/binaries/multiples.tsv` rows back to `catalog.bin` record
indices *after* the final record sort, and the two passes that need
nothing else: the chart-mode wings bit and the component-letter search
designations. Promotion itself is `../README.md` — it runs before the
sort and never reads anything here, so this folder is downstream of it
in one direction only.

## Files in this area

```
scripts/catalog/companions/record-index/
  record-index.ts (+ test)   buildCatalogRowIndexMap (the sidecar), and
                             the readers of resolvePairs' pairs:
                             wingRenderablePrimaries,
                             renderableOrbitRelations (the overlap gate's
                             exemption, ../README.md#overlap-gate),
                             resolvedMemberIndices (the
                             MULTIPLICITY_RESOLVED set),
                             buildComponentDesignations.
  catalog-row-index-map-pure.ts
                             CatalogRowIndexMap (the sidecar's shape),
                             resolveMultiplesIdx (gaia → hip → synth) and
                             synthSlotIdx (the blended-sibling retry): how
                             one multiples.tsv component resolves to a
                             record; the file's serializer and its parse,
                             which throws on a missing section or sha1, a
                             non-index entry or a malformed pair cell.
  catalog-row-index-map-source.ts
                             CATALOG_ROW_INDEX_MAP, the sidecar declared.
  pair-resolution-pure.ts (+ test)
                             resolvePairs: each multiples.tsv pair's two
                             ends as records — `own`, each end through its
                             own row, and `rendered`, after the parent
                             re-home — the one resolution every reader of a
                             pair takes; distinctEnds.
```

## The parent re-home

An inner pair's primary is forced onto its PARENT component's record: the
parent pair is `assignParentRelations`' pick
(`/scripts/binaries/pairs-pure.ts`), and the slot is whichever end of that
pair carries the parent token, walked outer-first so a deeper nest takes its
parent's re-homed slot. This is the shared-slot invariant the runtime walk
rides ([Hierarchical walk](/src/client/binaries/README.md#hierarchical-walk)).
Castor Ba carries A's blended source, so its own resolve lands on A's record;
AB already resolved B. Where a component carries no identifier of its own
AND its parent does, the re-home is the only thing that resolves the pair at
all: WDS 02536-6420's Ba resolves to nothing while B (HD 18341, an addition)
and synth Bb both ship, and `binaries.bin` renders the pair through B. A
parent slot that resolves to nothing leaves the primary on its own resolve. `rendered` carries the result; `own` keeps each
end's own resolve for the readers that ask which records a row backs.

## The sidecar and how a component resolves

`buildCatalogRowIndexMap` runs after the sort, and the build emits
`build/catalog-row-index-map.json` with three lookup sections — `byGaia`,
`byHip`, `bySynth` — plus `pairs`, each pair's `rendered` ends keyed by
system_id (`[primary, secondary]`, `null` where an end addresses no record),
and `multiplesSha1`, the sha1 of the `multiples.tsv` the build consumed,
taken from the runner's handed input map. `build:binaries-runtime` reads
`pairs` alone and resolves nothing. Record indices are only true for that
copy of the file, so it refuses to emit unless the `multiples.tsv` it reads
has the same sha1; the lookup sections stay for the golden's fixture cut
(`/scripts/binaries/golden/README.md`).
`catalog-row-index-map-pure.ts` is how one
`multiples.tsv` component resolves through it, and `resolvePairs` is its one
caller: `resolveMultiplesIdx` walks gaia → hip → synth, then
`synthSlotIdx` re-homes each pair end onto its own distinct synth slot
whenever promotion minted one. A
synth slot exists only for a row whose ids were inherited then stripped, so
it is always the truer target (Castor Ca inside the outer pair,
`04049-3527`'s pair-mate-inherited C). `CATALOG_ROW_INDEX_MAP`
(`catalog-row-index-map-source.ts`) is the declaration its readers open the
file through.

`resolvePairs` is the one walk over the pairs, and every reader takes its
answer: the wings pass, the overlap gate's exemption, the multiplicity member
set, the component designations, and — through the sidecar's `pairs` —
the `binaries.bin` writer (`/scripts/binaries/runtime-binaries-pure.ts`). `/tests/integration/multi-star-regression.test.ts`
still pins the baked catalogue against the real artifact.

**`bySynth` also carries bridged keys.** A component whose row carries no
identifier is addressable only under its synth key, and where promotion
refused the mint because a stored same-as edge names a Gaia source already in
the catalogue ([Same-as bridge to an already-admitted source](../README.md#same-as-bridge-to-an-already-admitted-source)),
the key maps onto that source's record — or the star ships with no component
letter, no search entry and no `binaries.bin` pairing. A record that owns the
key outright wins over a bridge. Addressing only: the record's own
designations stay the manifest's.

The writer's relation-winner dedup stays the writer's: it changes only which
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

- **Renders-a-companion gate.** A WDS system qualifies when at least one
  of its pairs' `rendered` ends are DISTINCT records — a companion
  `binaries.bin` draws.
- **One glyph per WDS system, on its brightest member.** The bit lands on
  the intrinsically brightest record any of the system's pairs resolves to,
  `own` or `rendered` ends alike (the mutual-primary / CCDM brightest-member
  contract) — whether or not that record is an end of a drawn pair. `A,BC`
  with BC an unresolved compound draws only B against C, and the glyph
  still lands on A. A hierarchical system (Castor Ca,Cb inside the outer
  pairs) gets one glyph on the system anchor, never one per inner pair. A
  system any earlier pass already flagged on any member is skipped, so it
  keeps its single glyph.
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

`resolvedMemberIndices` is the record set the `MULTIPLICITY_RESOLVED`
status covers (`../../multiplicity/README.md`): both `own` ends of every pair
whose primary resolves. A blended primary whose members all collapse onto it
counts, since the row exists for it even with nothing rendered apart.

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
  then token length. Comparing whole comps by length put "Aa" below every
  single-letter branch, so 15 Mon's root (`06410+0954`, whose only
  A-branch cursor is Aa,Ab) anchored on its E component and every letter
  in it composed against HD 261938. `isMoreCanonicalAnchor`
  (`/scripts/binaries/component-tokens-pure.ts`) is promotion's predicate too, imported: the
  position anchor and the naming anchor ask different questions of the
  same root, but both want the branch the root is named for, and the
  length rule got that wrong for either.
- **A root may not borrow its identity from a star another root already
  owns.** `05353-0524` is an Orion Nebula Cluster multiple whose only
  identified member is θ¹ Ori C, arriving as its component I, so every
  letter in it composed against θ¹ Ori — asserting an identity the data
  does not support. Refusing that anchor leaves those records on their own
  designations, which is what [§ 8](/docs/star-naming.md#8-parity--the-gate-on-any-naming-change) means by a
  surviving collision being a data finding rather than a renderer
  concession.

Designations read each pair's `own` ends. A letter is root-relative, so a
component is addressable even when its own pair's primary is not: Rigil's
`Ba,Bb` pair has an unresolvable Ba, and requiring the primary to resolve
left Bb with no letter and no base to compose against. Naming needs only the
letter and the root.

Emitted as the search index's `cl` / `cp` fields —
[Search index](../../../../src/catalog-format/record/README.md#search-index-publicsearch-indexjson), [Star search](/src/client/typeahead/README.md#star-search),
and [Two callers, one composer](/src/catalog-format/naming/README.md#two-callers-one-composer).
`componentDesignations` pins the total.
