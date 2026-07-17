# Points of interest (POIs)

User-pinned objects — any pinnable Target kind (stars and planets
today) in one list. This folder owns the pin **state**; the SVG
rendering (rings, labels, off-screen arrows) lives in
`../overlays/poi-overlay.ts`, and the per-POI info cards are members of
the card rolodex (`../focus-card/README.md` § Rolodex behaviour).

## Files

- `poi-store.ts` (+ test) — the pinned-Target list and its mutation
  rules. `Stellata` composes one instance and exposes thin shims
  (`getPois` / `togglePoi` / `setPois` / `clearPois`); every consumer
  (overlay, URL state, click dispatch, rolodex) goes through those.
- `click-ladder-pure.ts` (+ test) — decision table for the
  navigate-mode click ladder below.

## Click ladder (navigate mode)

A navigate-mode click on a non-focused point object — star or planet,
one ladder for every kind — steps a state-based ladder:

1. unpinned → pin
2. pinned but not the vector destination → set the distance vector
3. pinned + vector destination → clear the vector AND unpin

Objects that can't take the pin rung right now (Sol, cap reached) fall
through to the vector rung so measuring to them stays possible. Pins
are HUD widgets, so with the HUD hidden (`showHud` off — the default)
the ladder steps only its vector rungs and existing pins are left
untouched; observe-mode clicks are similarly HUD-gated. Observe mode
is a plain pin/unpin toggle instead of the ladder. Both canvas clicks
and the POI overlay's on-screen labels route through
`Stellata.applyObjectClick`, so the object and its label can't drift
apart.

## Pin semantics

- One shared list across navigate and observe modes.
- Keyed by `Target` (`{kind, idx}`) at runtime; persisted as SIDs in
  the `?v=` blob (see `../util/url-state/README.md`), so pins survive
  catalogue rebuilds. A planet Target's idx is the body-field flat
  instance index; its SID rides the planet domain.
- **Sol is not pinnable** — the HUD's dedicated Sol arrow already
  covers it. Stars without a SID are not pinnable either (never
  occurs on a shipped catalog; the guard protects URL round-trip).
  Planets are pinnable while their host is attached to the body field
  (which is also what makes their SID resolvable). Clouds and LG
  objects have no pin affordance today — `pinnable` returns false and
  the ladder steps only its vector rungs for them.
- Hard cap `POI_MAX_COUNT = 16`; adding past it is a no-op. The same
  constant bounds the URL payload — import it, never redefine it.
- Insertion-ordered so URL round-trips preserve the user's pin order.
- Every accepted mutation fires the deps `onChange`; `Stellata` maps
  that to the `'pois'` + `'state'` bus events (payload
  `readonly Target[]`).

Rejected mutations (Sol, no SID, cap) leave a `console.info`
breadcrumb only — visible feedback is the click-ripple overlay's job,
not the store's.

## POI cards

One card per pin, a member of the card rolodex — a single card-sized
stack shared with the focus card, one visible front card and the rest
as promotable header strips. Card content dispatches through
`FocusCardProviders` by the pin's kind. Behaviour (promote,
auto-front, focused-object suppression, strip compression, collapse)
is documented in `../focus-card/README.md` § Rolodex behaviour; layout
in `../ui/README.md` § Layout containers. POI cards render in BOTH
camera modes — unlike the focus card, which observe mode hides. No
camera actions from cards: promote, collapse, and × (unpin) only.
