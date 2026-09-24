#!/usr/bin/env bash
# Sourced by the hooks that arm on a Skill call. A directory-scoped or
# plugin listing prefixes the name a skill is invoked by.

# skill_name <invoked> — the skill's own name, with any scope prefix removed.
skill_name() {
  printf '%s' "${1##*:}"
}

# is_skill <invoked> <name> — true when <invoked> is <name> under any scope.
is_skill() {
  [ "$(skill_name "$1")" = "$2" ]
}
