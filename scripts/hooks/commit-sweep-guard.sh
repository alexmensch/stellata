#!/usr/bin/env bash
# commit-sweep-guard: PreToolUse hook on Bash. When the tool call is a
# git commit invocation, refuses the commit if either of:
#
#  (a) the staged tree touches a guarded folder (src/, scripts/, data/,
#      docs/) without modifying that folder's README.md, AND the
#      commit message lacks an explicit `[readme-skip: <reason>]`
#      opt-out — enforces /AGENTS.md#folder-readmes--read-before-you-touch-the-folder-update-at-commit trigger 4
#      ("At commit time, update");
#
#  (b) the staged diff (added lines only) contains forbidden comment-
#      rule patterns from comment-rules.json — the same file
#      tests/code-comment-rules.test.ts reads, scoped to NEW lines so
#      pre-existing legacy violations don't block unrelated commits —
#      enforces /AGENTS.md#code-comments--what-ci-enforces-here;
#
#  (c) a comment block the commit adds restates markdown prose the same
#      commit adds — the "README written minutes earlier" failure named
#      in /docs/authoring-patterns.md#code-comment-hygiene. Opt out with
#      `[comment-ok: <reason>]`.
#
# Scope is `git diff --cached`: -a / --all commits aren't fully
# inspected. Most commits go through `git add <files> && git commit`,
# which this covers correctly.

set -euo pipefail

input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
if [ "$tool" != "Bash" ]; then
  exit 0
fi

cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"

# Match `git commit ...`, allowing `git -C <path> commit`. Excludes
# subcommands that aren't commit and substrings like `git commit-tree`.
if ! printf '%s' "$cmd" | grep -qE '\bgit([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

# Resolve the repo top-level. Prefer `git -C <path>` if specified.
repo_arg="$(printf '%s' "$cmd" \
  | sed -nE 's/.*\bgit[[:space:]]+-C[[:space:]]+([^[:space:]]+).*/\1/p' \
  | head -1)"
if [ -n "$repo_arg" ]; then
  toplevel="$(git -C "$repo_arg" rev-parse --show-toplevel 2>/dev/null || true)"
else
  toplevel="$(git rev-parse --show-toplevel 2>/dev/null || true)"
fi
if [ -z "$toplevel" ]; then
  exit 0
fi

# Opt-out detection. The HEREDOC commit pattern bd recommends puts the
# message body literally into the command string, so a grep over the
# command catches `[readme-skip: ...]` whether it's a `-m`-arg or
# HEREDOC inline message. `-F <file>` does not, and is handled below.
#
# Flatten newlines to spaces first so the regex `[^]]*` (which doesn't
# span newlines in line-mode grep) still spans a multi-line skip
# reason. Without this a HEREDOC message that wraps the bracketed
# reason across lines is silently ignored — surprise denials on
# what looks like a valid opt-out.
# `-F <file>` puts the message in a file, so the command carries only a
# path and a tag inside it would never be seen. In a worktree that is the
# ONLY route for a long message — the worktree guard rejects `$( )` and
# heredoc commit bodies — so without this the opt-out is unusable exactly
# where it is needed most.
msg_files="$(printf '%s' "$cmd" \
  | grep -oE '(^|[[:space:]])(-F|--file|--body-file)[[:space:]]*=?[[:space:]]*[^[:space:]]+' \
  | sed -E 's/^[[:space:]]*(-F|--file|--body-file)[[:space:]]*=?[[:space:]]*//' || true)"

skip_scan="$cmd"
for mf in $msg_files; do
  if [ "$mf" != "-" ] && [ -f "$mf" ] && [ -r "$mf" ]; then
    skip_scan="$skip_scan $(head -c 65536 "$mf")"
  fi
done

opt_out=0
if printf '%s' "$skip_scan" | tr '\n' ' ' | grep -qE '\[readme-skip:[^]]*\]'; then
  opt_out=1
fi

comment_ok=0
if printf '%s' "$skip_scan" | tr '\n' ' ' | grep -qE '\[comment-ok:[^]]*\]'; then
  comment_ok=1
fi

# README staleness check.
stale=""
if [ "$opt_out" = 0 ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      src/*|scripts/*|data/*|docs/*) ;;
      *) continue ;;
    esac
    name="$(basename "$f")"
    if [ "$name" = "README.md" ]; then
      continue
    fi
    # Walk up to the closest README inside the guarded tree.
    dir="$(dirname "$f")"
    readme=""
    while [ "$dir" != "." ] && [ "$dir" != "/" ] && [ -n "$dir" ]; do
      if [ -f "$toplevel/$dir/README.md" ]; then
        readme="$dir/README.md"
        break
      fi
      parent="$(dirname "$dir")"
      if [ "$parent" = "$dir" ]; then break; fi
      dir="$parent"
    done
    [ -n "$readme" ] || continue
    # Is this README in the staged set? Cheap recheck — diff--name-only
    # is O(staged size), but staged size is small per commit so this is
    # fine without memoisation.
    if ! git -C "$toplevel" diff --cached --name-only | grep -qxF "$readme"; then
      printf '%s\n' "  $f  →  needs review of $readme" >> "${TMPDIR:-/tmp}/commit-sweep-stale.$$"
    fi
  done < <(git -C "$toplevel" diff --cached --name-only)

  stale_file="${TMPDIR:-/tmp}/commit-sweep-stale.$$"
  if [ -f "$stale_file" ]; then
    # Dedupe by README target; one ask per README is the right grain.
    stale="$(awk -F'→' '!seen[$2]++' "$stale_file")"
    rm -f "$stale_file"
  fi
fi

# Comment-rule sweep — added lines only. Patterns come from
# comment-rules.json so this cannot drift from the vitest suite; the
# hand-copied set that lived here did, pinning the epic slug to three
# characters after the suite widened it to five.
RULES_JSON="$(dirname "$0")/comment-rules.json"
RULE_NAMES="$(jq -r '.patterns[].name' "$RULES_JSON")"
RULE_PATTERNS="$(jq -r '.patterns[].pattern' "$RULES_JSON")"
RULE_FLAGS="$(jq -r '.patterns[].flags' "$RULES_JSON")"
export RULE_NAMES RULE_PATTERNS RULE_FLAGS

violations="$(
  git -C "$toplevel" diff --cached -U0 -- '*.ts' '*.py' 2>/dev/null \
  | grep -E '^\+' \
  | grep -vE '^\+\+\+ ' \
  | perl -nE '
      BEGIN {
        # jq -r keeps backslashes literal, and no pattern contains a
        # newline, so one pattern per line needs no escaping.
        my @names = split /\n/, $ENV{RULE_NAMES};
        my @pats  = split /\n/, $ENV{RULE_PATTERNS};
        my @flags = split /\n/, $ENV{RULE_FLAGS}, -1;
        our @patterns;
        for my $i (0 .. $#pats) {
          my $src = ($flags[$i] // "") =~ /i/ ? "(?i)$pats[$i]" : $pats[$i];
          push @patterns, [$names[$i], qr/$src/];
        }
      }
      chomp;
      my $line = $_;
      $line =~ s/^\+//;
      for my $p (@patterns) {
        if ($line =~ $p->[1]) {
          say "  [$p->[0]] $line";
          last;
        }
      }
    ' || true
)"

# Restatement sweep. Exact wording rarely survives the move from prose to
# a comment, so this compares vocabulary rather than phrasing: the share of
# a block's distinct content words that also appear in markdown the same
# commit adds. A pointer is short enough to fall under MIN_WORDS.
restate=""
if [ "$comment_ok" = 0 ]; then
  md_file="$(mktemp "${TMPDIR:-/tmp}/commit-sweep-md.XXXXXX")"
  git -C "$toplevel" diff --cached -U0 -- '*.md' 2>/dev/null \
    | grep -E '^\+' | grep -vE '^\+\+\+ ' > "$md_file" || true
  if [ -s "$md_file" ]; then
    restate="$(
      git -C "$toplevel" diff --cached -U0 -- '*.ts' '*.js' '*.py' 2>/dev/null \
      | MD_FILE="$md_file" perl -nE '
          # Defined above the BEGIN block that calls it: BEGIN runs at the
          # point it is parsed, when anything below is not yet compiled.
          sub norm { my $w = shift; $w =~ s/s$// if length($w) > 3; $w }
          BEGIN {
            our $MIN_WORDS = 12;
            our $THRESHOLD = 0.5;
            our %STOP = map { $_ => 1 } qw(
              the and for that this with from into are was were been being
              have has had not but its it is be to of in on at as by or an a
              so than then there here what which when where if else do does
              did we you they them their our one all any every each own only
              just also can could would will shall may might how why who
              because while about after before over under again more most
              same such no nor too very now per via
            );
            open my $fh, "<", $ENV{MD_FILE} or die "md: $!";
            local $/;
            my $text = lc <$fh>;
            close $fh;
            our %MD;
            $MD{norm($_)} = 1 for ($text =~ /([a-z][a-z0-9_\x27-]{2,})/g);
          }
          sub flush {
            our (@block, $file, %STOP, %MD, $MIN_WORDS, $THRESHOLD);
            return if @block < 2;
            my $text = lc join " ", @block;
            $text =~ s{(?:^|\s)(?://+|\#+|/\*+|\*+)}{ }g;
            $text =~ s{\*/}{ }g;
            my %seen;
            for my $w ($text =~ /([a-z][a-z0-9_\x27-]{2,})/g) {
              $seen{norm($w)} = 1 unless $STOP{$w};
            }
            my @words = keys %seen;
            return if @words < $MIN_WORDS;
            my $hit = grep { $MD{$_} } @words;
            my $pct = int(100 * $hit / @words + 0.5);
            return if $pct < 100 * $THRESHOLD;
            say sprintf("  %s — %d%% of this block\x27s words are in prose this commit adds", $file // "?", $pct);
            say "    " . substr(join(" ", @block), 0, 140);
          }
          our (@block, $file);
          chomp;
          if (/^\+\+\+ b\/(.+)$/) { flush(); @block = (); $file = $1; next; }
          if (/^\@\@/)            { flush(); @block = (); next; }
          next unless /^\+/;
          my $t = $_;
          $t =~ s/^\+//;
          $t =~ s/^\s+//;
          my $is_comment = (defined $file && $file =~ /\.py$/)
            ? ($t =~ m{^\#})
            : ($t =~ m{^(?://|/\*|\*)});
          if ($is_comment) { push @block, $t } else { flush(); @block = () }
          END { flush() }
        ' || true
    )"
  fi
  rm -f "$md_file"
fi

if [ -z "$stale" ] && [ -z "$violations" ] && [ -z "$restate" ]; then
  exit 0
fi

reason="Refusing git commit — pre-commit sweep found work the rules say has to happen now, not in a follow-up."

if [ -n "$stale" ]; then
  reason+=$'\n\nModified code in folders whose README.md is not in this commit (/AGENTS.md#folder-readmes--read-before-you-touch-the-folder-update-at-commit — "At commit time, update"):\n'
  reason+="$stale"$'\n'
  reason+=$'\nFix: re-read each README and either edit it (preferred — folder READMEs are the prose-only surface a grep for renamed symbols won\'t catch) OR, if every claim is still accurate, add `[readme-skip: <reason>]` to the commit message documenting why no update is needed. The skip tag is visible in the PR for review.'
fi

if [ -n "$violations" ]; then
  reason+=$'\n\nForbidden comment-rule patterns in the staged diff (AGENTS.md § Code comments):\n'
  reason+="$violations"$'\n'
  reason+=$'\nFix: rewrite per /AGENTS.md#code-comments--what-ci-enforces-here. Credit a bead → commit subject, not the code. Reference a memory → no link in code (invisible to readers without bd). Cite a PR → drop it; git blame carries the history.'
fi

if [ -n "$restate" ]; then
  reason+=$'\n\nComment blocks that repeat prose this same commit adds (/docs/authoring-patterns.md#code-comment-hygiene — "a comment restating README content written minutes earlier is the dominant failure mode"):\n'
  reason+="$restate"$'\n'
  reason+=$'\nFix: cut the block to a one-line pointer at the section that now carries it (`// see <path>.md#<slug>`). The prose is already written; a second copy rots. If the comment genuinely says something the prose does not, add `[comment-ok: <reason>]` to the commit message — visible in the PR for review.'
fi

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
