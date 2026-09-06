#!/usr/bin/env bash
# Fails a PR whose diff touches a render path unless its body carries a
# non-empty `## Perf` section with an `accepted:` line for every ✗ row.
# Usage: perf-section-check.sh <body-file> <changed-files-file>. RELEASING.md § Perf pin.
set -euo pipefail

body_file="$1"
files_file="$2"

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

if [ ${#touched[@]} -eq 0 ]; then
  echo "perf-section: no render path touched"
  exit 0
fi

section=$(awk '
  /^## Perf[[:space:]]*$/ { capture=1; next }
  /^## / && capture { exit }
  capture { print }
' "$body_file")
stripped=$(printf '%s' "$section" | perl -0777 -pe 's/<!--.*?-->//gs')

if ! printf '%s' "$stripped" | grep -qE '[^[:space:]]'; then
  echo "::error::render path touched (${touched[*]}) but the PR body has no non-empty '## Perf' section. Run the perf runner with --against-pin and paste its table — RELEASING.md § Perf pin."
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

echo "perf-section: present, ${#touched[@]} render-path file(s), every ✗ accepted"
