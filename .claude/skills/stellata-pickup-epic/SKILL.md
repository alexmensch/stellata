---
name: stellata-pickup-epic
description: Stellata's extension of the user-level `pickup-epic` skill, for the coordinator and for every `pickup-task` worker it launches — the GPU pause protocol (a worker, or any session that finds the coordinator's field, pauses the whole pipeline for a perf run so the machine is idle), `build:seed` as the post-landing step, and what a stellata `SMOKE:` line names. `pickup-epic` and coordinated `pickup-task` load it in stellata; load it directly only if one of them is already in context without it.
---

# Coordinating a stellata epic

Load `pickup-epic` (coordinator) or `pickup-task` (worker) first if it is
not already in context. This skill adds what is true only here; it narrows
them and never replaces them.

## The GPU is one resource for the whole machine

A perf run reads GPU clocks, and any other foreground work — a worker's
build, its test suite, `build:seed` in the main checkout — widens the
spread and walks the baseline, so the run is discarded
([stellata-perf protocol, step 5](/.claude/skills/stellata-perf/SKILL.md#protocol--announce--arm--run-one-run-per-arm)). A
run happens only with every other session paused, and the pause starts
before the arm so the owner can arm the moment they are asked. The requester
is any session that wants a run: a worker, or a session outside the run
that found the coordinator through `pickup-epic`'s coordinator field (in bd,
the epic's `coordinator` metadata key;
[stellata-perf protocol](/.claude/skills/stellata-perf/SKILL.md#protocol--announce--arm--run-one-run-per-arm)).
`await-go.sh` reads the same field to leave the coordinator out of its
busy-session warning, so keep it current.

| Kind | From → to | Send when |
| --- | --- | --- |
| `GPU_REQUEST` | requester → coordinator | before step 1 of the perf protocol (the announcement); carry on only with work that starts nothing heavy |
| `PAUSE` | coordinator → every other worker | on a `GPU_REQUEST` |
| `HOLD` | coordinator → the landing subagent, if one is running | on a `GPU_REQUEST`; the hold in `pickup-epic`'s Land step, unchanged |
| `PAUSED` | worker → coordinator | its current command has finished and it will start nothing heavier than reading files — no build, test run, `pnpm run perf`, `survivors`, or data pull |
| `GPU_GRANTED` | coordinator → requester | every other worker has replied `PAUSED` or is idle, the landing subagent, if one is running, has replied to `HOLD`, and no `build:seed` is running |
| `GPU_DONE` | requester → coordinator | the runner has exited, whatever its result; or `GPU_DONE unarmed` when `await-go.sh` timed out with no arm |
| `RESUME` | coordinator → every paused worker and the held landing subagent | on `GPU_DONE` |

**Coordinator.** Serve a `GPU_REQUEST` from any session the same way, worker
or not. On a `GPU_REQUEST`, hold every launch, start no step of
`pickup-epic`'s Land that has not begun (the sync or the landing subagent),
and run no `build:seed`.
Record the pause in the run state. Tell the user nothing: the requester's announcement is what
the owner reads. One request is served at a time; a second waits in the run state
until `GPU_DONE`.

**A grant awaiting the arm is a worker waiting on the user.** At
`GPU_GRANTED` to a worker of this run, record it "waiting on the user — arm",
a reason of its own beside any open question: its idle-watch line reads
`<item> waiting` while either reason holds, and the reminder timer runs.
`UNBLOCKED` clears only the question; the arm reason holds through a
question asked under the grant (a busy-session warning, say). Every
`GPU_DONE` ends the grant and sends `RESUME`; a plain one also clears the
arm reason. `GPU_DONE unarmed` leaves it: the grant lapsed for want of the
owner, so once the worker's turn ends the idle watcher prints `dismissed`
and `pickup-epic`'s dismissed row hands it off (`HIBERNATE`), phase
`awaiting owner answer`, relaunched when the user says they will arm. A new
`GPU_REQUEST` from it clears the arm reason first.

**Worker.** Announce and start `await-go.sh` only after `GPU_GRANTED`. A
re-run needs a new announcement but not a new request while the grant holds;
send `GPU_DONE` when no further run is planned. `await-go.sh` gives up after
15 minutes unarmed (`PERF_GO_WAIT_S`): send `GPU_DONE unarmed`, carry on with
work that needs no run, and send a new `GPU_REQUEST` when the owner says
they are ready. On `PAUSE`, reply `PAUSED` once the current command ends —
never kill a build part-way.

## The post-landing step is `build:seed`

`pickup-epic`'s post-landing step is `pnpm run build:seed` from the main
checkout, run without piping its output, started in the background right
after each landing
([Rebuild main's artifacts](/.claude/skills/stellata-pr-cleanup/SKILL.md#rebuild-mains-artifacts--last-in-the-background)).
A launch waits only while it runs. Stellata's seeding detects a main
checkout one landing behind
([Building in a worktree](/scripts/README.md#building-in-a-worktree)), so
`pickup-epic`'s Launch rule applies unnarrowed.
It is heavy: never while a GPU grant is held.

## The `SMOKE:` line

A change the owner can see — shaders, renderer, UI, a loader, data a layer draws —
owes a manual smoke in the browser, against the dev server the owner runs on the
branch: named stars to focus, slider values, mode transitions, debug HUDs to
open, and what each should look like. Tests passing is not that. Pure
pipeline, data with no drawn effect, docs and CI owe none; say which.

A Tier 1 perf run owed under `stellata-perf` is a precondition like a smoke:
the PR opens as a draft and goes through review while it waits.
