# System membership

Builds `public/system-membership.json` during `build:catalog`: which
catalogue records form one physical system, how its subsystems nest, and
each record's known companions with no record of their own. The wire
contract is `/src/catalog-format/system-membership/`. It decides nothing
about rendering — wings are the client's per-frame call on live positions.

Runs after the record sort, the geometric pass and the pair resolution, so
every record index is final, and reads only what those passes already
decided: it changes no record, no flag, and nothing in `catalog.bin` or
`binaries.bin`.

## Files in this area

```
scripts/catalog/system-membership/
  wds-trees-pure.ts (+ test)        wdsTrees: each WDS system's tree from the
                                    pair resolution's rendered ends, after
                                    the shared-record gate (#wds-trees).
                                    normalized: empty groups dropped,
                                    one-child groups collapsed.
  system-membership-pure.ts         buildSystemMembership: the three sources
    (+ test)                        gated and unioned into one tree per
                                    system (#the-union), the no-record
                                    companions, and the count block;
                                    lentDistanceRecords and
                                    anchorMovedRecords (#geometric-pairs).
                                    The test includes the shuffle test:
                                    permuting every source's input order
                                    changes no byte of the output.
```

## Evidence sources

Every source forms systems, and every physical-reality gate stays the
build's:

- **WDS** — `data/binaries/multiples.tsv`'s kept pairs (Stage 5's
  physical/optical verdict and 1 pc tidal limit already applied), through
  `resolvePairs`' `rendered` ends (`../companions/record-index/README.md`).
- **CCDM** — `doublesEvidence`'s groups (`../multiplicity/README.md`): the
  Hipparcos CCDM groups past the `MultFlag` filter plus `KNOWN_VISUAL_DOUBLES`.
  The optical-double gate applies **per member** (`isOpticalDoubleMember`):
  a member whose nearest same-group member, both at Gaia-quality distances,
  sits beyond `OPTICAL_DOUBLE_MIN_SEP_PC` (1 pc) leaves the group. In a
  two-member optical group, each is the other's optical double, so both
  leave. The gate never fires on missing evidence, nor on a member with
  physical-pair evidence or an eclipsing type — the wings pass's exemptions,
  one predicate.
- **Geometric** — `mutualPairs` over the 0.005 pc pass's `companionIdx`.

### Geometric pairs

A geometric pair joins records only when both distances are the members' own
measurements. `lentDistanceRecords` marks the others: a minted companion
(`FLAG_BINARY_COMPANION_ONLY`, placed at its anchor's distance), a record on
`pair_member_parallax` (a sibling's parallax), and a member coherence snapped
or promotion re-curated onto its anchor's distance. Two records sharing one
distance sit 0.005 pc apart only because of the sharing, so the pair is an
artefact (`systemGeometricLentPairs`). Measured 2026-11-15 before the gate:
of 48 mutual pairs no WDS or CCDM system backs, 9 had a lent member.

## WDS trees

Per WDS id, every component token of its pairs becomes a group and each
record a leaf. A record reached under several tokens of one system sits at
the most specific — a component before a compound, longer before shorter,
then the canonical-anchor order — which is where the parent re-home put it
(Castor B's record is `Ba`). A pair whose two ends resolve to one record
(an unresolved close pair one entry stands for) places it at the ends'
nearest shared token — `Aa`,`Ab` → `A` — or at the root when they share
none. Reached under unrelated tokens otherwise it is a data defect, placed
the same way and counted (`systemWdsTokenConflicts`). A
component's parent is its nearest ancestor token present (`Aa1` → `Aa` →
`A`), else the smallest compound holding its letters (`B` → `BC`), else the
root. Empty groups drop and one-child groups collapse, so a group with a
component token always holds two or more stars.

**A record claimed by several WDS ids** (the pair resolution matched it under
rows of different ids, `stellata-hooj.57`). Roots never merge on it:

1. **Identity.** It leaves each claiming id whose own coordinates
   (`wdsIdPosition`) lie farther than `WDS_IDENTITY_MAX_ARCMIN` (30′) from it.
   This tests whether the record is the star WDS lists, not whether it is
   bound. It is consulted only for a record several ids claim, since a single
   WDS entry can list a component degrees away (Proxima, 2.2° from α Cen's
   id). On 2026-11-15 the 3 mis-bound records sat ≤ 0.6′ from one id and
   ≥ 94′ from the other, and the 14 cluster-field records ≤ 3.1′ from all,
   so any bound in between gives the same result. Counted
   `systemWdsIdentityGated`.
2. **Ambiguity.** A record the gate does not leave in exactly one id joins
   none through WDS (`systemWdsAmbiguous`): in a cluster field neither sky
   nor 3D position says which system it belongs to, if any. CCDM or a
   geometric pair can still place it.

## The union

One system per connected group of evidence — WDS trees, kept CCDM groups and
qualified geometric pairs linking records:

- One WDS tree in the group: it is the base, unchanged. Several: each tree
  becomes a child of a new unlabelled root.
- A record a geometric pair joins to a base member nests with that member in
  a new two-leaf group (they lie within ~1,000 AU of each other). A pair with
  neither member in the base is a two-leaf group at the root.
- A record joined only by CCDM hangs at the root.

A labelled WDS root (`A` over `Aa`, `Ab`) stays a child, so an outsider never
takes its label. Systems are ordered by their lowest record index;
`sources` lists each source that linked at least two of the system's
records, so a WDS system whose members are also a CCDM group or a geometric
pair lists those too.

## No-record companions

Per record, emitted as evidenced — whether the companion is also a record in
the same system is unknowable from the evidence, so a record drawing a
partner can carry one too (owner decision 2026-11-15):

- `eclipsing-partner` — `varType == VAR_TYPE_ECLIPSING`.
- `simbad-multiple` — `multiplicityStatus == MULTIPLICITY_UNRESOLVED`
  (`../multiplicity/README.md#multiplicity-status`).
- `ccdm-companion` — the record is the only catalogue member of its CCDM or
  curated group, before the optical gate.

## Counts

The `multiplicity` count block carries `SystemMembershipCounts`: systems and
their records, systems per source, the four gates' counts above, and records
per companion kind.
