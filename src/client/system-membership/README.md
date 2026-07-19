# System membership

Kind-generic contract for multi-object systems whose members can
visually collapse into one on-screen point — multi-star systems today,
planet systems (host + planets + moons) today, exoplanet hosts and
Sol's probes tomorrow. Two consumers drive the shape:

- **Hover** — hovering the collapsed point swaps the per-object card
  for a system roster ("N of M components here: …").
- **Pick** — clicking the collapsed point selects the cluster's
  primary, never an arbitrary sub-pixel member.

## Files

- `system-membership.ts` — `SystemMember` (`{ target, name | null }`),
  the `SystemMembershipProvider` contract (`membersOf` /
  `collapsedClusterOf`), and `SystemMembershipRegistry` (provider
  union + `collapsedLeadOf`).
- `system-membership.test.ts` — registry union / dedup / lead pins.

## Contract semantics

- Members are keyed on a `Target` (`{kind, idx}`) — the stable id —
  plus an **optional** display name. Never assume every member is
  nameable: a provider returns `name: null` when it can't name a
  member (stars defer to `resolveStarName` in the consumer; unnameable
  members get a generic label).
- `membersOf` returns the WHOLE connected system, primary first; `[]`
  when the provider doesn't cover the target.
- `collapsedClusterOf` returns only members currently rendering as one
  point with the target (target included), primary first — and `[]`
  when nothing is collapsed with it. "Currently collapsed" is always
  the renderer's own verdict (the binary orbit walk's
  composite-suppress flag; the planet field's sub-pixel-from-parent
  test), so card, pick, and rendering can't disagree.
- `collapsedLeadOf` = `collapsedClusterOf(t)[0]?.target ?? t` — the
  pick-resolution rule.

## Implementations

- **Binaries** — `../binaries/binary-system-membership.ts`, wrapping
  the relation-graph walk in `../format/star-companion-format.ts` over
  `binaries.bin` + the orbit walk's live `isCompositeSuppressed`.
- **Planet systems** — `../solar-system/planet-system-membership.ts`,
  over `PlanetBodyField`'s attached hosts. Members are the host star +
  every body; the collapse verdict is
  `PlanetBodyField.isCollapsedOntoParent` (rendered this frame AND
  sub-pixel from its parent — host star for a planet, parent planet
  for a moon). The same implementation covers exoplanet hosts as soon
  as `stellata-bk5` attaches them — no new provider needed.

## Consumers

- `stellata.ts` constructs the registry, registers both providers
  (binaries first — see the lead rule above), and routes the Picker's
  `resolveCollapsedLead` through `collapsedLeadOf`.
- The star + planet hover formatters
  (`../hover/formatters/system-card-format.ts`) build the roster card
  from `membersOf` + `collapsedClusterOf`.
- `PlanetBodyField.pick` drops candidates that are collapsed onto
  their parent — the parent's own pick surface (the star picker for a
  host, the parent planet's candidacy for a moon) owns the point, so
  hover and click resolve to the primary without a cross-kind rewrite.

## Extending — probes, exoplanets, future kinds

Implement `SystemMembershipProvider` next to the new layer's data
(e.g. a Sol-probes provider over the probe layer's positions), and
register it in `stellata.ts`. No hover-, picker-, or formatter-layer
edits: the roster card, click-to-primary, and pick suppression are all
keyed on the contract, not on any kind. Exoplanets specifically need
NOTHING here — attaching a host to `PlanetBodyField` makes the
existing planet provider cover it.
