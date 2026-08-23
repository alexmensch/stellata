---
name: decode-view
description: Decode a Stellata share URL or state blob into the view it encodes — camera distance, focus SID, pinned clock time, fov, mode. Use whenever a session is handed a stellata.xyz or localhost /v/<blob>/ link (or a bare blob) and needs to know where the camera is, what is focused, or whether the clock is live, e.g. when reproducing a bug report or checking a render-gate/cadence budget against the vantage.
---

# Decode a share URL

One command. Accepts a full URL (canonical `/v/<blob>/` or legacy `?v=`)
or a bare blob:

```bash
VIEW='http://localhost:5173/v/BIHAAQdlg72vHz6wMKDQfTAC-v8T/' \
  npx vitest run --config .claude/skills/decode-view/vitest.config.ts
```

Prints the decoded field JSON, then a derived block: schema version,
camera distance from the local origin (auto-scaled km / million km / AU /
pc), camera-to-target, worldOffset, focus SID, pinned `t` as UTC, fov,
mode.

**Read the derived block first.** The camera distance is usually the
answer you want — the local frame's origin is the focused object, so with
`tgt` absent it *is* the camera-to-focus distance, which is what every
clock-cadence budget divides by (`src/client/render-gate/README.md`).

## What it will not tell you

- **Which object a focus SID names.** Kind resolution happens at apply
  time through the runtime resolver, so the decoder only sees a number.
  Look it up in `data/sid/ledger.tsv` or ask in-browser (below).
- **Anything default.** Default-compression means an absent field is the
  canonical default, not missing data. The output labels these.

## In-browser alternative

With the app open, `window.debug.decodeView('<blob>')` does the same and
`window.debug.encodeView()` returns the blob for the live state. Prefer
that when a browser is already up; prefer this skill from a bare shell.

## Why it imports instead of embedding

`run.decode.ts` imports `decodeBlob` and `pickShareBlob` from
`src/client/util/url-state/` rather than carrying a copy of the format.
v4 is live and gains presence bits over time, so an embedded table would
drift and return confidently wrong values. Importing cannot: it decodes
with whatever the working tree does.

Two consequences to know:

- `.claude/` is outside `tsconfig.json`'s include, so `pnpm run typecheck`
  does **not** cover this file. A rename in the url-state module surfaces
  as a run-time import error, not a failed gate. It is a one-line fix —
  re-read the module's exports and update the import.
- It runs under vitest because the url-state import chain pulls in shader
  and DOM-touching modules that plain `tsx` cannot load. The config is
  standalone (its own `include`) so the runner sits outside the repo's
  test globs and costs `pnpm test` nothing. `disableConsoleIntercept` is
  required — without it vitest buffers output from passing tests and the
  decode never reaches the terminal.
