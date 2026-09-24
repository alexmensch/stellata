# SID resolver

Runtime half of the Stellata ID system ([§ 8](/docs/sid.md#8-runtime-resolver-b4); the build-time
registry lives under `scripts/sid/` + `data/sid/`). One global
`SidResolver` maps a wire SID to `{ kind, localIndex }` in the runtime
object model — the same `kind`/index currency `FocusTarget`, hover
providers, and search entries use — without any consumer knowing which
artifact carries the object.

```
sid-resolver.ts (+ test)   SidResolver (domain roster, attach/conclude
                           lifecycle, resolve, deferred intents, reverse
                           sidOf), arrayDomain (domain over an artifact's
                           sid column), sidColumnError (loader-side parse
                           validation shared by cloud + LG loaders).
index.ts                   Re-export.
```

## Domain lifecycle

The resolver is constructed with a **roster** — every domain kind this
client may ever attach (`star`, `planet`, `cloud`, `lg`, `shell`,
`probe`). Each domain then reaches exactly one terminal state:

- **attached** — its artifact loaded; `attach(kind, domain)` wires a
  `{ localIndexOf, sidOf }` pair over the artifact's sid column.
- **absent** — its artifact will never load this session (missing file,
  shelved layer); `conclude(kind)` records that so resolution can stop
  waiting for it.

`resolve(sid)` first canonicalises through the **successor map**
(retired sid → successor sid, [§ 9.4](/docs/sid.md#94-migration-semantics--exact-table)) — built at catalog
build time from `retirements.tsv` net of `reinstatements.tsv`, shipped
as the catalog manifest's `sidSuccessors` side-field, and passed to
the constructor. Chains are followed to their live end (a corrupt
cycle resolves `unknown`); a retired sid never appears in any artifact
(CI-guarded), so canonicalising before the domain walk is lossless.
The map is empty until a merge-type retirement ships (all committed
retirements today are successor-less). It then returns:

- `{ status: 'resolved', kind, localIndex }` — an attached domain
  claims the sid. Domains are consulted in roster order, so `star`
  wins any (never-expected) cross-domain collision deterministically.
- `{ status: 'pending' }` — no attached domain claims it AND at least
  one rostered domain is still neither attached nor concluded.
- `{ status: 'unknown' }` — every rostered domain has settled and none
  claims it (successor-less retired/parked sid, or a URL from a newer
  deploy carrying an object type this client doesn't ship). sid 0
  (`NO_SID`) and non-positive values are `unknown` immediately.

## Deferred intents

`whenResolved(sid, apply)` is the "apply a URL without blocking on a
late artifact" contract: resolved → `apply` runs synchronously; pending
→ the intent queues and the `attach`/`conclude` that settles it either
fires it or expires it silently. Consumers never observe a throw for a
sid whose artifact is absent or disabled.

## Wiring map (who attaches what, where)

All in `main.ts`, keyed off the same artifact loads that gate each
layer:

| kind | attach point | sid source | localIndex meaning |
| --- | --- | --- | --- |
| `star` | after catalog load | `catalog.sid` column (`arrayDomain`) | catalog record index |
| `planet` | boot | `SOL_OBJECT_SIDS` in `SOL_BODIES` order | index into `SOL_BODIES` (planets then moons) |
| `probe` | boot, after `loadProbes` resolves | `SOL_OBJECT_SIDS` in LOADED-roster order | ProbeField roster index = Target `{kind:'probe'}` idx |
| `lg` | after `loadLocalGroup` resolves (concluded when the artifact is missing) | `local-group.json` per-object `sid` | `LgCatalog.objects` index |
| `cloud` | after `loadClouds` resolves (concluded when the artifact is missing) | `clouds.json` per-object `sid` | `CloudCatalog.clouds` index |
| `shell` | boot (both sids static) | `SHELL_OBJECT_SIDS` in `SHELL_KEYS` order | `SHELL_KEYS` index = Target `{kind:'shell'}` idx |

`SOL_OBJECT_SIDS.sun` is deliberately NOT in the planet domain: Sol's
catalog record carries the same sid (same-as edge, [§ 7](/docs/sid.md#7-storage--sid-in-every-artifact)), so
the star domain claims it and a "sun" focus resolves to the Sol record.

One table, two domains: `SOL_OBJECT_SIDS` backs both `planet` and
`probe` because both mint from `sol-objects.tsv`. They stay separate
domains because their localIndex spaces are different arrays — a probe
is not a `SOL_BODIES` row. The probe domain is keyed over the LOADED
roster rather than `PROBE_MISSIONS`: `loadProbes` drops a probe whose
artifact is missing, and localIndex must equal the Target idx. A
dropped probe's sid then resolves `unknown` while the survivors keep
resolving — no index shift.

## Scope

Identity substrate only: resolution says which object a sid names, not
what focus/hover does with it. One wrinkle for the planet domain: its
localIndex (planet-within-host, host implicit — Sol today) is NOT the
Target `{kind:'planet'}` currency (the PlanetBodyField flat instance
index) — the URL layer translates through `IdMaps.planetDomainIndexOf`
/ `planetTargetIndexOf` (wired in `main.ts`). Routing the runtime's
index-keyed APIs through this resolver is `stellata-9mm.227`; POI
generalisation to non-star kinds is `stellata-o6nx.1`.

## A domain that is still filling

`SidDomain.isComplete` is the third state between "attached" and "not
attached". A domain that answers `false` makes a **miss** indeterminate
rather than absent: the sid may sit in a part of the artifact that has not
arrived, so resolution stays `pending` and the intent queues instead of
being dropped.

The star domain needs it because the catalogue streams
([Progressive catalog load](../../loaders/README.md#progressive-catalog-load)). The alternative —
withholding the domain until the last chunk lands — looks safer and is
worse, because **order matters, not just eventual correctness**: with a
focus present the URL encoder elides `worldOffset`, so the restored
`cam`/`tgt` are expressed in the focal object's local frame. A focus that
resolves after they are applied puts the camera in the wrong frame and then
recentres out from under it. A star in the first chunk — which is most of
them, the order being apparent brightness — has to resolve *synchronously*,
during `applyFromUrl`, for the restore to be right.

`arrayDomain` takes an optional `loadedCount` thunk for this. It indexes
lazily up to that bound on every lookup, so a growing column needs no
re-attach; the owner calls `SidResolver.refresh()` as it fills, which is
what retries the queued intents. When the column completes, `isComplete`
starts answering `true` and a sid nothing carries finally settles to
`unknown` instead of holding its intent open forever.
