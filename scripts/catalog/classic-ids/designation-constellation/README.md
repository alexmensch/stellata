# The designation constellation

IV/27A's `cst`, the constellation a Bayer / Flamsteed designation is named for,
resolved per record by designation, and the cascade above it.

## Files in this area

```
scripts/catalog/classic-ids/designation-constellation/
  designation-constellation-pure.ts
    (+ test)                      IV/27A's `cst` keyed by HD/HIP — the
                                  constellation a Bayer / Flamsteed
                                  designation is NAMED for — and
                                  `DesignationCon`, a record's value with
                                  the cascade tier that wrote it, and
                                  `designationConstellation`, a record's
                                  IV/27A value: the tier the naming ladder
                                  starts from, the record build's one
                                  classic-ID step. A `cst`
                                  naming no IAU-88 constellation fails the
                                  build: the table's abbreviations are the
                                  IAU set. Pure.
  designation-constellation.test.ts
                                  Pins the cascade's output on the WIRE
                                  (ρ Aql, 15 LMi, Fomalhaut C) against the
                                  built search index.
```

## The designation constellation

`desigCon` (search-index `dc`) is the constellation a Bayer / Flamsteed
designation is NAMED for. It is fixed by nomenclature and does not migrate when
proper motion carries a star across a
[Delporte 1930](/data/papers/index.md#delporte1930) boundary, so it cannot be
derived from the record's position. The cascade:

```
IAU WGSN designation -> IV/27A `cst` by HD -> by HIP
  -> SIMBAD's constellation for the record's own Flamsteed number
  -> GCVS trailing abbreviation -> positional conIndex
```

`DesignationCon` holds the index with the tier that wrote it (`wgsn-bayer`,
`wgsn-gould`, `iv27a`, `simbad`, `gcvs`, or `anchor` for a companion that took its system
anchor's), and for an authority tier the IV/27A index it overwrote with a
different one; `{ via: 'none' }` until a tier writes it.
[Naming lineage](../../naming/README.md#naming-lineage) records both.

The authority tops it because it states which constellation its OWN
designation is named for; this folder's route runs beneath it and is what
carries the Flamsteed-only records the authority does not reach
([The designation constellation](../../naming/README.md#the-designation-constellation)).

Keyed on the DESIGNATION, deliberately, where the label overlay is keyed on
`gaia_source_id`:

- A designation → designation cross index carries **no astrometric claim** — it
  says the star named HD 216956 is also named α PsA, never which Gaia source
  holds that star's photons — so it needs no binding gate.
- That is also the only way to reach the bright tier: Gaia saturates near
  G ≈ 3, so most records at V ≤ 3 have no overlay row at all, Fomalhaut among
  them ([Coverage](/data/classic-ids/README.md#coverage--the-overlay-is-a-union-term-not-the-label-authority)).
- Measured over the 3,303 spine rows carrying a Bayer or Flamsteed cell, the
  HD/HIP route covers 3,180 against the source_id route's 2,474, with zero
  disagreements and nothing the overlay reaches that it does not. One tier
  instead of two.

The faint Flamsteed-only records absent from IV/27A take the constellation
SIMBAD names their number in, where the Flamsteed rule accepts it
([Which SIMBAD numbers are Flamsteed numbers](../../simbad/README.md#which-simbad-numbers-are-flamsteed-numbers)):
<!-- count:build-catalog/naming.dc.simbad -->121<!-- /count --> records (`naming.dc.simbad`).

**GCVS fills the field only where IV/27A and SIMBAD left it empty**; the records whose
Bayer, Flamsteed or Gould designation then renders against it are
`naming.dc.gcvs` (<!-- count:build-catalog/naming.dc.gcvs -->0<!-- /count -->). On the
8 where the two disagree the star carries a Bayer/Flamsteed designation and a
variable name in different constellations (HD 104337 is Crater's Flamsteed star
and Corvus's TY): one `uint8` serves one of them, and IV/27A wins because its
consumers COMPOSE the label out of this field, while a GCVS label reads the
constellation out of the designation string and loses only its expanded alias
(`../../parse/gcvs/README.md`).
