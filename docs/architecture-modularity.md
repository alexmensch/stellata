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
   is a ~75-line inline record; `main.ts` builds card providers as ~90
   lines of inline closures reaching into shell internals). `TargetKind`
   and `FocusKind` are the same union spelled twice.
2. **Two parallel per-kind geometry contracts.** `FocusableProvider`
   and `FocusTarget` overlap ~60%; the per-kind `makeXFocusTarget`
   factories in `focus-controller.ts` mostly re-derive legs the provider
   record already has. Hard/soft and moving-kind membership
   (`isHardTarget`, `MOVING_FOCUS_KINDS`) are hand-maintained sets
   rather than declared properties of the kind.
3. **`stellata.ts` is three files in one** (2,816 lines): a legitimate
   composition root + frame loop (~900); per-kind glue that grows with
   every kind (~600); and a facade of ~90 one-line forwarding shims over
   the controllers (~500+ with doc comments) that grows with every
   controller method.

## Target architecture — three tiers

### Tier 1 — engine services (not kinds)

Kind-agnostic platform every module consumes: floating-origin / frame
anchor service, model clock, exposure + HDR, shared view uniforms,
scene + `SceneLayerRegistry`, picker engine, camera controllers.

Several of these currently live *inside* star code because stars got
there first: `StarFrame` owns `worldOffset` and the recentre rewrite;
`buildStarSharedUniforms` owns the shared view uniforms that clouds,
planets, and boundary layers reach into the star disc material to read.
The final phase extracts them into engine services. The
clouds-read-star-material-uniforms coupling is a latent bug source
independent of this epic.

**`KindContext`** is the one dependency struct handed to every module —
the documented answer to "what may a layer depend on?": camera,
`worldOffset` accessor, model clock (`getT`), exposure, HDR emitter
uniforms, `angularToPx`, event bus, scene handle. Its exact field list
is settled during the pilot migration (phase 2), not up front.

### Tier 2 — kind modules

One module per `TargetKind`, exported from the kind's folder, bundling
what is today scattered across the wiring sites:

```ts
interface ObjectKindModule {
  kind: TargetKind;
  hard: boolean;              // absorbs the kind's KIND_TRAITS row
  moving: boolean;            // (phase 1 landed hard/moving there)
  critical?: boolean;         // blocks first paint (star catalog only)
  load(baseUrl, onProgress): Promise<Artifact | null>;  // NEVER rejects
  attach(ctx: KindContext, artifact): KindRuntime | null;
  // capability legs, closing over the runtime:
  focusable: FocusableProvider;      // merged contract, § below
  card: FocusCardProvider;
  hover?: HoverProvider;
  pick?: PickSurface;
  pinnable(idx: number): boolean;
  searchEntries(): FuzzyEntry[];
  sidDomain(): Uint32Array | null;
  sceneElements: SceneElementFloorRow[];
  labels?(ctx): void;                // SVG label overlay factory
  displayName(idx: number): string;
}
```

`KIND_MODULES: Record<TargetKind, ObjectKindModule>` — an exhaustive
record, preserving the existing `tsc` guarantee (a kind missing any leg
fails to compile). **The exhaustive-record property must not be
weakened**; it is the best part of the current design. `main.ts` boot
becomes `Promise.all` over `modules.map(m => m.load(...))` plus one
attach loop; search / SID / hover / card / pin / declutter wiring become
loops over the roster.

The exact leg list above is a starting sketch — the pilot migration
validates and amends it. Kind-specific machinery (planet host-attach,
the fresnel-shell primitive, binary orbital dynamics) stays in the kind
folder; the contract covers only the shared surfaces. Per the standing
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

### Merge `FocusTarget` into `FocusableProvider` (phase 1)

`FocusableProvider` (`localPositionInto`, `focusParkDistance`,
`arrivalRadiusPc`, `renderedSizePx`) and `FocusTarget` (`anchorInto`,
`localPositionInto`, `parkRadius`, `physicalRadius`, `applyFocus`,
`emitFocusEvents`, `chartPlateauDistance`) are parallel per-kind
geometry contracts. Phase 1 merges them: the provider record gains the
missing legs, `applyFocus` / `emitFocusEvents` share the hard/soft
dispatch via the declared `hard` flag and the existing
`parkOnFocalTarget` tail, and `FocusTarget` instances are built
generically from the provider record. This deletes the
`makeFocusTarget` switch and the five ~50-line per-kind factories — the
single biggest per-kind cost centre — before the module rotation begins.

### Facade flattening (phase 4)

The ~90 one-line forwarding shims on `Stellata` are replaced by exposing
the controllers as readonly namespaces (`stellata.filters`,
`stellata.exposure`, …); callers write `stellata.filters.set(patch)`.
~400–500 lines deleted; the facade stops growing per controller method.
Accepted cost: ~100+ call-site edits and the loss of the (currently
ceremonial — the shims add no logic) single-choke-point property on
those surfaces. Shims that *do* add logic (busy-gate dispatchers like
`aimAt`, `setCameraFov`'s solid-angle sync) are composition, not
facade — they stay.

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

1. **Anchor policy is pluggable.** The frame service owns `worldOffset`
   + the recentre fan-out with two policies: `focal` (today: origin =
   focused object) and `follow` (recentre onto the camera position when
   `|camera − origin|` exceeds a hysteresis threshold). The origin is
   never assumed to be an object — `recenterOrigin` already takes a free
   vec3, `SceneLayer.recenter` is already anchor-agnostic, and
   `maybeRecenterOnFocalDrift` is the working precedent for
   motion-driven recentring. Camera-follow beats nearest-object
   anchoring: no spatial query, works in voids, degrades gracefully.
   (A nearest-object query will likely exist eventually for LOD /
   "what's near me" — as a separate service, not the precision
   mechanism.)
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

1. **Merge `FocusTarget` into `FocusableProvider`** — self-contained,
   high value/risk ratio; kills the per-kind factories.
2. **`KindContext` + `ObjectKindModule` + pilot migration (probes).**
   Probes are the newest, cleanest kind. The pilot settles the
   `KindContext` field list and amends the contract sketch.
3. **Migrate the remaining non-star kinds** — soft kinds (cloud / lg /
   shell) together, planet on its own (host-attach machinery).
4. **Facade flattening.**
5. **Engine-services extraction + star module** — frame/anchor service
   out of `StarFrame` ownership, shared view uniforms out of the star
   material, star kind wrapped as a module, shard support (chunk-local
   coordinates, shard→index mapping) proven by the contract even before
   a second population ships.

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
