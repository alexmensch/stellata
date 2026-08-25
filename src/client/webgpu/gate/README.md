# Requires-WebGPU gate

The takeover a browser that cannot run the renderer gets instead of a dead
canvas: what is wrong, and the one thing to do about it, named for the
browser reading it.

## Files in this area

```
src/client/webgpu/gate/
  webgpu-support.ts (+ test)     detectWebGpuSupport — capability probe.
  gate-advice-pure.ts (+ test)   adviceFor — the fix copy, per platform
                                 AND per verdict.
  gate-page.ts (+ test)          showWebGpuGate — builds and mounts the
                                 takeover. Styles: ../../styles.css
                                 `.webgpu-gate*`.
```

The `#webgpu-gate` dev switch is **not** in this folder: it is fragment
parsing, so `parseGateOverride` sits beside `parseRendererFlag` in
`../renderer-flag.ts` and is tested there.

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
to do" is the same message either way. What differs is *which* fix that
is — see the next section, which is the whole reason the verdicts stay
distinct rather than collapsing to one boolean.

`requestAdapter` **rejecting** is a `no-adapter`, not a propagated throw.
This runs on the boot path, and a gate that throws leaves the user with
exactly the dead canvas it exists to replace.

## What a no-adapter reader is told

**`adviceFor` takes the verdict, not just the hints.** A `no-adapter`
browser HAS WebGPU, so every line naming a browser or an OS version to
install is wrong by construction: "update Safari to version 26" reads as
nonsense to someone already running 26, and that is the single largest
sentence on the page.

So `no-api` names a newer browser or OS, and `no-adapter` names whatever
is withholding the GPU — hardware acceleration switched off, a driver the
browser blocks, a remote or virtual session with no GPU to hand out. The
mobile branch differs again, because a phone has neither a
hardware-acceleration switch nor a driver to update.

The parameter is **required, with no default**. A default is what let the
verdict go unread in the first place: the lead sentence branched on it
while the advice did not, so the page contradicted itself.

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
- **Firefox then splits again by operating system.** It shipped WebGPU on
  Windows and Apple-silicon macOS, so "update Firefox" is the fix there —
  but on Android it has not shipped at all and on Linux it sits behind
  `dom.webgpu.enabled`, where updating is advice the detail sentence
  itself contradicts. Those two get Chrome, or the flag, instead.

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

The one way in is `#webgpu-gate=<verdict>`, checked in `main.ts` **before**
the catalog fetch so a gated browser downloads nothing it cannot use. The
switch takes a spelled-out value rather than a bare `#webgpu-gate`, so a
stray or mistyped fragment cannot blank the app.

`no-api` (spelled `force` too) and `no-adapter` each show their own page.
Both spellings exist because a developer's browser fails *neither* probe,
so without naming the verdict the `no-adapter` copy could not be read on a
real browser at all — which is how its advice came to contradict its own
lead sentence for a release.

**`0it.13` is what makes this live**: at cutover the boot runs
`detectWebGpuSupport` for real and shows the page on a failing verdict.
Until then the override is the only caller, which is why the page's own
tests carry the copy contract rather than any boot test.

## Smoke

`#webgpu-gate=force` and `#webgpu-gate=no-adapter` on Chrome and on
Safari 26: each page renders, the copy matches the browser you are on,
the `no-adapter` page names no version to install, no console noise, and
the app boots normally with the fragment removed.
