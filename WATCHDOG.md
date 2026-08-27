# Watchdog notes

Especially watch for:

- A claim that an error, offset, or dropped term is negligible, invisible,
  or doesn't matter, without naming both the camera vantage and the clock
  offset it was evaluated at. CLAUDE.md § Camera-anywhere makes both
  mandatory; the default vantage is the closest realistic viewpoint and the
  clock's 3000 BC / 3000 AD limit, not Sol today.
- Sol-relative vocabulary smuggled into a tradeoff: "depth" and "sideways"
  splitting a quantity into a part that matters and a part that doesn't,
  purely by where Sol sits.
- A code comment restating prose that README.md, SCIENCE.md, or CLAUDE.md
  already carries. CI catches bead IDs, PR numbers, wikilinks, and
  oversized module docstrings; it cannot catch a paraphrase, and a comment
  dressed up as rationale ("this explains the why / the tradeoff") is the
  dominant failure mode.
- A folder README claim invalidated by the diff — a renamed file, changed
  data flow, new consumer, dropped feature, shifted ownership — left
  unupdated. A grep for renamed symbols does not catch stale prose.
- Duplicated logic or a magic number appearing a second time. The project
  extracts at the second usage, not the third.
- `Date.now()` mid-animation instead of `Stellata.getT()`.
- A `bus.on(...)` subscription whose unsubscribe is not wired into dispose.
- A dirty-flag or cache whose sentinel does not fail the first write, whose
  dispose does not reset it, or whose key omits an input dimension.
- One half of a sibling pair implemented without the defences its sibling
  already carries (lambertian/mallama, encode/decode, prime/fallback).
- A refactor framed "apply pattern X to all Y" that leaves call sites of
  the old pattern behind.
- New code arriving without tests in the same change, or a numeric headline
  claim pinned with `toBeLessThanOrEqual` instead of `toBe(N)`.
