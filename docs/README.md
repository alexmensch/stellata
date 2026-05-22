# Cross-cutting docs

Genuinely cross-cutting documentation that doesn't belong to a single
subsystem folder. New docs default to *find the right folder and put
a README.md there*; only land in `docs/` if the topic truly spans the
whole codebase.

```
authoring-patterns.md   Write-time consistency rules (lifecycle pairing,
                        sibling symmetry, sentinel-init dirty-track,
                        single source of truth for time / camera state).
                        Each rule is the codified version of a
                        retrospective code-review finding. Read before
                        adding a bus.on() call, a sibling helper, a
                        sentinel-init dirty-track pattern, or any state
                        struct shifted mid-animation.
ux-tweaks.md            Reference table of UX knobs (orbit feel,
                        chevron density, focus-ring size, panel
                        defaults, etc.) and where to find them. Look
                        here when the user asks for a tweak.
screenshots/            Marketing + README hero images.
```

For project conventions and the top-level folder layout, see
[`CLAUDE.md`](../CLAUDE.md). For science / data / formula citations,
see [`SCIENCE.md`](../SCIENCE.md).
