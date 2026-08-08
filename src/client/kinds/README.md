# Object-kind modules

The kind-module seam from the object-kind modularity design
(`docs/architecture-modularity.md`): one module per `TargetKind`
bundles what used to be scattered across the shell's capability wiring
sites — load, layer attach, focusable/card/hover/pick legs, search
corpus rows, SID domain, pinnability, declutter pushes. Adding a kind
becomes one folder plus one roster line; adding a data population
inside a kind stays module-internal.

## Files

- `kind-module.ts` — `ObjectKindModule`, `KindContext` (the documented
  answer to "what may a layer depend on"), `KindPick`,
  `KindSearchEntry`.
- `kind-modules.ts` (+ test) — `KIND_ROSTER` (the explicit ordered
  list), the exhaustive `KindModules` mapped type,
  `buildKindModules()`, and `mergeKindDetailBinds()`.
- `kind-geometry.ts` — leg helpers shared across modules:
  `absCameraDistancePc(ctx, centerAbs)`, the card
  `cameraDistancePc` leg for every kind whose centre is absolute
  (cloud, lg). Shells go through their registry instead, which answers
  0 for an absent slot.
- `kind-context-mock.ts` — the `KindContext` fixture builder the
  module test suites share.

Modules themselves live in their kind's folder — probe
(`../solar-system/probes/probe-module.ts`, the pilot), planet
(`../solar-system/planets/planet-module.ts`, which also owns the
boot-time host attach behind its `systemsReady` promise), cloud
(`../molecular-clouds/cloud-module.ts`), lg
(`../local-group/lg-module.ts`), shell
(`../fresnel-shell/shell-module.ts`, whose internal `ShellRegistry`
holds its two instances) — and are only *assembled* here.

## Contracts that must not drift

- **`KindModules` is EXHAUSTIVE over `TargetKind`.** A kind whose
  wiring is still inline holds an explicit `null` row; a new kind
  cannot ship without stating its entry. Never weaken to a partial
  map. The `null` rows shrink as epic phases migrate kinds and the
  union of module-vs-inline wiring is always visible in one record.
- **`KIND_ROSTER` coverage is a compile-time pin too.** The record
  alone can't catch an unrostered kind — it still has a row, it just
  never loads, attaches, or answers a roster loop — so
  `RosterCoversEveryKind` collapses `KindModules` to `never` when a
  kind is missing from the list. Order and no-duplicates stay pinned
  by `kind-modules.test.ts`.
- **No self-registration.** `attach` *returns* its scene layer; the
  shell registers it at the kind's roster position. Update order is
  draw-dependency-load-bearing: module layers register in `KIND_ROSTER`
  order, ahead of every inline-wired layer, and probe leads because its
  field must write this frame's samples before the planet layer's
  moving-focal ride reads them (`../scene/README.md`).
- **Modules are stateful, per-shell instances.** `load` stores the
  artifact on the module (a load/attach pair passing the artifact
  through the shell would force `unknown`-typed hand-offs);
  `buildKindModules()` is therefore a factory, not a module-scope
  constant. `load` NEVER rejects — a missing artifact is an empty
  roster, and every leg answers absence (false / `[]` / `''` / null)
  both before `attach` and after an artifact-less one.
- **`KIND_TRAITS` stays in `../camera/focus/focus-target.ts`.** The
  contract file is a leaf; folding hard/moving into modules would make
  it import every kind folder.
- **Declutter pushes route by element id, not by name.**
  `mergeKindDetailBinds()` flattens every module's `detailBinds()` into
  one `SceneElementId`-keyed record and the shell's `set(id)` helper
  applies `kindPush[id]` for EVERY row of its exhaustive record — a
  migrated kind adds no line to `buildSceneElementBinds`. Two kinds
  claiming one element throws at merge rather than silently clobbering.
- **One pick function per kind, and it lives on `hover()`.** There is
  no separate `pick` leg to keep in sync: `KindPick` IS
  `HoverProvider['pick']`, and `collectKindPicks()` reads it off the
  module's hover provider for the Picker. A kind that wants a click
  pick supplies a hover provider.
- **Kind-specific machinery stays out of the contract.** The shell may
  hold a module's concrete type for cross-kind wiring (the solar-system
  cluster reads `kinds.probe.field` for its local-depth mirror); the
  `ObjectKindModule` legs cover only the shared surfaces, and an
  optional leg appears at its second consumer, never speculatively.

## How the shell and boot consume it

`main.ts`: `buildKindModules()` → `load` per roster entry inside the
boot `Promise.all` → hand the record to `new Stellata({kinds})` →
roster loops for SID domains (`sids()`, null ⇒ conclude), hover
providers, label overlays, and the search corpus
(`createSearchRunner(catalog, raw, kinds)` — no per-kind parameters;
boot awaits `stellata.planetSystemsReady` first, since planet corpus
rows bake flat Target indices the attach table supplies).
`stellata.ts`: the constructor builds one `KindContext` and
attach-loops the roster at the layer-construction point; `setT` fans
out `clockJumped`, `setFocalBodyHidden` fans out `setFocalHidden`,
`buildSceneElementBinds` applies the merged `detailBinds()` pushes,
and `collectKindPicks()` hands the Picker each module's hover `pick`
for its `pickKindHit` dispatch (the click FSM's planet / cloud / lg /
shell / probe picks all route through it). The `focusables` record and
`PoiStore.pinnable` rows for migrated kinds are the modules'
`focusable()` / `pinnable` legs; both records stay exhaustive in the
shell.

Planet-kind exceptions the roster consumers must know: its SID domain
is keyed body-within-host, not Target idx — url-state translates at
the boundary (`IdMaps.planetDomainIndexOf`); its SVG labels stay wired
in `main.ts` (`createPlanetLabels` reads the shell's orbit-rings layer
and focused planet system, both outside the module); and its mesh
layer's update lives on the shell, after the moving-focal ride
(`../scene/README.md`).
