# Commit-sweep guard

`commit-sweep-guard.sh`, registered in `.claude/settings.json` as a
PreToolUse hook on Bash, and the comment-rule set it shares with the vitest
scanner. What every guard here has in common: `../README.md`.

## Files in this area

```
scripts/hooks/commit-sweep/
  commit-sweep-guard.sh    Blocks `git commit` Bash calls when the
                           staged tree touches a guarded folder
                           without updating its README.md (/AGENTS.md#folder-readmes--read-before-you-touch-the-folder-update-at-commit
                           trigger 4 — "At commit
                           time, update"), when the staged diff
                           introduces forbidden code-comment
                           patterns (same set as
                           tests/code-comment-rules.test.ts), and/or
                           when a staged comment block restates
                           markdown prose the same commit adds
                           — README.md#the-restatement-sweep — and/or
                           when an added markdown line quotes a snapshot
                           count without a doc-figure marker.
                           Behaviour pinned by
                           tests/commit-sweep-guard.test.ts.
  comment-rules.json       The forbidden comment patterns, once. Read
                           by tests/code-comment-rules.test.ts and by
                           commit-sweep-guard.sh. The two hand-copied
                           sets that preceded it had already drifted
                           apart.
  comment-rules.ts         Typed reader for that file.
```

## How commit-sweep-guard works

`PreToolUse` on `Bash`. Filters down to `git commit ...` invocations
(handles `git -C <path> commit` and rejects subcommands like
`git commit-tree`); other Bash calls pass straight through. For a
matched commit:

1. **README staleness.** Walks the `git diff --cached --name-only`
   set. For each modified non-README under `src/`, `scripts/`,
   `data/`, `docs/`, finds the closest folder containing a
   `README.md` and reports if that README is missing from the staged
   set. Suppressed when the commit command string contains
   `[readme-skip: <reason>]` — works for both `-m "msg [readme-skip:
   …]"` and HEREDOC-style messages, since both put the literal text
   in the command. The skip-tag scan flattens newlines to spaces
   before matching so a multi-line reason inside the brackets still
   counts — without that, a HEREDOC message that wraps the bracketed
   reason was silently ignored (`[^]]*` doesn't span newlines under
   line-mode `grep -E`).

   **`-F` / `--file` / `--body-file` message files are read too**, and
   have to be: the command string then carries only a path, so a tag
   inside the file is invisible to a grep over the command. That is
   the *only* route a worktree-isolated session has for a long message
   — the worktree guard rejects `$( )` substitution and heredoc commit
   bodies — so without this the opt-out was unusable precisely where
   it was needed. A named file that is missing or unreadable is
   skipped rather than fatal, and only the first 64KB is scanned.

2. **Comment-rule sweep.** Runs `git diff --cached -U0` filtered to
   added lines (`^\+`, excluding `+++` headers) against the same
   forbidden-pattern set `tests/code-comment-rules.test.ts` uses —
   bead-IDs, bead-relative time refs, memory wikilinks, PR
   references. Scoped to NEW content so pre-existing legacy
   violations don't block unrelated commits.

3. **Restatement sweep.** [The restatement sweep](#the-restatement-sweep) below.

4. **Snapshot-copy sweep.** When the commit stages markdown, runs
   `scripts/doc-figures/check-staged-figures.ts` (through the checkout's own
   `node_modules/.bin/tsx`) over the added lines; the shape and why it reads
   only added lines are [Staged copies at commit time](/scripts/doc-figures/README.md#staged-copies-at-commit-time).
   `[figure-ok: <reason>]` opts out. Fails open: no tsx, no script, or an
   exit other than 1 lets the commit through.

Any check fires a `permissionDecision: "deny"` with a per-finding
breakdown and the relevant [Code comments](/AGENTS.md#code-comments--what-ci-enforces-here) substitution.

## The restatement sweep

[Code-comment hygiene](/docs/authoring-patterns.md#code-comment-hygiene) calls a comment
restating README content written minutes earlier **the dominant failure
mode**, and says CI cannot catch it. That is true of prose written in an
earlier PR and false of the case the sentence actually describes: prose
arriving in the *same commit* is in the staged diff, next to the comment.
So this sweep compares the two halves of one commit.

**It compares vocabulary, not phrasing**, because exact wording rarely
survives the move from prose into a comment — a paraphrase is still a
restatement. For each contiguous block of added comment lines it takes the
distinct content words (stopwords and short tokens dropped, trailing `s`
normalised so "pages" meets "page") and measures what share of them appear
in markdown the same commit adds. Two lines minimum, twelve distinct words
minimum, half of them shared, and the block is reported.

Those floors are what keep a **pointer** legal: `// see
/src/client/webgpu/tsl/README.md#interleaved-gradient-noise` is one line
and a handful of words, so it never reaches the test however much
vocabulary it shares. That is the shape the deny message asks for.

`[comment-ok: <reason>]` in the commit message opts out, and is visible in
the PR the way `[readme-skip:]` is. It exists because vocabulary overlap is
evidence rather than proof: a long comment carrying a genuine invariant
about the subject its README also describes can reach the threshold
honestly.

Known limit: a comment committed **apart** from the prose it restates is
invisible to this. The README-staleness check above is what makes the two
usually land together, and that coupling does not cover root-level files,
which no folder README is charged for.

Scope caveat: `-a` / `--all` commits aren't fully inspected; only
already-staged files are checked. The standard `git add <files> &&
git commit` flow Claude uses is covered correctly.

## The trailing-slash exemption

`stellata-perf/2` (the perf runner's schema string) and
`.claude/skills/stellata-perf/` are not bead IDs, and nothing about their
*shape* says so: the epic-slug window is 3–5 characters with no digit
required, which `perf` fits exactly as `cns`, `dch`, `uadc` and `hhaw` do.
The discriminator is what follows. **No bead ID is ever followed by `/`; a
path or a namespace always is** — so the `stellata-` pattern ends `(?!/)`.

Two things that look like holes and are not. A bead ID buried mid-path
(`notes/stellata-8cg.49/summary.md`) is still caught, because the pattern
backtracks off the `.49` and matches the bare `stellata-8cg` in front of the
`.`, which is followed by a dot rather than a slash. And the exemption is
deliberately **prefix-form only** — the bare `<epic>.NN` pattern below it
keeps no such escape, because a bare slug needs the dotted number to match at
all and no namespace in this tree wears one.

The residual is a bead ID written with a trailing slash (`stellata-cns/`),
which is not a shape anyone writes. The alternative considered and rejected
was renaming the schema to `stellata/perf/1`: that clears one linter and puts
the string beyond reach of everyone who greps for the project prefix.
