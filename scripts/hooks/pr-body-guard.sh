#!/usr/bin/env bash
# pr-body-guard: PreToolUse hook on Bash. Runs release-notes-guard's and
# perf-section-guard's checks against `gh pr create|edit --body-file <file>`
# before the body reaches GitHub. README.md#how-pr-body-guard-works.

here="$(cd "$(dirname "$0")" && pwd)"
. "$here/command-match.sh"
ci_base=main
skip_label=skip-version-bump
input="$(cat)"

cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // "" | gsub("\\\\\n"; " ")' 2>/dev/null | tr '\n' ';')" || exit 0
invocation="${CMD_START}${ENV_PREFIX}(command[[:space:]]+)?([^[:space:];&|]*/)?gh[[:space:]]+pr[[:space:]]+(create|edit)([[:space:]]|$)"
[[ "$cmd" =~ $invocation ]] || exit 0
match="${BASH_REMATCH[0]}"
sub="${BASH_REMATCH[6]}"

cwd="$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null)"
if [ -n "$cwd" ]; then cd "$cwd" 2>/dev/null || exit 0; fi

# Shell words of $1 up to its first unquoted ; & or |, into args.
split_words() {
  local s="$1" c word='' inword=false quote='' n=0
  args=()
  while [ "$n" -lt "${#s}" ]; do
    c="${s:$n:1}"
    n=$((n + 1))
    if [ -n "$quote" ]; then
      if [ "$c" = "$quote" ]; then quote=''
      elif [ "$c" = '\' ] && [ "$quote" = '"' ]; then word="${word}${s:$n:1}"; n=$((n + 1))
      else word="${word}${c}"; fi
      continue
    fi
    case "$c" in
      \" | \') quote="$c"; inword=true ;;
      \\) word="${word}${s:$n:1}"; n=$((n + 1)); inword=true ;;
      ' ' | $'\t') if [ "$inword" = true ]; then args+=("$word"); fi; word=''; inword=false ;;
      ';' | '&' | '|') break ;;
      *) word="${word}${c}"; inword=true ;;
    esac
  done
  if [ "$inword" = true ]; then args+=("$word"); fi
}

split_words "${cmd#*"$match"}"

[[ "$match" == *GH_REPO=* ]] && exit 0

body='' base='' target='' added='' removed=''
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  a="${args[$i]}"
  next="${args[$((i + 1))]:-}"
  case "$a" in
    -F | --body-file) body="$next"; i=$((i + 1)) ;;
    --body-file=*) body="${a#*=}" ;;
    -F?*) body="${a#-F}" ;;
    -B | --base) base="$next"; i=$((i + 1)) ;;
    --base=*) base="${a#*=}" ;;
    -l | --label | --add-label) added="${added},${next}"; i=$((i + 1)) ;;
    --label=* | --add-label=*) added="${added},${a#*=}" ;;
    --remove-label) removed="${removed},${next}"; i=$((i + 1)) ;;
    --remove-label=*) removed="${removed},${a#*=}" ;;
    -R | --repo | --repo=*) exit 0 ;;
    # gh's other flags that take a value; their value is not the PR argument.
    -t | --title | -b | --body | -a | --assignee | -r | --reviewer | -m | --milestone | \
      -p | --project | -H | --head | -T | --template | \
      --add-* | --remove-assignee | --remove-reviewer | --remove-project) i=$((i + 1)) ;;
    -*) ;;
    *) [ -z "$target" ] && target="$a" ;;
  esac
  i=$((i + 1))
done

[ -n "$body" ] && [ "$body" != "-" ] && [ -r "$body" ] || exit 0

labels=''
if [ "$sub" = edit ]; then
  view="$(gh pr view ${target:+"$target"} --json baseRefName,labels --jq '.baseRefName, (.labels[].name)' 2>/dev/null)" || exit 0
  [ -n "$base" ] || base="$(printf '%s\n' "$view" | head -n 1)"
  labels="$(printf '%s\n' "$view" | tail -n +2 | paste -sd, -)"
fi
if [ -z "$base" ] && [ "$sub" = create ]; then
  base="$(git config "branch.$(git branch --show-current 2>/dev/null).gh-merge-base" 2>/dev/null)"
fi
[ -n "$base" ] || base="$ci_base"
[ "$base" = "$ci_base" ] || exit 0

has_label() { [[ ",$1," == *",${skip_label},"* ]]; }
skip=false
if { has_label "$labels" || has_label "$added"; } && ! has_label "$removed"; then skip=true; fi

failures=''
record() {
  local guard="$1" out
  shift
  out="$(bash "$@" 2>&1)" && return 0
  printf '%s' "$out" | grep -q '::error::' || return 0
  failures="${failures}
- ${guard}: $(printf '%s\n' "$out" | grep '::error::' | sed 's/^::error:://')"
}

root="$(git rev-parse --show-toplevel 2>/dev/null)"
check() {
  if [ -n "$root" ] && [ -f "$root/scripts/$1" ]; then echo "$root/scripts/$1"; else echo "$here/../$1"; fi
}

if [ "$skip" = false ]; then record release-notes-guard "$(check release/release-notes-check.sh)" "$body"; fi
record perf-section-guard "$(check perf/perf-section-guard.sh)" "$body" "origin/${base}"

[ -z "$failures" ] && exit 0

reason="Refusing gh pr ${sub}: ${body} fails the CI guard it would meet on GitHub.
${failures}

Fix ${body} and rerun the same command. The checks are the ones CI runs: scripts/release/release-notes-check.sh and scripts/perf/perf-section-guard.sh."

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
