# src/client/solar-system/planets/labels/ — per-body SVG labels

The planet-and-moon label overlay. Self-contained: it imports nothing
from `../` — only the shell, `../../../overlays/` and three.js — and
reads the shell's orbit-rings layer + focus state, so it stays wired in
`main.ts` rather than through the planet kind module.

## Files

- `planet-labels.ts` (+ test) — `createPlanetLabels`, and `LABEL_OFFSET_PX`,
  which `../../probes/probe-labels.ts` and `../../../fresnel-shell/` share.

## Labels

`planet-labels.ts` draws per-body-anchored SVG labels (planets **and**
moons) above the canvas. The label engine is independent of the
chart-mode label engine (`chart-labels.ts`); labels show when a planet
system is attached and the detail cycle permits `planetLabels` (floor
`all`), and are hidden in chart mode so the chart-mode glyph contract
isn't doubled up (`../../../scene/README.md` § Detail-level declutter cycle).

Per-body resolvability gate: every label tracks its orbit ring
(`isOrbitRingVisible` — a ring the pixel-gap heuristic dropped means the
body is floor-clamped sub-pixel, so the label would anchor to nothing).
Planets gate on their host-centred ring, moons on their parent-centred
ring — a moon collapsed toward its parent's dot drops its ring (and so
its label) rather than stacking on the parent.

A totally eclipsed body's label hides with the body, except where the
caster has an atmosphere and the umbral glow keeps it visible
(`../eclipses/README.md` § True-eclipse dim).

**Shadow and occlusion are different gates and both apply.** The
eclipse dim above asks whether the HOST still lights the body; the
occluder gate inside `placeAnchoredLabel`
(`../../../occlusion/README.md`) asks whether a nearer body hides it
from the CAMERA. A Moon behind Earth is fully lit and keeps its dim of
1, which is why it kept its label until the second gate existed; a
Moon in Earth's umbra is hidden from the Sun but may sit in open sky
from where the camera is.
