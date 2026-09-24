#!/usr/bin/env bash
# Sourced by the hooks that arm on a Skill call. A directory-scoped or
# plugin listing prefixes the name a skill is invoked by.

# is_skill <invoked> <name> — true when <invoked> is <name> under any scope.
is_skill() {
  case "$1" in
    "$2"|*:"$2"|*/"$2") return 0 ;;
    *) return 1 ;;
  esac
}
