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
  list), the exhaustive `KindModules` mapped type, and
  `buildKindModules()`.

Modules themselves live in their kind's folder
(`../solar-system/probes/probe-module.ts` is the pilot) and are only
*assembled* here.

## Contracts that must not drift

- **`KindModules` is EXHAUSTIVE over `TargetKind`.** A kind whose
  wiring is still inline holds an explicit `null` row; a new kind
  cannot ship without stating its entry. Never weaken to a partial
  map. The `null` rows shrink as epic phases migrate kinds and the
  union of module-vs-inline wiring is always visible in one record.
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
- **Kind-specific machinery stays out of the contract.** The shell may
  hold a module's concrete type for cross-kind wiring (the solar-system
  cluster reads `kinds.probe.field` for its local-depth mirror); the
  `ObjectKindModule` legs cover only the shared surfaces, and an
  optional leg appears at its second consumer, never speculatively.

## How the shell and boot consume it

`main.ts`: `buildKindModules()` → `load` per roster entry inside the
boot `Promise.all` → hand the record to `new Stellata({kinds})` →
roster loops for SID domains (`sids()`, null ⇒ conclude), hover
providers, label overlays, and the search corpus. `stellata.ts`: the
constructor builds one `KindContext` and attach-loops the roster at
the layer-construction point; `setT` fans out `clockJumped`,
`setFocalBodyHidden` fans out `setFocalHidden`, `buildSceneElementBinds`
merges `detailBinds()` pushes into its exhaustive record, and the
Picker dispatches click picks through the modules' `pick` legs
(`pickKindHit`) so click and hover share one pick function per kind.
