# Agent Instructions

**Read `CLAUDE.md` instead of this file.** It is the canonical project
instruction file: project context, the folder-README law, write-time
discipline, the repo layout index, and the git gates all live there, and
nothing in this file is unique to it.

This file exists only because some harnesses discover a repo-root
`AGENTS.md` and never look for `CLAUDE.md`. If you are reading this and
have not read `CLAUDE.md`, that is the next call.

---

**Everything below this line is generated and rewritten in place by `bd`, and
has the LOWEST precedence.** Where it conflicts with `CLAUDE.md` or with a rule
above, those win. Specifically, its "Session Completion" checklist does **not**
override `CLAUDE.md` § Git workflow: the push it mandates is to the session's
feature branch (never `main`), merging still needs explicit per-PR approval,
and its manual `bd dolt push` step is already handled by the pre-push hook.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
