# URL state

All Stellata UI state — camera pose, focus, exposure trim, overlay
toggles, observe-mode flag, POIs — is a single opaque base64url blob.
The blob is a binary, versioned envelope —
`[1 byte version] [LEB128 presence mask, 1–4 bytes] [payload]` in
v3/v4 — and only the fields that diverge from canonical defaults
occupy bytes. A typical share lands at ~10–25 chars, and worst-case
(every field overridden) tops out around 70 chars. See `url-state.ts`
for the format and the `FIELDS_V4` table.

## Transport — canonical path vs. legacy query

The blob rides a **`/app/v/<blob>/` path segment** (canonical).
base64url's alphabet (`A-Za-z0-9-_`) has no `/`, so it drops into one
segment with no escaping; the trailing slash is optional on parse. A
fully-default state has no segment at all — the URL is bare `/app`.

**`/app` is not decoration on the path, and `share-path-pure.ts` owns
it.** `/` is the public marketing homepage (`src/site/README.md`), so
every part of this module builds and parses under the application's own
prefix. `src/worker.ts` and the perf runner's `scenarios.ts` both import
`APP_PATH` from here rather than restating it: a second spelling breaks
share links with no error anywhere.

**Two legacy transports are decoded forever**, because links carrying
them are baked into YouTube comments and can never break. `/v/<blob>/` is
the path form shared while the application was the site root.
`?v=<blob>` is the query form that preceded it, retired because platforms
auto-filter comments carrying a `?…=` link. `pickShareBlob` reports
either as `legacyTransport`, and on load `applyFromUrl` rewrites both —
and a superseded schema version — to the canonical path, address-bar only,
via the same post-apply debounce as routine writes. In production they
rarely reach the client at all: the Worker 301s each onto the canonical
form first (`src/README.md` § Request routing).

Production serves `/app/v/<blob>/` through the Worker, which falls back to
the application document for any unmatched path under `/app`. So a path
that got there is one the app was asked to interpret, and `applyFromUrl`
strips the address bar back to bare **`/app`** when it carries nothing
decodable — a bogus sub-path, a stray query, or a blob that won't decode —
so the bar never lingers on junk. **The reset target is `/app`, never
`/`**: resetting to the site root would throw the user out of the
application and onto the homepage over a typo.

The **fragment is never URL state**: both writers (`writeUrl`, the junk
reset) re-append `location.hash` verbatim to whatever they write, because
`history.replaceState` with a bare path resolves to a URL without a
fragment and would silently drop it. Boot flags ride the fragment —
today the gate override `#webgpu-gate=<verdict>`
(`src/client/webgpu/README.md`), read once at boot and deliberately
outside the blob (it can't apply without a reload).

## Files in this area

```
src/client/util/url-state/
  share-path-pure.ts (+ test)     build / parse the /app/v/<blob>/ path form.
                                  Pure string helpers, split out so the
                                  path regex is unit-testable without
                                  url-state.ts's location/history writes.
                                  `shareBlobFrom` is the paste-tolerant
                                  reader over all three transports that the
                                  console helpers take their blob from.
  pose-change/                    the one scale-free test behind both the
                                  per-frame write trigger and the encoder's
                                  cam / tgt / worldOffset elision. Own README.
  url-state.ts (+ test)           blob encode / decode (v1–v4 formats),
                                  default-compression presence mask,
                                  per-component vec3 sub-masks,
                                  applyFromUrl entry point (path + legacy
                                  query parse) + post-debounce legacy→v4
                                  / query→path rewrite, startUrlSync
                                  subscription. The test file carries the
                                  golden-blob corpus pinning the frozen
                                  v1/v2/v3 decoders byte-for-byte, plus the
                                  re-index survival block: a link shared
                                  from one build must land on the same
                                  star under a build whose rows re-sorted.
```

Four wire formats coexist. **v4** (current) replaces every parallel
object-ref encoding with one universal unsigned-LEB128 **Stellata ID**
([§ 9](/docs/sid.md#9-wire-format-v4-b5)): `focus` and `to` each carry a SID of any kind — a
cloud focus is just a cloud-kind SID — and POIs are a count byte plus
one LEB128 SID per entry. No type tag rides the wire; kind comes from
the runtime resolver (`../sid-resolver/README.md`) at apply time.
Bits 16/17 (the v1–v3 1-byte cloud refs) are retired — leave them
unclaimed for ~6 months of deploy overlap. Bits 4 (`mag`), 8 (`preset`),
10 (`smin`), 11 (`smax`) and 12 (`span`) are retired differently: the
instrument owns the limiting magnitude and the plate scale owns star pixel
size, so any blob carrying them **decodes and is ignored** and the link
lands on the derived values — but v4 blobs shared before the retirement
have those bits set with payload bytes, so their specs stay in
`FIELDS_V4` as `decodeOnly(...)` entries (never encoded). Dropping a spec
whose bit is in the wild leaves its bytes unconsumed and shifts every later
field's byte offset; retiring a field is an encoder-side change only, and
the test pins it with a hand-built blob asserting the field *after* the
retired run still decodes. **A retired flag bit is cheaper** — the flags
byte is one byte whatever bits are set, so no offset can shift and
`packFlags` / `unpackFlags` just drop the leg, leaving the bit reserved by
comment: bit 2 (molecular clouds), bit 3 (`showMilkyway`), bit 7
(`showConstellation`), all three now gated by the declutter floor alone
(`../../scene/declutter/README.md`). SIDs are frozen forever in
`data/sid/ledger.tsv`, so a v4 link survives any catalogue rebuild —
the failure mode v1–v3's row-index fallback couldn't avoid. **v3**
introduced the LEB128 presence mask and per-component vec3 sub-masks
(`cam`, `tgt`, `up`, `worldOffset` prefix their payload with a 1-byte
sub-mask; only diverging components cost a float32) — both carried
forward into v4. **v2** packs each narrow scalar (`fov`, `mag`,
`smin`, `smax`, `span`) into 1 byte at the slider's native step; star
refs and POI HIPs are 3 bytes (1 tag bit + 23-bit id); cloud refs are
1 byte; vec3s are flat 12 bytes. **v1** (legacy: 32-bit mask, float32
scalars, uint32 ids) is still decoded. Old shared URLs auto-upgrade
to v4 on load via `applyFromUrl`'s post-debounce rewrite per the
[§ 9.4](/docs/sid.md#94-migration-semantics--exact-table) migration table: HIP refs re-key exactly
(hip → index → sid), index/cloud refs freeze best-effort to whatever
they resolve to in the current build, unresolvable refs drop while
the rest of the state applies.

The v1/v2/v3 `FIELDS_V*` tables are **frozen** — standalone literal
arrays, never edited (a golden-blob corpus in `url-state.test.ts`
pins them byte-for-byte). SID refs that arrive before their object's
artifact attaches ride the resolver's deferred-intent contract; a
retired/unknown SID expires silently.

**The STAR domain is attached but STILL FILLING when `applyFromUrl`
runs**, because the catalogue streams ([Progressive catalog load](../../loaders/README.md#progressive-catalog-load)).
A hit resolves synchronously — which is the
whole naked-eye sky, records being apparent-V ordered — and only a miss
stays `pending` and queues, because the sid may sit in a chunk that has
not arrived ([A domain that is still filling](../sid-resolver/README.md#a-domain-that-is-still-filling)).
Withholding the domain until the last chunk instead would make
every star ref deferred, and § A focus that resolves after the pose is
why that is wrong rather than merely slow. Every other pinnable kind's
domain (planet, lg) attaches complete at boot, strictly before
`applyFromUrl`.

### Legacy HIP refs

They resolve against a map that is also still filling.
`idMaps.hipToIndex` is grown per landing chunk by `main.ts` for the same
reason and with the same guarantee: records arrive in their final order,
so first-seen-wins over a growing prefix picks the winner a complete pass
would. A v1–v3 focus or POI list therefore restores at first paint when
its stars are in the prefix, and its misses drop — the pre-existing
best-effort contract, not a new one.

The vec3 sub-mask uses **strict equality** (`!==`), not the EPS=1e-3
`approx` check — under floating origin (a7d.2.11) the local-frame cam
can land at sub-µpc magnitudes, well inside that epsilon. Eliding
those as "approximately default" would silently round the camera to
the frame origin on round-trip. The cam vec3 is the only one whose
default depends on mode (`[0,0,30]` navigate / `[0,0,0]` observe);
the v3 decoder fills missing components from the static navigate
default, then `decodeV3`'s post-pass swaps z=0 in observe mode when
the sub-mask leaves z unset (flags decodes after cam in `FIELDS_V3`
bit order, so mode isn't known until the field loop completes).

- `url-state.ts applyFromUrl` runs **before** `startUrlSync` subscribes, so
  applying the URL on load doesn't echo back into history.
- Default-compression: a field is encoded only when its value differs
  from the canonical default. Encoder pre-computes the presence mask
  in one walk, then writes only the bytes for set bits. Default state
  produces no blob at all (bare `/app`).
- Focus is encoded as the object's SID, which survives any catalog
  reordering for every object (not just the ~37% with a HIP, which is
  all v1–v3 could protect). Sol is the canonical default focus and is
  encoded by *omitting* the field; "explicitly unfocused" uses a
  separate zero-byte presence bit so the three states (default Sol /
  specific object / cleared) stay unambiguous.
- **An absent `focus` is a positive statement, and the receiver owes the
  rebuild.** A hard focus is also what elides `worldOffset` (§ worldOffset
  below), so a blob carrying neither field is asserting the default frame —
  origin on Sol — and `applyDecodedView` re-establishes it before writing
  `cam` / `tgt`. A blob that states its frame some other way (an explicit
  `worldOffset`, or a legacy v1–v3 `cloud` focus) is left alone so nothing
  recentres twice. On a page load this changes nothing, because catalog
  attach has already focused Sol; it is what makes a blob applied to a
  **running** session — a pasted link, a `debug.capture` take — land in the
  frame its coordinates were measured in rather than whichever one the
  session had drifted to.
- **Every focus a blob asks for lands through `applyFocusTarget`**, whatever
  kind it names and whichever of the four routes decoded it — the asserted
  default frame above, a v4 sid, a legacy star ref, a legacy cloud ref. Its
  one argument is whether the blob also carries `cam` or `tgt`. Without one,
  it parks: `flyTo(target, { animate: false })`, snapping rather than gliding,
  because a URL restore must not surface as a 2 s glide on page load. With
  one, `setOrbitTarget` rebuilds the frame and skips the park the lines below
  would overwrite anyway, so the explicit camera wins.
  **`viewPose` cannot answer for the park leg, and that is the one place the
  two disagree.** Its fills are the encoder's elision defaults, which is what
  a consumer blending two blobs needs; the park pose is per-object and comes
  from the kind's provider at apply time, so a pose-less focused blob restores
  somewhere `viewPose` reports as `[0,0,30]`. Only a hand-typed share is
  pose-less — the encoder emits `cam` for any park it did not elide against —
  and the consumer to watch is `debug.capture`, which would open such a take
  30 pc out rather than where the link lands.
- Camera changes are tracked via the `'frame'` event with the scale-free
  comparison of § What counts as a camera move (no per-frame allocations)
  feeding a 1 s debounced writer. The comparison covers position, target,
  **and** `camera.up` — so a roll gesture (which moves neither position nor
  target) still triggers a URL update.
  The same frame check also watches the **pinned `t`** (`isLive(t) ? null
  : t`, mirroring `currentStateOf`'s encode gate): the scrubber drives
  `getT()` directly without a `'state'` event, so without this a time
  scrub on a still camera would never reach the URL.
- The `up` slot carries **`camera.up`**
  ([Roll authority](/src/client/camera/controls/input/README.md#roll-authority)), which is
  the navigate roll authority itself — nothing derives it per frame, so it
  is a value a link can hold. **The omission test is the rendered roll, not
  the vector:** the field is dropped when the view is galactic-LEVEL, since
  up is the pole's image-plane projection and therefore equals the pole
  itself from no viewpoint at all. A share from a level camera omits it
  entirely, as it always did.
  **An omission therefore has to be applied, not skipped** — the receiver
  restores `DEFAULT_UP`, the pole itself, and the `lookAt` below re-projects
  it against the pose this blob carries. Leaving `camera.up` alone keeps
  whatever the session last held; at boot that is the pole projected into the
  *default* view axis, which renders level from that vantage and no other, so
  a level share from elsewhere came back rolled by up to 66°. It is applied
  **before** focus/orbit dispatch because both of `applyFocusTarget`'s legs
  call `controls.update()`, which reads it — so it lands as a raw axis and
  the `lookAt` inside that update projects it. One `adoptFromCamera` after
  the final update puts `up` back on the perpendicular invariant.
  `DEFAULT_UP_V3` keeps world `+Y` as the v3 fill value: a v3 blob was
  written when that was the reference, and a frozen decoder has to stay
  the one v3 meant (the golden corpus pins it). Either value restores the
  same view, since both only ever reached the camera through a `lookAt`
  projection — v4's default is what buys the free bytes.
- `mode=observe` is applied **after** camera params + `controls.update()`
  so the saved pose lands first; the receiver then
  `setCameraMode('observe', { animate: false })` if the bit is set and
  a hard-kind focus (star / planet / probe) exists. Default-omitted
  (navigate). **That anchor test cannot answer while a focus is pending**:
  it reads boot's Sol focus, not the star the blob names, and applying the
  real focus bails observe straight back out. So the leg is skipped there
  and re-run from the deferred callback — § A focus that resolves after the
  pose. Chart rides with it, being observe-gated.
- The URL writer skips frame-triggered updates while
  `isCameraTransitionActive()` is true (warp, observe enter/exit, or the
  navigate-mode unfocus zoom-out) — those animate camera position and
  would otherwise flood history with intermediate poses.

Cloud-related state (cloud focus, cloud measurement vector) rides the
same universal `focus` / `to` SID refs; the shelved MC overlay toggle's
flag bit stays reserved.

The declutter `detailLevel` rides its own 1-byte enum field (bit 23,
`detailLevelField`), present only when the user cycled below the default
`all` — a fully-cluttered share stays byte-identical to before.

`coordSphere` is a **four-state carried across several places**, not one
field — and it does not carry ORB, which is § ORB and the orbit lock.
FLAG_GRID (flags bit 0) means "a coordinate sphere is selected", and
one zero-byte presence bit per frame past the galactic default says which —
bit 24 equatorial, bit 26 ecliptic, both built by `coordSphereFrameField`.
Layering rather than replacing FLAG_GRID with an enum is what makes both
compatibility directions free: a pre-equatorial link (FLAG_GRID alone) decodes
to the galactic sphere, and a client predating a frame's bit ignores the
unknown high mask bit and shows the galactic sphere instead of none. Each bit
decodes *after* `flagsField` (bit 13), so it overwrites the `'galactic'` that
`unpackFlags` wrote; an enum field would have cost the galactic case a payload
byte where it currently costs zero. **A frame's bit is frozen once it ships**
— a link in the wild carries it — so a further frame claims the next free bit
rather than renumbering.

## ORB and the orbit lock

**ORB is not a `coordSphere` value.** The sky frames (galactic / ecliptic /
equatorial) are what that field carries; ORB — the focused object's own
orbital plane — and the orbit lock over it are held by the attitude
instrument itself (`../../attitude/orbit-frame/README.md`). So a view with
ORB armed used to encode whichever sky frame was selected *before* ORB was
picked, and the lock encoded nothing at all: the link came back reading
against the wrong datum, with the camera no longer riding the orbit.

Both ride **zero-payload presence bits** — 27 (ORB armed) and 28 (lock
engaged) — because each is reconstructible from the focus the blob already
carries. The flags byte is full, so this is the § Adding a field route
rather than a flag bit. Bit 28 opens the LEB128 mask's fifth 7-bit group,
which is the lock's whole cost.

They reach the instrument through `OrbitFramePort`
(`../../attitude/attitude-pure.ts`), installed by the instrument onto the
shell — the codec talks to `Stellata`, and this is state no controller owns.

**Being on the wire is not enough: a write has to be triggered too.** The
writer wakes on a `'state'` event or on a detected pose change, and these two
are the only URL fields that are neither `FilterState` (whose every mutation
emits `'state'`) nor a pose — arming ORB writes an instrument-local variable,
and engaging the lock moves nothing a still camera would show. So the
instrument announces them itself, through
`Stellata.notifyOrbitFrameChanged()`, on any change to either
([The lock](../../attitude/orbit-frame/README.md#the-lock)). Without that the bits
reached the address bar only when some unrelated change happened to write it
afterwards, which is why the arm survived a refresh and the lock — the last
thing a user touches — did not.

**A restore lands LAST in `applyDecodedView`, and that is the field's whole
difficulty.** Three of the steps before it disarm ORB on their way past: the
instrument drops it on a focus change, on a `coordSphere` change, and with
the camera mode. A restore anywhere earlier is silently undone by a later
step of the same function, and lands unlocked. It runs again inside the
deferred-sid focus callback for the one case that settles after
`applyDecodedView` returns, so `restore` is idempotent.

**The blob is a request, not an instruction.** `restore` re-applies the
receiver's own `orbitLockShowing`, so a link asking for a lock this focus
cannot carry lands armed-but-unlocked, exactly as the gesture would. And an
absent bit is a positive statement — a sky-frame link disarms an ORB the
receiving session was already holding rather than leaving it standing.

The REF and TGT datums stay off the wire: both are snapshots of an attitude
rather than properties of the focus, so they need real payload and a separate
decision about whether a captured datum means anything to a receiver.

The manual **EV trim** rides bit 25 as a 1-byte field quantised to the
slider's own `EV_STEP_STOPS` grid, present only when the user moved it off
0. The instrument's limiting magnitude is *not* on the wire — it is derived
from the aperture, so a receiver on a different build gets that build's
limit and the trim applies on top.

`worldOffset` (FIELDS_V2 bit 20, vec3 Float32) serialises only when nothing
is focused AND the anchor is far enough from Sol to move the pose — see
[URL round-trip](/src/client/frame/README.md#url-round-trip) for the precision-anchor
semantics that make this round-trip safe, and
[What counts as a camera move](pose-change/README.md#what-counts-as-a-camera-move)
for "far enough".

## What counts as a camera move

A fraction of the orbit radius, never a distance — for the write trigger and
the encoder's elision alike. `pose-change/README.md` owns the rule.

## Extending and inspecting the wire

**Adding a field.** Claim the next free presence bit in `FIELDS_V4`,
declare its type and bytes, and add encode/decode logic in
`currentStateOf` / `applyDecodedView`. Old shared URLs decode fine
because their bit is 0 in the presence mask. Don't repurpose retired
bits (16/17) for ~6 months of deploy overlap. Breaking-shape changes
(resizing existing fields, semantic shifts) need a new
`SCHEMA_VERSION` and a new standalone `FIELDS_V<n>` table; the old
one is already frozen (add corpus entries for any shape the corpus
doesn't yet pin), and `applyFromUrl` will auto-upgrade legacy URLs to
the new schema after the same 1 s debounce as routine URL writes.

**Adding an object kind** costs nothing here: focus / to / POIs
already carry any-kind SIDs — register a resolver domain for the new
artifact and the wire just works ([§ 10](/docs/sid.md#10-adding-a-future-object-type--the-recipe)). The one wired
exception: planet sids resolve to a planet-within-host domain index,
which `IdMaps.planetTargetIndexOf` translates to the body-field flat
Target index at apply time (and `planetDomainIndexOf` back at encode
time); a translation miss — host body-field never attached — drops the
focus like an unknown sid while the rest of the state applies.
`main.ts` awaits `stellata.kinds.planet.systemsReady` before `applyFromUrl`
so the attach table is populated when a planet ref resolves.

**Console helpers.** `window.debug.decodeView('AQAA…')` decodes a blob
and `console.table`s the fields; `window.debug.encodeView()` returns
the blob for the current Stellata state. Useful when debugging a
shared URL that someone reports. Both read their argument through
`shareBlobFrom`, so a pasted address bar works as well as a bare blob.
`window.debug.capture()` flies a recordable take between two blobs and
reads their poses through `viewPose`, the one place a decoded view's
omitted pose slots resolve to the values `applyDecodedView` restores
(`../../debug/capture/README.md`).

## A focus that resolves after the pose

**With a focus, `cam` and `tgt` are frame-relative.** Focusing recentres
the floating origin onto the focal object, and the encoder elides
`worldOffset` in that case, so the restored pose is expressed in a frame
that only exists once the focus has been applied. Everything else in the
restore is absolute.

That makes focus-before-pose an ordering requirement, not a preference, and
the streaming catalogue can break it: a star in a late chunk resolves after
`applyFromUrl` has already seated the camera against the un-recentred
origin, which lands it somewhere else entirely. So the deferred branch
re-seats `cam`/`tgt` — and re-enters observe, which the same lateness cost
— itself once the focus lands. The mode leg runs **before** the ORB restore
there, since a mode change disarms ORB. A `resolvedInline` flag
distinguishes the synchronous case — where the pose below simply has not
run yet — from the late one.

**It declines when `renderGate.sawUserInput` has latched.** If the user has
touched the canvas or the keyboard while the catalogue was still arriving,
the view is theirs; a restore that yanks it back is worse than one that
gives up. The focus itself still attaches, because that costs nothing and
is what the link asked for — the camera move is abandoned, and observe with
it, since entering it parks the camera and is therefore the same move.

**Re-seating it is not enough, because the wrong frame is on screen
meanwhile.** Boot paints on the catalogue's first chunk, so between first
paint and the focal star's chunk the camera sits at the default Sol view and
the restore reads as a jump from Sol rather than as arriving. So
`applyDecodedView` returns a promise whenever a focus queued as a deferred
intent — null otherwise, including for every focus the resolver answered
synchronously — and `applyFromUrl` hands it to boot as `focusPending`.
`main.ts` holds the **full-bleed** loading cover on it rather than
revealing the live scene behind the panel, so no wrong vantage is ever
drawn.

**It settles itself only where the callback runs**, which is a resolution
that lands — including one that lands and then translates to nothing, like
a planet whose host body field never attached. A sid that never resolves
never fires the callback at all: `flushIntents` drops an intent that has
gone `unknown` without calling it, so nothing on this side settles the
promise. `kinds.star.ready` is not a belt-and-braces backstop, it is the
*only* thing that ends that wait, and boot races the two for exactly that
reason. At the complete catalogue a focus that has not landed never will,
and holding the cover that long is what boot did before it painted
progressively at all — so the worst case is the old behaviour, not a black
screen forever.
