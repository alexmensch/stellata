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
