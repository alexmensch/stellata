# Release cutting

Turns a push to `main` into GitHub releases. Invoked by
`.github/workflows/deploy.yml` after a successful Cloudflare deploy;
also usable by hand (see `RELEASING.md` § Manual release).

- `release-plan-pure.ts` — the decision layer. `planReleases()` walks a
  push range oldest-first and emits one release per version change;
  `extractReleaseNotes()` pulls the `## Release notes` section out of a
  PR body; `prNumberFromSubject()` reads the squash-merge `(#NN)` suffix.
- `cut-releases.ts` — the CLI. Resolves the range with `git`, plans,
  then tags and publishes with `gh`.

## One deploy, N releases

**A push is not a commit.** GitHub's merge-a-stack feature lands every
PR in a stack as its own commit in a *single* push event, and each of
those commits can carry its own `package.json` bump. Comparing HEAD to
HEAD~1 therefore sees only the top of the stack and silently drops
every intermediate version's tag, release, and release notes.

The split that resolves it: **Cloudflare is deployed once, at HEAD**
(that is the code that should be live), while **tags and releases are
cut per bumped commit** across `github.event.before..HEAD`. The two
halves of "release" answer different questions — what runs in
production, versus what each version shipped.

`--first-parent` keeps the walk on `main`'s own line, so a merge
commit's incoming branch never contributes phantom version changes.

## Invariants

- **Idempotent by release, not by tag.** A rerun skips any tag that
  already has a *release*; a tag that exists without one still gets its
  release created. Checking the tag instead would strand a run that
  died between `git push` and `gh release create`.
- **`--latest` goes to the newest planned release only.** Back-filling
  older versions must not move the repo's "Latest" pointer backwards.
- **A missing notes section is not an error.** Falls back to
  `--generate-notes`, which is what a `skip-version-bump` PR merged
  alongside bumped siblings will hit.

`--dry-run` prints the plan — which tags, at which commits, from which
PRs — and touches nothing. Use it before any manual invocation.
