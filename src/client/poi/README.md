# Points of interest (POIs)

User-pinned objects — any pinnable Target kind (stars, planets,
deep-space probes, Local Group objects, and boundary shells today) in
one list. This folder owns the pin **state**; the SVG
rendering (rings, labels, off-screen arrows) lives in
`../overlays/poi-overlay.ts`, and the per-POI info cards are members of
the card rolodex (`../focus-card/README.md` § Rolodex behaviour).

## Files

- `poi-store.ts` (+ test) — the pinned-Target list and its mutation
  rules. `Stellata` composes one instance, exposed as `stellata.pois`
  (`get` / `toggle` / `set` / `clear`); every consumer (overlay, URL
  state, click dispatch, rolodex) goes through it.
- `click-ladder-pure.ts` (+ test) — decision table for the
  navigate-mode click ladder below.

## Click ladder (navigate mode)

A navigate-mode click on a non-focused object — star, planet, or
Local Group object, one ladder for every kind — steps a state-based
ladder:

1. unpinned → pin
2. pinned but not the vector destination → set the distance vector
3. pinned + vector destination → clear the vector AND unpin

Objects that can't take the pin rung right now (no-SID record, cap reached) fall
through to the vector rung so measuring to them stays possible. Pins
are HUD widgets, so with the HUD hidden (`showHud` off — the default)
the ladder steps only its vector rungs and existing pins are left
untouched; observe-mode clicks are similarly HUD-gated. Observe mode
is a plain pin/unpin toggle instead of the ladder. Both canvas clicks
and the POI overlay's on-screen labels route through
`InputController.applyObjectClick` (`stellata.input`), so the object and its label can't drift
apart.

## Pin semantics

- One shared list across navigate and observe modes.
- Keyed by `Target` (`{kind, idx}`) at runtime; persisted as SIDs in
  the `?v=` blob (see `../util/url-state/README.md`), so pins survive
  catalogue rebuilds. A planet Target's idx is the body-field flat
  instance index; its SID rides the planet domain. The per-kind pin
  rules live on `PoiStoreDeps.pinnable`, a map EXHAUSTIVE over
  `TargetKind` (wired in `stellata.ts`) — a new focusable kind must
  state its rule to compile, like the focusable / focus-card provider
  registries.
- **Every catalog star with a SID pins — Sol included.** Sol was once
  carved out ("the HUD #sol-arrow already covers it"), but a
  per-object exception in the pin rung reads as a broken click ladder
  (click → vector with no ring), so the carve-out is gone; a pinned
  Sol coexists with the HUD arrow. Stars without a SID are not
  pinnable (never occurs on a shipped catalog; the guard protects URL
  round-trip). Planets are pinnable while their host is attached to
  the body field; URL round-trip additionally needs the planet SID to
  resolve, wired for Sol's domain only today (`main.ts`
  `planetDomainIndexOf`) — a future non-Sol host's pin would work
  in-session but silently drop from a shared `?v=`. Every LOADED probe
  pins and round-trips with no translation step — its SID domain is
  built over the loaded roster, so the resolver's localIndex IS the
  Target idx. Local Group
  objects pin like stars (their SID domain attaches at boot); clouds
  stay unpinnable while the MC layer is shelved — their rule returns
  false and the ladder steps only its vector rungs for them.
- Hard cap `POI_MAX_COUNT = 16`; adding past it is a no-op. The same
  constant bounds the URL payload — import it, never redefine it.
- Insertion-ordered so URL round-trips preserve the user's pin order.
- Every accepted mutation fires the deps `onChange`; `Stellata` maps
  that to the `'pois'` + `'state'` bus events (payload
  `readonly Target[]`).

Rejected mutations (no SID, cap) leave a `console.info`
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
