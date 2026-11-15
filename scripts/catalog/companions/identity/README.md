# Promotion identity

Which record a `multiples.tsv` pair row names, decided before companion
promotion places or mints anything (`../README.md`): a record the catalogue
already holds, one this build minted from an earlier row, a refusal, or a new
record with the identifiers that survive the inheritance gates. Each answer
is a value; adopting a held record or minting a new one is the walk's
(`../companion-promotion.ts`).

## Files in this area

```
scripts/catalog/companions/identity/
  system-index.ts (+ test)    SystemIndex, built once over the rows and the
                              records held before promotion (#the-system-index).
  row-identity.ts (+ test)    resolveRowIdentity, the per-row gates below in
                              their order, and MintedIds, the records this
                              build minted by the ids they carry.
  parked-refusals.ts          ParkedRefusals and refusalStated
                              (#refused-parallax-refusal).
```

## The system index

`SystemIndex` holds the pair rows grouped per `system_id` (a standalone row
sits in a cursor with no primary), the held records indexed by Gaia source,
HIP and `proper` cell (first-wins), each WDS root's canonical anchor and its
single-letter components. Nothing promotion mints is in it: those are
`MintedIds`, filled as the walk mints.

- **`findExisting`** — a secondary's record: Gaia first, HIP only when the
  row carries no Gaia source at all, so a companion sharing its primary's HIP
  (Sirius A and B, HIP 32349) does not collapse onto the primary's record.
- **`findExistingPrimary`** — a cursor primary's record: Gaia, then HIP even
  when Gaia is set (70 Oph A holds only its HIP), then a position-guarded
  proper name for a row carrying neither id (ξ UMa A). An unresolvable
  primary would otherwise run its whole cursor anchor-less.
- **`rootAnchor`** — the root's canonical primary among those
  `findExistingPrimary` resolves, by `isMoreCanonicalAnchor`
  ([Promoted-companion field inheritance](../README.md#promoted-companion-field-inheritance)).
- **`isUnresolvedCompound`** — WDS shorthand for an unresolved aggregate:
  2+ characters, every one a single-letter comp elsewhere in the same root.
  40 Eri's `A,BC` row carries `comp="BC"` while the root also has resolved
  `BC` / `AC` cursors with single-letter primaries B and C, so "BC" is the
  B+C aggregate, not a star; promoting it would add a "Keid BC" ~416 AU from
  Keid beside the resolved Keid B and Keid C, double-counting their light
  and position. Counted `promotion.dropped.compound-comp`.

## Row identity

`resolveRowIdentity` runs these in order; the first that answers wins.

### Gaia and HIP inheritance gates

Gaia resolves only the blended photocentre of a sub-arcsec pair, so Stage
2/3 bind the SAME source_id to both component rows (2090 tight pairs); and
multiples.tsv carries the primary's HIP on both rows when AT-HYG had one
entry for the system (Sirius A and B, HIP 32349). An id equal to the anchor
row's — or the anchor RECORD's, since propagation and SIMBAD's cross-IDs can
bind the shared id to a row whose anchor-row cell is empty — is inherited,
and stripped from the new record: kept, it would collide with the primary in
every gaia- or HIP-keyed lookup (url-state's `refFromIndex` decodes
first-wins). A row whose ids all strip mints `synth-<wds_id>-<comp>`,
flagged `FLAG_BINARY_COMPANION_SYNTHETIC` (Algol Aa,Ab + Aa1,2), and
build-runtime-binaries retries the synth key when its id-first resolve
degenerates. `idsInheritedFromAnchor` travels on: it makes a mint's
anchor-dim membership structural, and an escape row's "own" photometry the
anchor's blend.

### Held by its own id

A row whose own Gaia source or HIP names a held record that ISN'T its anchor
is that record (`promotion.adopted.own-id`); so is a row whose own Gaia
source missed the index but whose own HIP names a non-anchor record
(`own-hip` — the G−V gate can scrub a source from a record while
multiples.tsv keeps it). A hit EQUAL to the anchor through an inherited id is
the Sirius-B shape, and promotes.

### Anchor-is-the-component refusal

A pair whose two ends resolve to ONE record has no second star to mint.
`01398-5612`'s A row carries the B record's HD, HIP and Gaia cells, so the
cursor anchors on B and the B row's ids strip as inherited — the Sirius-B
shape by identifiers alone, except the companion is already a record. Minting
baked a twin 93 AU off its own original and `binaries.bin` drew the pair's
468-yr orbit between the two copies. The naming authority's component
attribution is the independent witness: where it already letters the ANCHOR
as the row's own component, that record IS the component. Counted
`promotion.dropped.anchor-is-component` (<!-- count:build-catalog/promotion.dropped.anchor-is-component -->3<!-- /count -->: p Eri B, `f Pup C`, `α Psc` B), a
ratchet-down metric, since each is a mis-keyed multiples.tsv row upstream.
The letters themselves are contested — WDS, the authority and Gliese disagree
per system — so the gate refuses the duplicate without adjudicating the
letter. It **reaches only roots the authority attributes a Bayer designation
in**; one with no Bayer letter offers no witness, which is why the `Gl 277A`
duplicate needs a membership fix instead. `applyStarNames` runs before
promotion, which is what puts `bayerComponent` on the record in time.

### Earlier mint

A row whose surviving Gaia source, HIP or synthetic key an earlier row
already minted is that record (`promotion.adopted.earlier-mint`): two pair
rows of one system can name the same component, and 40 Eri B, minted in the
BC group, anchors BD and BE.

### Refused-parallax refusal

A row never promotes when the distance it STATES is a parallax a tier above
refused — `refusalStated` matches the cell against every refused value
indexed under the row's ids, and returns the parked record's origin key,
which the row's lineage cites. Sharing the id is not enough: Stage 2/3 bind
one blended source to every component of a sub-arcsec pair, so a parked
primary's id reaches siblings stating the ANCHOR's distance (α Her's B, Ba,
Bb) as well as siblings re-serving the refusal (WDS 01425+5000 comp B). Runs
**before** the inheritance gates strip the ids, which would leave a synth
record at whatever the row states. Counted per astrometry route,
`promotion.dropped.parked-record.other-route`
(<!-- count:build-catalog/promotion.dropped.parked-record.other-route -->8<!-- /count -->) and `.gaia-5p`; `promotion.fit.owned` (<!-- count:build-catalog/promotion.fit.owned -->0<!-- /count -->)
counts refused rows carrying an owned id on a per-component route — what a
non-zero means, the tolerance and the wider-join caveat in
[Companion promotion](../../distance/parallax/README.md#companion-promotion-may-not-walk-a-refused-measurement-back-in).

### Same-as bridge to an already-admitted source

A row with no id of its own mints `synth-<wds_id>-<comp>`, and the held-record
test above has nothing to match on — so when a deeper magnitude floor admits
the same physical star on its Gaia source, both ship and one object is drawn
twice, 100 pc apart. The SID registry's same-as edges are the only witness
of the link (`syntheticGaiaBridges` over `data/sid/sameas-overrides.tsv` +
`bridges/`, [§ 4.1](/docs/sid.md#41-same-as-equivalence-graph)): a bridged
source already in the catalog IS this component, so the mint is refused and
that record is held (`promotion.adopted.sameas-bridge`, a ratchet-DOWN
metric).

Every held answer — own id, own HIP, same-as bridge — reaches
`adoptExistingMember` in the walk: the anchor's designation constellation,
the [re-curation](../README.md#re-curation-of-an-already-in-catalog-member)
and anchor-dim registration.
