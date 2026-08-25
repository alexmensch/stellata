# Requires-WebGPU gate

The takeover a browser that cannot run the renderer gets instead of a dead
canvas: what is wrong, and the one thing to do about it, named for the
browser reading it.

## Files in this area

```
src/client/webgpu/gate/
  webgpu-support.ts (+ test)     detectWebGpuSupport — capability probe.
                                 Also covers the #webgpu-gate=force switch.
  gate-advice-pure.ts (+ test)   adviceFor — the per-platform fix copy.
  gate-page.ts (+ test)          showWebGpuGate — builds and mounts the
                                 takeover. Styles: ../../styles.css
                                 `.webgpu-gate*`.
```

## Not behind the import boundary

This folder holds **no** `three/webgpu` value import and must never gain
one. The gate has to render on a browser with no WebGPU at all, so it sits
in the entry bundle and `main.ts` imports it statically — the same
exemption `renderer-flag.ts` has (`../README.md` § Import boundary).
`detectWebGpuSupport` therefore declares the slice of `navigator.gpu` it
touches structurally rather than importing the typings.

## Two ways to fail, one page

`detectWebGpuSupport` returns three verdicts: `supported`, `no-api` (no
`navigator.gpu`), and `no-adapter` (the API is there and still yielded no
device — a blocklisted driver, a flag left off, a context that refused).

**Both failures land on the same page**, which is the bead's requirement
and the right call for a reader: "this browser can't run it, here is what
to do" is the same message either way. They stay distinct in the return
value because the lead sentence differs — a browser that *has* WebGPU and
could not start a device is not told to go and install one — and because
the console line and any future telemetry want them apart.

`requestAdapter` **rejecting** is a `no-adapter`, not a propagated throw.
This runs on the boot path, and a gate that throws leaves the user with
exactly the dead canvas it exists to replace.

## UA picks the wording, never the verdict

Whether to gate is capability alone. *Which fix to name* has to know the
browser — "update to iOS 26" and "use Chrome, this Intel Mac can't run
Tahoe" are different sentences — so `adviceFor` reads the user-agent
string. Keep that split: a UA test must never reach the gating decision,
or a browser that shipped WebGPU after this table was written gets locked
out of an app it can run.

Two branches carry the whole subtlety:

- **iPadOS is a Mac in every field but one.** Since iPadOS 13 an iPad's UA
  says `Macintosh; Intel Mac OS X`, so `maxTouchPoints > 1` is the only
  thing separating it from a desktop Safari — which would otherwise be
  told to switch browser rather than update iPadOS.
- **Firefox is matched before macOS Safari.** A Mac Firefox UA contains
  `Macintosh`, so checking the Safari branch first would tell a Firefox
  user to update a browser they are not running.

The version numbers come from the support audit in the `stellata-0it`
epic body, which is **dated** — the page says so in as many words, so a
stale row reads as a dated observation rather than a guarantee. Update
`SUPPORT_AUDIT_LABEL` alongside the table.

## Lands dark

Nothing reaches this page in the shipped app. WebGL2 is still the default,
so no real user fails a WebGPU probe on the boot path, and the flag's own
failure route deliberately still falls back to WebGL2 with a console
warning — that is a working dev affordance and this bead did not take it
away.

The one way in is `#webgpu-gate=force`, checked in `main.ts` **before** the
catalog fetch so a gated browser downloads nothing it cannot use. The
switch takes a spelled-out value rather than a bare `#webgpu-gate`, so a
stray or mistyped fragment cannot blank the app.

**`0it.13` is what makes this live**: at cutover the boot runs
`detectWebGpuSupport` for real and shows the page on a failing verdict.
Until then the override is the only caller, which is why the page's own
tests carry the copy contract rather than any boot test.

## Smoke

`#webgpu-gate=force` on Chrome and on Safari 26: the page renders, the
copy matches the browser you are on, no console noise, and the app boots
normally with the fragment removed.
