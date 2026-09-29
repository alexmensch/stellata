#!/usr/bin/env bash
# Links data/papers/pdf in every linked worktree that lacks it or holds a
# different one to the main checkout's store. See README.md#how-paper-store-link-works.

set -u
cat >/dev/null 2>&1 || true

LINK=data/papers/pdf
repo="${CLAUDE_PROJECT_DIR:-$PWD}"
worktrees=$(git -C "$repo" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p')
[ -n "$worktrees" ] || exit 0

main=$(printf '%s\n' "$worktrees" | head -n 1)
[ -L "$main/$LINK" ] || exit 0
target=$(readlink "$main/$LINK")
case $target in
  /*) ;;
  *) target="$main/data/papers/$target" ;;
esac

printf '%s\n' "$worktrees" | tail -n +2 | while IFS= read -r wt; do
  [ -d "$wt/data/papers" ] || continue
  dest="$wt/$LINK"
  if [ -L "$dest" ]; then
    [ "$(readlink "$dest")" = "$target" ] && continue
    rm -f "$dest" 2>/dev/null || continue
  elif [ -e "$dest" ]; then
    continue
  fi
  ln -s "$target" "$dest" 2>/dev/null
done
exit 0
