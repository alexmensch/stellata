#!/usr/bin/env bash
# Fails a PR whose diff touches a render path, or moves catalogue membership,
# unless its body carries a non-empty `## Perf` section with an `accepted:`
# line for every ✗ row.
# Usage: perf-section-check.sh <body-file> <changed-files-file>
#          [<base-record-count> <head-record-count>]. RELEASING.md § Perf pin.
set -euo pipefail

# Byte comparisons, not collated ones: the row markers are multibyte, and BSD
# awk in a UTF-8 locale reads · and § as equal to ✗ — every non-marked row then
# demands an accepted: line and the check fails on a body CI would pass.
export LC_ALL=C

body_file="$1"
files_file="$2"
base_records="${3:-}"
head_records="${4:-}"

# Percent, so the comparison stays integer. The same bound
# RECORD_COUNT_TOLERANCE refuses a comparison past, and it has to be the same
# one: under it a membership change ships with no section and no fresh pin, so
# a stricter refusal there would leave that pin refusing every row of the next
# render-path PR. perf-section-check.test.ts fails when the two drift apart.
record_tolerance_percent=1

# Naming what is EXEMPT rather than what is covered is the invariant: a list
# of render folders exempts by omission, so a layer folder added later
# escapes the gate until somebody notices. RELEASING.md § Perf pin owns this
# list, and perf-section-check.test.ts fails when the two drift apart.
exempt='calibration|debug|focus-card|format|hover|kinds|loaders|modals|overlays|poi|system-membership|typeahead|ui'

touched=()
while IFS= read -r f; do
  if [ -z "$f" ]; then continue; fi
  if [[ "$f" == *.test.ts ]]; then continue; fi
  if [[ ! "$f" =~ ^src/client/.*\.(ts|glsl|wgsl)$ ]]; then continue; fi
  if [[ "$f" =~ ^src/client/($exempt)/ ]]; then continue; fi
  touched+=("$f")
done < "$files_file"

# A membership change lands in scripts/ and public/, so no path above sees it
# — and it moves how many instanced quads every star pass draws, which is the
# most direct frame-cost change the repo can make. The count comes off
# scripts/catalog/build-catalog-expected.json, which cannot move without a
# deliberate UPDATE_BUILD_COUNTS refresh, so it is the membership term's own
# committed record. Unreadable on either side leaves the check silent: the
# comparison-time refusal (pins/README.md § Record count) is the backstop.
membership=''
if [[ "$base_records" =~ ^[0-9]+$ && "$head_records" =~ ^[0-9]+$ ]] && [ "$base_records" -gt 0 ]; then
  if [ "$head_records" -gt "$base_records" ]; then
    delta=$(( head_records - base_records ))
  else
    delta=$(( base_records - head_records ))
  fi
  if (( delta * 100 > base_records * record_tolerance_percent )); then
    membership="catalogue membership ${base_records} -> ${head_records}"
  fi
fi

reason=''
if [ ${#touched[@]} -gt 0 ]; then reason="render path touched (${touched[*]})"; fi
if [ -n "$membership" ]; then
  reason="${reason:+${reason}; }${membership} (over ${record_tolerance_percent} %)"
fi

if [ -z "$reason" ]; then
  echo "perf-section: no render path touched, membership within ${record_tolerance_percent} %"
  exit 0
fi

section=$(awk '
  /^## Perf[[:space:]]*$/ { capture=1; next }
  /^## / && capture { exit }
  capture { print }
' "$body_file")
stripped=$(printf '%s' "$section" | perl -0777 -pe 's/<!--.*?-->//gs')

if ! printf '%s' "$stripped" | grep -qE '[^[:space:]]'; then
  echo "::error::${reason} but the PR body has no non-empty '## Perf' section. Run the perf runner with --against-pin and paste its table — RELEASING.md § Perf pin."
  exit 1
fi

missing=()
while IFS= read -r key; do
  [ -z "$key" ] && continue
  if ! printf '%s\n' "$stripped" | awk -v k="$key" '$1 == "accepted:" && $2 == k { found=1 } END { exit !found }'; then
    missing+=("$key")
  fi
done < <(printf '%s\n' "$stripped" | awk '$1 == "✗" { print $2 }')

if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::'## Perf' carries ✗ rows without an 'accepted: <row> <reason> (<bead-id>)' line: ${missing[*]}"
  exit 1
fi

echo "perf-section: present, ${reason}, every ✗ accepted"
