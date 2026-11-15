# system-membership — the wire contract

`system-membership-format.ts` — `public/system-membership.json`'s schema and
both directions of its codec: which catalogue records form one physical
system, how its subsystems nest, and each record's known companions that have
no record of their own. The build that writes it is
[`/scripts/catalog/system-membership/`](/scripts/catalog/system-membership/README.md);
the client reading it is stellata-jel8.32's wings pass and the hover
roster.

**Membership, not rendering.** Nothing in the file names wings, glyphs or
visibility: whether a system draws as one point is the client's per-frame
decision, made on live positions.

## Shape

- **`systems`** — one `MembershipSystem` per physical system: its `root`
  group and the `sources` (`wds`, `ccdm`, `geometric`) that joined at least one
  of its records.
- **Nodes.** A `RecordNode` is a catalogue record index — true only for the
  `catalog.bin` written by the same build, like every record index the build
  ships. A `GroupNode` has two or more children and, for a WDS subsystem, its
  component token (`B` for Castor B's `Ba`/`Bb`; `AB` for an unresolved
  compound). Every record appears at most once in the whole file.
- **`companions`** — per record, the kinds of known companion the catalogue
  holds no record for: `eclipsing-partner` (GCVS eclipsing type),
  `simbad-multiple` (SIMBAD `otype = '**'` with nothing resolving it — the
  `MULTIPLICITY_UNRESOLVED` population), `ccdm-companion` (the record is the
  only catalogue member of its CCDM / curated visual-double system). Emitted
  as evidenced: the evidence cannot say whether that companion is also a
  record in the same system, so a record already drawing a partner can still
  carry one (Algol Aa1's `eclipsing-partner` is Aa2).

A record leaf generalises to other object kinds — an exoplanet host's planets
can join for hover cards — by adding a node kind; the client's
`SystemMember` (`/src/client/system-membership/`) is the consumer contract.

## Wire

```json
{"version":1,
 "systems":[{"sources":["wds","ccdm"],"root":{"children":[{"component":"A","children":[3,40]},500]}}],
 "companions":[[3,["eclipsing-partner"]]]}
```

A record leaf is its bare index; a group with no component omits the key.
`parseSystemMembership` throws on a version mismatch, an unknown source or
companion kind, sources or kinds out of declaration order, a group with fewer
than two children, a single-record root, or a record in two places.
