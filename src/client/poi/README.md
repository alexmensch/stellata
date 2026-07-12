# Points of interest (POIs)

User-pinned stars. This folder owns the pin **state**; the SVG
rendering (rings, labels, off-screen arrows) lives in
`../overlays/poi-overlay.ts` and the per-POI info cards will land here
alongside the store.

## Files

- `poi-store.ts` (+ test) — the pinned-star list and its mutation
  rules. `Stellata` composes one instance and exposes thin shims
  (`getPois` / `togglePoi` / `setPois` / `clearPois`); every consumer
  (overlay, URL state, click dispatch) goes through those.
- `click-ladder-pure.ts` (+ test) — decision table for the
  navigate-mode click ladder below.

## Click ladder (navigate mode)

A navigate-mode click on a non-focused star steps a state-based
ladder:

1. unpinned → pin
2. pinned but not the vector destination → set the distance vector
3. pinned + vector destination → clear the vector AND unpin

Stars that can't take the pin rung right now (Sol, cap reached) fall
through to the vector rung so measuring to them stays possible. Pins
are HUD widgets, so with the HUD hidden (`showHud` off — the default)
the ladder steps only its vector rungs and existing pins are left
untouched; observe-mode clicks are similarly HUD-gated. Observe mode
is a plain pin/unpin toggle instead of the ladder. Both canvas clicks
and the POI overlay's on-screen labels route through
`Stellata.applyStarClick`, so the star and its label can't drift
apart.

## Pin semantics

- One shared list across navigate and observe modes.
- Keyed by catalog row index at runtime; persisted as SIDs in the
  `?v=` blob (see `../util/url-state/README.md`), so pins survive
  catalogue rebuilds.
- **Sol is not pinnable** — the HUD's dedicated Sol arrow already
  covers it. Stars without a SID are not pinnable either (never
  occurs on a shipped catalog; the guard protects URL round-trip).
- Hard cap `POI_MAX_COUNT = 16`; adding past it is a no-op. The same
  constant bounds the URL payload — import it, never redefine it.
- Insertion-ordered so URL round-trips preserve the user's pin order.
- Every accepted mutation fires the deps `onChange`; `Stellata` maps
  that to the `'pois'` + `'state'` bus events.

Rejected mutations (Sol, no SID, cap) leave a `console.info`
breadcrumb only — visible feedback is the click-ripple overlay's job,
not the store's.
