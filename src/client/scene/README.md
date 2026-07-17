# Scene layer registry

The `SceneLayer` contract and `SceneLayerRegistry` — the seam that
keeps `stellata.ts` from hand-maintaining four parallel per-layer
enumerations (per-frame update fan-out, `setMonochrome`, floating-
origin `recenter`, `dispose`). One registration per layer covers all
four: a layer registered once cannot be silently missing from any of
them, which is the property the old copy-everywhere lists couldn't
guarantee.

## Files

- `scene-layer.ts` — `FrameCtx`, `SceneLayer`, `SceneLayerRegistry`.
- `scene-layer.test.ts` — fan-out order + optional-hook semantics.

## How the shell uses it

`stellata.ts` registers one adapter entry per render layer in its
constructor, in draw-dependency order (the continuously-ticking trio —
orbit rings, planet bodies, binary orbits — first; SVG projectors like
the HUD after the camera-matrix refresh they need). Each entry is a
closure over the shell's layer field, so lazily-attached layers
(clouds, Local Group, binaries) read whatever is currently attached —
`null` before attach, the live instance after, with no re-registration.

`FrameCtx` (camera, worldOffset, float64 `distFromSol`, model-clock
`t`, `warpActive`) is computed once per frame and shared. Warp
gating lives inside each entry, not in a branched caller: reference
layers (galactic disc / grid, Local Group wireframe, HUD) hide
themselves while `ctx.warpActive`; light-emitting and physical layers
(Milky Way, LG emission, planets, binaries, clouds) keep updating —
the old duplicated warp/non-warp fan-out branches collapse into the
per-entry decision. This mirrors the hover subsystem's one-engine /
many-providers pattern (`../hover/README.md`).

Adding a layer = constructing it + one `register(...)` call. Hooks
are optional except `dispose`; a layer that doesn't participate in a
fan-out simply omits the hook (e.g. the heliopause has no per-frame
update — its visibility is event-driven).

Not in the registry: camera controllers, the star pipeline, and the
extinction prepass — they aren't scene layers and keep explicit
lifecycle calls in `stellata.ts`. `setMonochrome`'s star-pipeline
blend swap and renderer clear-colour also stay on the shell; the
registry carries the per-layer legs.
