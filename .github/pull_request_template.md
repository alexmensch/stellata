<!--
PR title goes in the title field above. Keep it short (under 70 chars);
detail lives below.
-->

## Summary

<!-- 1–3 bullets describing what this PR does. -->

## Test plan

<!-- Bulleted checklist of what you ran / what should be smoke-tested. -->

- [ ] `pnpm run typecheck`
- [ ] `pnpm test`
- [ ] Manual smoke in browser
- [ ] If you touched `scripts/build-catalog.ts` / `scripts/catalog-pure.ts`: `rm -f public/catalog-manifest.json && pnpm run build:catalog` — the count assertion against `scripts/build-catalog-expected.json` either passes (no change to the manifest) or fails with a diff. Drift the manifest deliberately with `UPDATE_BUILD_COUNTS=1 pnpm run build:catalog`.

## Perf

<!--
Required when the diff touches a render path: any .ts, .glsl or .wgsl under
src/client/, outside *.test.ts and the folders RELEASING.md § Perf pin
exempts. Say which tier, then answer it — RELEASING.md § Perf pin owns the
table:

  Tier 0  no per-frame code reachable. Prose: which functions the diff
          touches, and that none is reachable from animate(), a pass, or a
          per-frame buffer write. No table.
  Tier 1  per-frame code touched, draw counts and pass structure unchanged.
          The --baseline table over mw120|webgpu and sol|webgpu, and the run
          it was read against.
  Tier 2  passes, buffers, draw counts, the catalogue or the instrument.
          The --against-pin table with the pin commit, the adapter slug and
          the state-guard line per context, and the re-taken pin in this PR.

One `accepted: <row> <reason> (<bead-id>)` line per ✗, whichever tier.
perf-section-guard checks this section. Other PRs leave it empty.
-->

## Release notes

<!--
This section is consolidated into the GitHub release for the version
this PR ships. The `release-notes-guard` workflow fails the PR if
this section is empty (after stripping HTML comments).

Write user-facing prose, not implementation detail. Suggested
shape — drop sub-sections that don't apply, add ones that do:

  ### Summary
  1–2 sentences capturing the headline change.

  ### New features
  - …

  ### Bugfixes
  - …

  ### Changes
  Modifications to existing behaviour.
  - …

Markdown — bullets, links, code spans all render on the release
page.

For metadata-only PRs (no version bump, attach the
`skip-version-bump` label) you can leave this section empty.
-->
