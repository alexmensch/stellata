#!/usr/bin/env bash
# Fails a PR whose diff touches a render path unless its body carries a
# non-empty `## Perf` section with an `accepted:` line for every ✗ row.
# Usage: perf-section-check.sh <body-file> <changed-files-file>. RELEASING.md § Perf pin.
set -euo pipefail

body_file="$1"
files_file="$2"

render_path='^src/client/.*\.(glsl|wgsl)$|^src/client/(webgpu|hdr|star-pipeline|milkyway|local-depth|render-gate|scene)/.*\.ts$'

touched=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.test.ts|*.md) continue ;;
  esac
  if [[ "$f" =~ $render_path ]]; then
    touched+=("$f")
  elif [[ "$f" == src/client/*.ts ]] && [ -f "$f" ] && grep -q 'renderer\.render(' "$f"; then
    touched+=("$f")
  fi
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
