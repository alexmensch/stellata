#!/usr/bin/env bash
# Runs perf-section-check.sh on a PR body against HEAD's diff from <base-ref>:
# the changed files and the catalogue record count either side.
# Usage: perf-section-guard.sh <body-file> <base-ref>
set -euo pipefail

body_file="$1"
base_ref="$2"
here="$(cd "$(dirname "$0")" && pwd)"
counts=scripts/catalog/build-catalog-expected.json

changed="$(mktemp)"
trap 'rm -f "$changed"' EXIT
git diff --name-only "${base_ref}...HEAD" > "$changed"

base_records="$(git show "${base_ref}:${counts}" 2>/dev/null | jq -r '.recordCount // empty' 2>/dev/null)" || base_records=''
head_records="$(git show "HEAD:${counts}" 2>/dev/null | jq -r '.recordCount // empty' 2>/dev/null)" || head_records=''

bash "$here/perf-section-check.sh" "$body_file" "$changed" "$base_records" "$head_records"
