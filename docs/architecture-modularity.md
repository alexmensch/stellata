# Object-kind architecture — engine services, kind modules, population shards

Design gate for the object-kind modularity epic. Governs how new object
kinds (nebulae, exoplanets, cosmic-web structures, …) and new data
populations (LMC/SMC star fields, additional cloud catalogues, deep-field
galaxy tiers) join the client with bounded, local edits — and how the
integration shell (`stellata.ts`, `main.ts`) stops growing linearly with
every addition. Spans `src/client/` end to end.

## Goals

1. **Adding an object kind is one folder + one roster line.** Every
   cross-cutting affordance (camera arrival, focus card, hover, POI pin,
   search, URL round-trip, declutter floor) comes from implementing
   declared contracts, enforced at compile time — never from editing the
   shell.
2. **Adding a data population inside an existing kind is data-only.**
   An LMC star field is not a new kind; it is a shard of the star kind.
3. **Net LOC goes down.** The shell sheds its per-kind glue and its
   forwarding facade; duplicated per-kind geometry contracts merge.
4. **Nothing is precluded.** Free-fly camera mode and Gly-scale
   catalogues impose constraints on the engine tier (§ Free-fly
   constraints) that every phase must honour now, cheaply, rather than
   retrofit later.

## Where the codebase already is

The interaction layer is already kind-generic and compile-enforced —
this is the foundation the epic builds on, not a thing to re-litigate:

- `Target = {kind, idx}` sum type; focus, vector, pins, clicks, warp
  all operate on it. Per-kind branches in the shell / input FSM are a
  review-blocking defect by documented law
  (`src/client/camera/focus/README.md` § FocusableProviders).
- Exhaustive mapped types that fail `tsc` when a kind is missing:
  `FocusableProviders`, `FocusCardProviders`, `PoiStore.pinnable`,
  `SCENE_ELEMENT_FLOORS` + `SceneElementBinds`.
- Runtime registries: `SceneLayerRegistry`, the hover-provider list,
  `ShellRegistry`, `SystemMembershipRegistry`, SID resolver domains.
- The URL wire is fully kind-agnostic (SIDs; `docs/sid.md` § 10).
- Absence tolerance is uniform: a missing artifact loads to `null` and
  the layer/providers simply don't exist.

**The gap is the wiring axis, not the contracts.** Every contract is
organised by *capability* (all focus legs together, all card providers
together) and implemented inline at central wiring sites. A new kind
implements six or seven small interfaces but hand-edits six or seven
shared files to register them.

Empirical cost of the last kind added (deep-space probes, PR #296),
*outside* its own subsystem folder and *after* all the registries above
existed: `focus-controller.ts` +225, `stellata.ts` +207, `main.ts` +50,
`search.ts` +53, `picker.ts` +38, plus ~30 across the contract/union
files — **~10 central files, ~600 lines of integration glue**.

Three structural findings drive the design:

1. **Verb-oriented registries, centrally wired.** The kind's knowledge
   is smeared across the capability wiring sites (`stellata.focusables`
   is a ~130-line inline record after phase 1 folded the FocusTarget
   legs into it; `main.ts` builds card providers as ~90
   lines of inline closures reaching into shell internals). `TargetKind`
   and `FocusKind` are the same union spelled twice.
2. **Two parallel per-kind geometry contracts.** *(Closed in phase 1.)*
   `FocusableProvider` and `FocusTarget` overlapped ~60%, with per-kind
   `makeXFocusTarget` factories re-deriving legs the provider record
   already had; `FocusTarget` is now built generically from the
   provider, and hard/moving membership is declared data in
   `KIND_TRAITS` rather than a hand-maintained set.
3. **`stellata.ts` is three files in one** (2,861 lines): a legitimate
   composition root + frame loop (~900); per-kind glue that grows with
   every kind (~600); and a facade of ~90 one-line forwarding shims over
   the controllers (~500+ with doc comments) that grows with every
   controller method.

## Target architecture — three tiers

### Tier 1 — engine services (not kinds)

Kind-agnostic platform every module consumes: floating-origin / frame
anchor service, model clock, exposure + HDR, shared view uniforms,
scene + `SceneLayerRegistry`, picker engine, camera controllers.

Several of these lived *inside* star code because stars got there
first. The frame half is extracted: `src/client/frame/` owns
`FloatingOrigin` (worldOffset, the ordered recentre fan-out, the
`AnchorPolicy` seam) and `buildSharedUniforms`; `StarFrame` keeps only
the star buffer's recentre rewrite, registered as the first recentre
listener, and no non-star code reads a star material's uniforms — the
shell holds the shared map as its own field and every consumer takes
it by reference.

**`KindContext`** is the one dependency struct handed to every module —
the documented answer to "what may a layer depend on?". The pilot
(phase 2) settled the field list in
`src/client/kinds/kind-module.ts`: scene, camera, canvas, the shared
view-uniform map, `solIndex`, and accessors for the model clock,
`worldOffset`, focused Target, monochrome, declutter permission,
constellation lookup, and the frame tick. Phase 3a added the two legs
whose first consumers arrived with the soft kinds: `angularToPx()`
(every projected-size leg) and `solAbsInto()` (the heliopause anchor;
the planet kind's host attach is its second consumer). Phase 3b added
`starPhotometry()` (host-star absmag + floored radius for the planet
host attach — the star module owns catalog access from phase 5) and
the `systemMembership` read surface (hover roster cards). Exposure
still waits for a consumer.

### Tier 2 — kind modules

One module per `TargetKind`, exported from the kind's folder, bundling
what was scattered across the wiring sites. The contract as the probe
pilot (phase 2) settled it — `src/client/kinds/kind-module.ts` is the
authority:

```ts
interface ObjectKindModule<K extends TargetKind> {
  kind: K;
  critical?: boolean;         // blocks first paint (star catalog only; phase 5)
  load(baseUrl): Promise<void>;      // NEVER rejects; stores the artifact
  attach(ctx: KindContext): SceneLayer | null;  // shell registers the layer
  // capability legs, valid after attach:
  focusable(): FocusableProvider;    // merged contract, § below
  card(): FocusCardProvider<K>;
  hover?(): HoverProvider;           // its pick doubles as the click FSM's
  pinnable(idx: number): boolean;
  searchEntries(): readonly KindSearchEntry[];
  displayName(idx: number): string;
  sids(): readonly number[] | null;  // localIndex-ordered; null ⇒ conclude
  labels?(): void;                   // SVG label overlay factory (needs DOM)
  detailBinds?(): Partial<Record<SceneElementId, (on: boolean) => void>>;
  clockJumped?(t: number): void;     // model clock jumped — reseed t-sampled state
  setFocalHidden?(idx: number): void; // observe-anchor hide slot
}
```

`KindModules` — a mapped type exhaustive over `TargetKind`, preserving
the existing `tsc` guarantee (a kind missing its entry fails to
compile); kinds not yet migrated hold an explicit `null` row. **The
exhaustive-record property must not be weakened**; it is the best part
of the current design. `main.ts` boot runs `load` per roster entry
inside its `Promise.all` plus one attach loop in the shell
constructor; search / SID / hover / pick / card / pin / declutter /
clock-jump / focal-hide wiring are loops over `KIND_ROSTER`.

What the pilot taught, versus the original sketch:

- **The module keeps its own artifact** (`load` stores it; `attach`
  takes only ctx). A load/attach pair passing the artifact through the
  shell forces `unknown`-typed hand-offs or per-kind generics at every
  loop; module-internal storage preserves typing with zero shell
  knowledge. `onProgress` waits for the first consumer (the star
  catalog, phase 5).
- **`attach` runs in the shell constructor, at the roster position**,
  with artifacts loaded before construction — not post-construction
  from boot. Scene-layer registration order is update order, and every
  module layer must update before the first inline entry (moving-focal
  ride freshness), which a post-construction attach could not provide
  while inline layers still register in the constructor.
- **`hard` / `moving` stay in `KIND_TRAITS`**, not module fields: the
  contract file (`focus-target.ts`) is a leaf that must not import kind
  folders, and traits are declared data readable without instantiating
  modules.
- **`sceneElements` floors stay in `SCENE_ELEMENT_FLOORS`** (same leaf
  argument); the module contributes only the imperative pushes via
  `detailBinds`, merged into the shell's exhaustive bind record.
- **No separate `pick` leg.** The sketch's `pick?: PickSurface`
  alongside `hover?` is one capability spelled twice, kept honest only
  by convention. `KindPick` is `HoverProvider['pick']` and
  `collectKindPicks()` reads the click-pick surface off the hover
  provider — the click FSM and the hover engine run the same function
  object.
- **Modules are stateful per-shell instances**, so the record is built
  by a `buildKindModules()` factory, not a module-scope constant.
- Two legs the sketch missed: `clockJumped` (a URL restore jumps the
  clock and then applies focus before the next frame — probe samples
  must reseed at the new `t`) and `setFocalHidden` (the observe-anchor
  body hide previously hand-dispatched per kind in the shell).

Kind-specific machinery (planet host-attach,
the fresnel-shell primitive, binary orbital dynamics) stays in the kind
folder; the contract covers only the shared surfaces, and the shell may
hold a module's concrete type for cross-kind wiring (the solar-system
cluster reads the probe module's `field` for its local-depth mirror).
Per the standing
rule, a capability gains an optional leg when the second kind needs it,
never speculatively.

### Tier 3 — populations (shards within a kind)

`TargetKind` means *behavioural contract* — how the camera arrives, what
the card shows, how it picks. A **population is a data shard within a
kind module**: its own artifact, its own chunk origin, its own LOD /
streaming policy, its own SID domain. LMC stars are stars; a cosmic-web
galaxy catalogue is a shard of the galaxy kind.

- Adding a population = data + a shard entry inside the module. Zero
  new kinds, zero contract edits, zero shell edits.
- The module owns the shard→flat `Target.idx` mapping; SIDs already
  provide persistent identity per shard (resolver domains fit shards
  naturally).
- The alternative — `TargetKind` entries like `'star-lmc'` — would
  poison every exhaustive record with behavioural duplicates and is
  rejected.
- **Chunk-local coordinates** (§ Free-fly constraints) are part of the
  shard format from the first multi-shard kind.

### Stars are a module — sequenced last, not privileged

The endpoint has no privileged kinds: the star kind implements the same
`ObjectKindModule` as everything else, and multi-population star fields
are shards. But the star subsystem is also today's *provider* of several
engine services, and extracting those (float64 recentre rewrites,
epoch-advance coalescing, the pin invariant) is the riskiest work in the
epic — comfortably more than the contract phases combined. So the
contract is designed for stars from day 1, the five non-star kinds
migrate first, and the engine-services extraction + star module land
last. Boot criticality is a declared module policy (`critical`), not a
structural exception; Sol special cases (`solIndex`, default focus,
heliopause anchor, planet-system host) are data facts keyed off the star
module's API.

## Contract consolidations

### Merge `FocusTarget` into `FocusableProvider` (phase 1 — landed)

`FocusableProvider` (`localPositionInto`, `focusParkDistance`,
`arrivalRadiusPc`, `renderedSizePx`) and `FocusTarget` (`anchorInto`,
`localPositionInto`, `parkRadius`, `physicalRadius`, `applyFocus`,
`emitFocusEvents`, `chartPlateauDistance`) were parallel per-kind
geometry contracts. Phase 1 merged them: the provider record gained the
missing legs (`anchorInto`, `orbitFloor`, `chartPlateauDistance`,
`planetSystemHost`), `applyFocus` / `emitFocusEvents` became single
shared implementations reading those legs, hard/moving membership moved
to the declared `KIND_TRAITS` record, and one `parkOnFocalTarget` tail
now serves both the hard and soft entry points. The `makeFocusTarget`
switch and the six per-kind factories — the single biggest per-kind cost
centre — are gone, ahead of the module rotation.

### Facade flattening (phase 4 — landed)

The ~90 one-line forwarding shims on `Stellata` are gone; the
controllers are readonly namespaces (`stellata.focus`, `stellata.warp`,
`stellata.observe`, `stellata.aim`, `stellata.filters`,
`stellata.exposure`, `stellata.adaptation`, `stellata.pois`,
`stellata.input`, plus the already-public `hdr` / `kinds` and the
`milkyway` / `hud` layer handles) and callers write
`stellata.filters.setFilter(patch)`. Accepted cost: the loss of the
(ceremonial — the shims added no logic) single-choke-point property on
those surfaces. Dispatchers that *do* add logic are composition, not
facade — they stayed: `setCameraFov` (pixel-solid-angle sync), `aimAt` /
`aimAtConstellation` (cross-controller busy gates),
`isCameraTransitionActive` (warp ∪ observe union), `getT` / `setT`
(clockJumped fan-out), `setMonochrome`, the `attach*` family, and the
star-kind reads (`starLocalPositionInto`, `localPositions`, `uniforms`,
…) that stay inline until phase 5's star module. This phase also
collapsed the two duplicated per-kind display-name switches into
`kinds/kind-modules.ts displayNameOf` (star as the injected callback,
caller-chosen fallback).

## Guardrails — what this epic must NOT do

- **No self-registration / auto-discovery.** Scene-layer update order
  is draw-dependency-load-bearing (probe field before planet field
  before the moving ride; documented invariants). The roster is an
  explicit ordered list; a module's layers register where the shell says.
- **No speculative contract legs.** Optional members appear at the
  second consumer (standing rule in
  `src/client/camera/focus/README.md`).
- **No weakening exhaustive records to partial maps.**
- **Don't force kind-specific machinery through the contract.** The
  contract covers shared surfaces; a uniform interface that needs
  per-kind escape hatches everywhere is worse than today's explicit
  wiring.

## Free-fly constraints on the engine tier

Free-fly (6DOF camera, no focus anchor) is a *future* feature — its
design gets its own doc and epic. It is named here because it constrains
the engine-services tier, and each constraint is cheap to honour now and
expensive to retrofit:

1. **Anchor policy is pluggable.** *(Landed — `FloatingOrigin` in
   `src/client/frame/` owns `worldOffset` + the ordered recentre
   fan-out, with `AnchorPolicy` as the seam; the shell's focal policy is
   the first implementation.)* Free-fly adds a `follow` policy (recentre
   onto the camera position when `|camera − origin|` exceeds a
   hysteresis threshold). The origin is never assumed to be an object —
   `recenterTo` takes a free vec3 and `SceneLayer.recenter` is
   anchor-agnostic. Camera-follow beats nearest-object anchoring: no
   spatial query, works in voids, degrades gracefully. (A
   nearest-object query will likely exist eventually for LOD / "what's
   near me" — as a separate service, not the precision mechanism.)
2. **Shard positions are chunk-local.** Float32 absolute coordinates at
   Gly range quantise to ~10² pc — useless when the camera flies in
   (camera-anywhere principle, `CLAUDE.md`). Each shard stores positions
   relative to its own float64 chunk origin (the dust layer's existing
   pattern), so float32 per-vertex is exact at every scale.
3. **Recentring is shard/LOD-aware.** A recentre eagerly rewrites near
   shards only; far shards' sub-pixel error defers. Keeps
   continuous-flight recentring affordable as the model grows (today's
   whole-catalog rewrite is fine at hysteresis rates; shard-awareness is
   what keeps it fine at 10⁸ objects).
4. **`CameraMode` is a ≥3-state enum** (`freefly | orbit | observe`
   eventually), and every mode-switching surface (mode pill, search-row
   labels, scale bar, controller enable/disable) is enum-driven, never
   boolean. The exclusive-controller pattern (TrackballControls /
   ObserveControls toggling `enabled` in lockstep) extends to a third
   sibling. Focus-anchored machinery (pin, focal rides, epoch-follow,
   per-focus floors) already no-ops on null focus and needs nothing.
5. **The URL wire's `worldOffset` field is the free-fly pose carrier.**
   v4 already serialises unfocused-away-from-Sol poses; a third mode
   value is a routine field addition.

Deferred to the free-fly design itself: the 6DOF control scheme, speed
scaling across ~13 orders of magnitude, freefly↔orbit transition
choreography. Note: free-fly is blocked on the engine-services phase —
if it rises in priority, that phase rises with it.

## Phasing

Tracked as the object-kind modularity epic in bd; one child per phase,
dependency-linked in order. Sizing per bead-authoring rules.

1. **Merge `FocusTarget` into `FocusableProvider`** — landed.
   Self-contained, high value/risk ratio; killed the per-kind factories.
2. **`KindContext` + `ObjectKindModule` + pilot migration (probes)** —
   landed (`src/client/kinds/`). The pilot settled the `KindContext`
   field list (scene, camera, canvas, shared uniforms, solIndex, and
   accessors for t / worldOffset / focus / monochrome / declutter /
   constellation / frame-tick) and amended the contract sketch
   (§ Tier 2). It also collapsed `FocusKind` into an alias of
   `TargetKind` — half of structural finding 1.
3. **Migrate the remaining non-star kinds** — soft kinds (cloud / lg /
   shell) **landed** (`molecular-clouds/cloud-module.ts`,
   `local-group/lg-module.ts`, `fresnel-shell/shell-module.ts`);
   planet **landed** (`solar-system/planets/planet-module.ts`). What
   the soft-kind pass
   settled: `ShellRegistry` became the shell module's internal runtime
   (two instances of one module, never a top-level registry); the
   shared label engine takes a narrow host interface `KindContext`
   satisfies structurally, and label factories return teardowns the
   module runs from its scene layer's dispose — state shared with an
   overlay wired outside the module (the LG apparent-size ranking pass,
   which the MW label also reads) is ref-counted rather than owned, so
   the last release resets it; one pick per kind
   through `Picker.pickKindHit` — the cloud click's old warp gate is
   subsumed by the click FSM's `blocksClick()`, and the kind-specific
   `Picker` methods and hover-provider files are gone. What the planet
   pass settled: the module owns the boot host attach behind a
   `systemsReady` promise boot reads off the module
   (`stellata.kinds.planet.systemsReady`);
   the module's pick returns the FLAT Target index so one pick serves
   click and hover, and search-corpus rows bake it (boot awaits
   `systemsReady` before building the corpus); the moving-focal ride
   and the mesh-layer update stay on the shell as the first inline
   scene-layer entry — the ride must run between the module fields'
   writes and the mesh's camera read — and the SVG planet labels stay
   in `main.ts` (they read the orbit-rings layer + focus state, both
   shell machinery).
4. **Facade flattening** — landed (§ Facade flattening).
5. **Engine-services extraction + star module** — split into three
   sub-beads under the phase bead. **5a landed**: `FloatingOrigin`
   (frame/anchor service with the policy seam) + shared view uniforms
   out of star code (`src/client/frame/`), no non-star reads of star
   material uniforms. Remaining: **5b** star kind wrapped as a module
   (`critical: true`), **5c** shard support (chunk-local coordinates,
   shard→index mapping) proven by the contract even before a second
   population ships.

Each phase leaves the app fully working; no phase depends on a later
one. LOC expectation across the epic: `stellata.ts` → ~1,200–1,400,
`main.ts` → ~150, `focus-controller.ts` sheds its factories; net
reduction ~600–900 lines after adding the module files.

## Open questions (settled during implementation, not blockers)

- Exact `KindContext` field list — pilot migration (phase 2).
- Shard→flat-index mapping mechanics + whether `Catalog` itself becomes
  "shard 0" or is re-cut — phase 5 design, informed by the LMC/SMC
  population plans and `docs/catalog-driver.md`.
- Whether `SystemMembershipRegistry` providers fold into the module
  contract or stay a separate registry (only two implementors today —
  second-consumer rule applies).
