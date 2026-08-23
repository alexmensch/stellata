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
  `buildKindModules()`, `loadKindModules()` (boot's fan-out, where the
  never-rejects rule is enforced), `displayNameOf()`,
  `collectKindPicks()`, and `mergeKindDetailBinds()`.
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
holds its two instances), star
(`../star-pipeline/star-module.ts`, the one `critical: true` module —
its catalog load blocks first paint and may reject) — and are only
*assembled* here.

## Contracts that must not drift

- **`KindModules` is EXHAUSTIVE over `TargetKind`.** Every kind is
  migrated, so every row is a module today; the type keeps admitting
  an explicit `null` row so a future kind can land its entry before
  its module. Never weaken to a partial map.
- **`KIND_ROSTER` coverage is a compile-time pin too.** The record
  alone can't catch an unrostered kind — it still has a row, it just
  never loads, attaches, or answers a roster loop — so
  `RosterCoversEveryKind` collapses `KindModules` to `never` when a
  kind is missing from the list. Order and no-duplicates stay pinned
  by `kind-modules.test.ts`.
- **`KindContext.webgpu` is null on the shipped boot, and a kind that
  ignores it stays correct.** A WebGPU boot never renders
  `KindContext.scene`, so an unported kind's meshes are inert there
  rather than wrong; a kind whose layers HAVE ported reads its TSL
  surfaces — and the scene those meshes belong in — off the seam
  (`../webgpu/README.md`). Both solar-system kinds do today.
- **No self-registration.** `attach` *returns* its scene layer; the
  shell registers it at the kind's roster position. Update order is
  draw-dependency-load-bearing: module layers register in `KIND_ROSTER`
  order, ahead of every inline-wired layer — and it is that boundary,
  not the order within the roster, that keeps every moving-body field
  fresh for the moving-focal ride, which is the first INLINE entry
  (`../scene/README.md`). No inter-kind draw dependency exists inside
  the roster today; `kind-modules.test.ts` pins the order so a reorder
  is a deliberate render-order change.
- **Modules are stateful, per-shell instances.** `load` stores the
  artifact on the module (a load/attach pair passing the artifact
  through the shell would force `unknown`-typed hand-offs);
  `buildKindModules()` is therefore a factory, not a module-scope
  constant. A missing artifact is an empty roster: every leg answers
  absence (false / `[]` / `''` / null) both before `attach` and after
  an artifact-less one.
- **A rejected `load` is fatal only for a `critical` kind.**
  `loadKindModules()` — boot's fan-out — propagates the critical
  module's rejection into boot's catch (the error screen) and swallows
  every other kind's, so the rule is enforced at the seam rather than
  trusted per module. `critical` is star-only today: the app has
  nothing to render without the catalog. Nothing else may set it
  without the same argument.
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
- **Work that lands between ticks calls `ctx.requestRender(reason)`.**
  Frames are on demand (`../render-gate/README.md`) and the gate cannot
  see a module's async landings, so a texture resolving or a deferred
  fetch completing must ask for the frame that shows it. The planet mesh
  layer's texture load is the one live caller; a module whose landings
  all route through `attach` or a bus emit already has it covered. The
  `reason` is a short stable slug the render watcher prints, so a frame
  rate pinned by one of these is attributable after the fact.
- **A module's returned layer declares its `timeBehaviour`**, like every
  other scene layer (`../scene/README.md` § Declaring how time moves a
  layer). Five modules attach a layer and all five declare: planet and
  probe report a rate off their field, cloud / lg / shell are `'static'`
  (fixed positions, event-driven visibility). Star returns null, so it
  has nothing to declare.
- **Kind-specific machinery stays out of the contract.** The shell may
  hold a module's concrete type for cross-kind wiring (the solar-system
  cluster reads `kinds.probe.field` for its local-depth mirror); the
  `ObjectKindModule` legs cover only the shared surfaces, and an
  optional leg appears at its second consumer, never speculatively.

## How the shell and boot consume it

`main.ts`: `buildKindModules()` → `loadKindModules()` inside the boot
`Promise.all` (the critical module gets the loading-bar `onProgress`
callback and is the one load allowed to reject) → boot reads
`kinds.star.catalog` / `.searchIndex` / `.starLabels` back for the
consumers that aren't kind modules (chart mode, the planet card's host
breadcrumb, the search corpus) → hand the record to
`new Stellata({kinds})` → roster loops for SID domains
(`sids()`, null ⇒ conclude), hover providers, label overlays, and the
search corpus (`createSearchRunner(catalog, raw, kinds)`; boot awaits
`stellata.kinds.planet.systemsReady` first, since planet corpus rows
bake flat Target indices the attach table supplies).
`stellata.ts`: the constructor builds one `KindContext` and
attach-loops the roster at the layer-construction point;
`notifyClockJumped` fans out `clockJumped` — called by `setT` and by the
scrubber's Jump / Reset, which move the `VirtualClock` directly to keep
the current rate; `setFocalBodyHidden` fans out `setFocalHidden`,
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

Star-kind exceptions: the render layers are shell-wired engine
machinery, so `attach` returns null and the legs read the shell
through the injected `StarModuleRuntime`
(`../star-pipeline/README.md`); `searchEntries()` answers empty — the
star corpus enters `createSearchRunner` through `buildSearchIndex`'s
richer channel (designation-tier labels + direct-lookup ID maps);
`card()` is the one leg that THROWS instead of answering absence,
because a card built before load + attach would read the clock as
J2000 and pass it off as sim time; and `Catalog` stays a `Stellata`
constructor param — the shell's engine services consume it far too
widely to route every read through the module.
