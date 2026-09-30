#!/usr/bin/env bash
# Runs perf-section-check.sh on a PR body against <head-ref>'s diff from where
# it left <base-ref>: the changed files and the catalogue record count either side.
# Usage: perf-section-guard.sh <body-file> <base-ref> [<head-ref>, default HEAD]
set -euo pipefail

body_file="$1"
base_ref="$2"
head_ref="${3:-HEAD}"
here="$(cd "$(dirname "$0")" && pwd)"
counts=scripts/catalog/build-catalog-expected.json

fork="$(git merge-base "$base_ref" "$head_ref")"
changed="$(mktemp)"
trap 'rm -f "$changed"' EXIT
git diff --name-only "$fork" "$head_ref" > "$changed"

base_records="$(git show "${fork}:${counts}" 2>/dev/null | jq -r '.recordCount // empty' 2>/dev/null)" || base_records=''
head_records="$(git show "${head_ref}:${counts}" 2>/dev/null | jq -r '.recordCount // empty' 2>/dev/null)" || head_records=''

bash "$here/perf-section-check.sh" "$body_file" "$changed" "$base_records" "$head_records"
