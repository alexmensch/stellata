#!/usr/bin/env bash
# Fails a PR body without a non-empty `## Release notes` section; HTML
# comments do not count. Usage: release-notes-check.sh <body-file>.
set -euo pipefail

body_file="$1"

if ! grep -qE '[^[:space:]]' "$body_file"; then
  echo "::error::PR body is empty. Use the PR template — the '## Release notes' section is required."
  exit 1
fi

section=$(awk '
  /^## Release notes[[:space:]]*$/ { capture=1; next }
  /^## / && capture { exit }
  capture { print }
' "$body_file")
stripped=$(printf '%s' "$section" | perl -0777 -pe 's/<!--.*?-->//gs')

if ! printf '%s' "$stripped" | grep -qE '[^[:space:]]'; then
  echo "::error::PR body must include a non-empty '## Release notes' section (HTML comments don't count). Add bullets describing user-visible changes — they will appear on the GitHub release page for this version. Or attach the 'skip-version-bump' label for metadata-only PRs."
  exit 1
fi

echo "Release notes section present and non-empty."
