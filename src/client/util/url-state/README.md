# URL state

All Stellata UI state — camera pose, focus, exposure trim, overlay
toggles, observe-mode flag, POIs — is a single opaque base64url blob.
The blob is a binary, versioned envelope —
`[1 byte version = 4] [LEB128 presence mask, 1–5 bytes] [payload]` —
and only the fields that diverge from canonical defaults
occupy bytes. A typical share lands at ~10–25 chars, and worst-case
(every field overridden) tops out around 70 chars. See `url-state.ts`
for the format and the `FIELDS_V4` table.

## Transport — canonical path vs. legacy query

The blob rides a **`/v/<blob>/` path segment** (canonical). base64url's
alphabet (`A-Za-z0-9-_`) has no `/`, so it drops into one segment with
no escaping; the trailing slash is optional on parse. A fully-default
state has no segment at all — the URL is bare `/`.

The **legacy `?v=<blob>` query form** is decoded forever: old shared
links are baked into YouTube comments and can never break. On load,
`applyFromUrl` rewrites a legacy query-form link to the canonical path
(address-bar only, via the same post-apply debounce as routine writes). The query form was retired
because platforms auto-filter comments carrying a `?…=` link.

Production serves `/v/<blob>/` via `wrangler.toml`'s `[assets]
not_found_handling = "single-page-application"` (any unmatched path →
`index.html`, 200); see `src/README.md`. Because that serves `index.html`
for *any* path, `applyFromUrl` strips the address bar back to bare `/`
when the URL carries nothing decodable — a bogus path, a stray query, or
a `/v/<blob>/` whose blob won't decode — so the bar never lingers on junk.
A pre-SID v1–v3 blob is one that won't decode: those formats are retired,
so such a link lands at the first-load view with its param stripped.

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
  share-path-pure.ts (+ test)     build / parse the /v/<blob>/ path form.
                                  Pure string helpers, split out so the
                                  path regex is unit-testable without
                                  url-state.ts's location/history writes.
                                  `shareBlobFrom` is the paste-tolerant
                                  reader over all three transports that the
                                  console helpers take their blob from.
  pose-change-pure.ts (+ test)    the one scale-free test behind both the
                                  per-frame write trigger and the encoder's
                                  cam / tgt / worldOffset elision. See
                                  README.md#what-counts-as-a-camera-move.
  anchored-pose.ts                cam and tgt measured from the anchor the
                                  receiver rebuilds. See
                                  README.md#what-counts-as-a-camera-move.
  golden-links-fixture.ts         Test-only: real share links whose
                                  decoding the suites pin.
  orbit-pose/                     ORB, the orbit lock, and a pose held
                                  relative to the orbit on the wire. Own
                                  README.
  url-state.ts (+ test)           blob encode / decode (v4),
                                  default-compression presence mask,
                                  per-component vec3 sub-masks,
                                  applyFromUrl entry point (path + legacy
                                  query parse) + post-debounce query→path
                                  rewrite, startUrlSync subscription. The
                                  test file carries the re-index survival
                                  block: a link shared from one build must
                                  land on the same star under a build whose
                                  rows re-sorted.
```

One wire format decodes. **v4** carries every object ref as one universal
unsigned-LEB128 **Stellata ID**
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
`data/sid/ledger.tsv`, so a v4 link survives any catalogue rebuild.
`cam`, `tgt`, `up` and `worldOffset` prefix their payload with a 1-byte
sub-mask, so only diverging components cost a float32; each narrow
scalar is 1 byte at its slider's native step.

SID refs that arrive before their object's artifact attaches ride the
resolver's deferred-intent contract; a retired/unknown SID expires
silently.

**The STAR domain is attached but STILL FILLING when `applyFromUrl`
runs**, because the catalogue streams ([Progressive catalog load](../../loaders/README.md#progressive-catalog-load)).
A hit resolves synchronously — which is the
whole naked-eye sky, records being apparent-V ordered — and only a miss
stays `pending` and queues, because the sid may sit in a chunk that has
not arrived ([A domain that is still filling](../sid-resolver/README.md#a-domain-that-is-still-filling)).
Withholding the domain until the last chunk instead would make
every star ref deferred, and [A focus that resolves after the pose](#a-focus-that-resolves-after-the-pose) is
why that is wrong rather than merely slow. Every other pinnable kind's
domain (planet, lg) attaches complete at boot, strictly before
`applyFromUrl`.

The vec3 sub-mask uses **strict equality** (`!==`), not the EPS=1e-3
`approx` check — under floating origin (a7d.2.11) the local-frame cam
can land at sub-µpc magnitudes, well inside that epsilon. Eliding
those as "approximately default" would silently round the camera to
the frame origin on round-trip. The cam vec3 is the only one whose
default depends on mode (`[0,0,30]` navigate / `[0,0,0]` observe);
the decoder fills missing components from the static navigate
default, then `decodeBlob`'s post-pass swaps z=0 in observe mode when
the sub-mask leaves z unset (flags decodes after cam in `FIELDS_V4`
bit order, so mode isn't known until the field loop completes).

- `url-state.ts applyFromUrl` runs **before** `startUrlSync` subscribes, so
  applying the URL on load doesn't echo back into history.
- Default-compression: a field is encoded only when its value differs
  from the canonical default. Encoder pre-computes the presence mask
  in one walk, then writes only the bytes for set bits. Default state
  produces no blob at all (bare `/`).
- Focus is encoded as the object's SID, which survives any catalog
  reordering for every object. Sol is the canonical default focus and is
  encoded by *omitting* the field; "explicitly unfocused" uses a
  separate zero-byte presence bit so the three states (default Sol /
  specific object / cleared) stay unambiguous.
- **An absent `focus` is a positive statement, and the receiver owes the
  rebuild.** A hard focus is also what elides `worldOffset` ([`worldOffset`
  below](#worldoffset-carries-the-frame)), so a blob carrying neither field is asserting the default frame —
  origin on Sol — and `applyDecodedView` re-establishes it before writing
  `cam` / `tgt`. A blob that states its frame some other way (an explicit
  `worldOffset`) is left alone so nothing recentres twice. On a page load this changes nothing, because catalog
  attach has already focused Sol; it is what makes a blob applied to a
  **running** session — a pasted link, a `debug.capture` take — land in the
  frame its coordinates were measured in rather than whichever one the
  session had drifted to.
- **Every focus a blob asks for lands through `applyFocusTarget`**, whatever
  kind it names and whichever of the two routes decoded it — the asserted
  default frame above, or a sid. Its
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
  comparison of [What counts as a camera move](#what-counts-as-a-camera-move) (no per-frame allocations)
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
  entirely, as it always did. A pose written in ORB elides against ORB's
  pole instead ([An orbit-relative pose](orbit-pose/README.md#an-orbit-relative-pose)).
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
- `mode=observe` is applied **after** camera params + `controls.update()`
  so the saved pose lands first; the receiver then
  `setCameraMode('observe', { animate: false })` if the bit is set and
  a hard-kind focus (star / planet / probe) exists. Default-omitted
  (navigate). **That anchor test cannot answer while a focus is pending**:
  it reads boot's Sol focus, not the star the blob names, and applying the
  real focus bails observe straight back out. So the leg is skipped there
  and re-run from the deferred callback — [A focus that resolves after the
  pose](#a-focus-that-resolves-after-the-pose). Chart rides with it, being observe-gated.
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
field — and it does not carry ORB, which is [ORB and the orbit lock](orbit-pose/README.md#orb-and-the-orbit-lock).
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

Bits 27 (ORB armed), 28 (lock engaged) and 29 (pose written in ORB) are
[`orbit-pose/README.md`](orbit-pose/README.md)'s — the fields, the restore ordering, and
why a locked link stores its pose relative to the orbit rather than the stars.

The manual **EV trim** rides bit 25 as a 1-byte field quantised to the
slider's own `EV_STEP_STOPS` grid, present only when the user moved it off
0. The instrument's limiting magnitude is *not* on the wire — it is derived
from the aperture, so a receiver on a different build gets that build's
limit and the trim applies on top.

`worldOffset` (bit 20, sub-masked vec3 Float32) serialises only when nothing
is focused AND the anchor is far enough from Sol to move the pose — see
[URL round-trip](/src/client/frame/README.md#url-round-trip) for the precision-anchor
semantics that make this round-trip safe, and [What counts as a camera move](#what-counts-as-a-camera-move)
for "far enough".

## What counts as a camera move

Every threshold on a pose vector — the per-frame write trigger and the
encoder's cam / tgt / worldOffset elision alike — is **a fraction of the
orbit radius `|cam − tgt|`, never a distance**. `pose-change-pure.ts` owns
the rule and the one constant, `POSE_CHANGE_EPS`.

The rule is angular and metric at once, which is why it needs no cases:
`|Δcam| / r` IS the angle the move subtends at the orbit target, so an orbit
gesture and a dolly land on the same test. Pan and OBSERVE's look-around
land in `tgt` against the same radius; roll moves neither point and is read
off `camera.up`, a unit axis whose delta is the roll angle itself. OBSERVE
has no orbit pivot but still carries a radius — the serialised look pin a
parsec down the forward axis (`../../camera/observe/README.md`).

**An absolute threshold is wrong at every vantage but one**, and this camera
reaches lunar orbit and the Local Group in a session ([Camera-anywhere](/AGENTS.md#camera-anywhere-any-epoch--a-mental-model-rule)).
The rule this replaced was `max(1e-9 pc, min(1e-3 pc,
1 % of magnitude))`, and each term failed somewhere: the 1e-9 pc floor is
**30,857 km**, so beside the Moon the camera had to travel seven times its
own distance from the body before the URL was rewritten and a whole orbit
went unrecorded; the 1e-3 pc encoder band called a 30-billion-km pan
"default", and called the anchor of every unfocused view inside the solar
system "Sol", so the receiver rebuilt the pose 1 AU away.

**The pose is measured from the anchor the RECEIVER rebuilds**, not from the
local origin — `url-state.ts`'s `anchoredPose`, which both writers read so
they cannot disagree about what has moved. A hard focus recentres the origin
onto the object at apply time, while the sender's own recentre fires only
once the camera has drifted 16× the eye distance
(`../../camera/focus/focal-ride/focal-ride-pure.ts`). Between two of those the
moving-focal ride carries camera and target along with the object: raw local
values drift out of any frame the receiver reconstructs, and they carry
motion the viewer cannot see, which under a scale-relative trigger is
unbounded URL churn against a *trailing* debounce — that is, no URL write at
all. Subtracting the anchor removes both.

<a id="worldoffset-carries-the-frame"></a>**Where no anchor is subtracted, `worldOffset` carries the frame instead**, and
the encoder gates that field on the exact complement of this test rather than
on a second rule of its own. Three cases leave the pose un-anchored: nothing
focused, a source that will not resolve, and a **soft-kind focus** — only a
hard kind recentres the origin (`../../camera/focus/focus-target.ts`
`KIND_TRAITS`), so a cloud, an LG object or a shell can be focused with the
frame still sitting on whatever was focused before it.

Two bounds fix the constant: below ~1e-3 the round-trip error is sub-pixel
on any display, and it has to stay well clear of the float32 wire's own
6e-8 resolution or a settled camera would rewrite the URL forever. Its
tests pin the behaviour at five vantages spanning ten orders of magnitude,
which is the property that matters — not the value.

<a id="adding-a-field"></a>**Adding a field.** Claim the next free presence bit in `FIELDS_V4`,
declare its type and bytes, and add encode/decode logic in
`currentStateOf` / `applyDecodedView`. Old shared URLs decode fine
because their bit is 0 in the presence mask. Don't repurpose retired
bits (16/17) for ~6 months of deploy overlap. Breaking-shape changes
(resizing existing fields, semantic shifts) need a new
`SCHEMA_VERSION` and a new `FIELDS_V<n>` table, and v4 links are in the
wild, so `FIELDS_V4` stays beside it as a standalone frozen decoder.
Before editing anything for the new version, commit a golden corpus of
real v4 blobs with their expected decoded views to `url-state.test.ts`, so the new work provably cannot alter v4 decoding.

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
promise. The binaries attach, which follows the complete catalogue by a
frame, is not a belt-and-braces backstop, it is the *only* thing that ends
that wait, and boot races the two for exactly that reason. At the complete
catalogue a focus that has not landed never will, and holding the cover that
long is what boot did before it painted progressively at all — so the worst
case is the old behaviour, not a black screen forever. The same promise also
holds for a locked pose on a pair whose orbit has not attached yet
([A pair whose orbit attaches late](orbit-pose/README.md#a-pair-whose-orbit-attaches-late)), which is why the race
is against the attach rather than the catalogue alone.

## A pin that resolves after the link

A POI sid in a chunk that has not arrived is `pending`, not absent, so the
restore queues it like the focus sid rather than dropping it. `restorePins`
keeps one slot per sid in the link's order; each late landing re-writes the
pin list in that order — **unless the user has edited the pins since the
restore last wrote them**, in which case the edit stands and the late pin is
appended. A later `applyDecodedView` supersedes the earlier link's slots, and
a blob carrying no pins forgets them.

**Until it lands, the encoder keeps writing it.** Any URL write in the
window — a state emit, a query→path rewrite — encodes the live pin list,
which does not hold it yet, so `currentStateOf` appends every link sid the
resolver still answers `pending` for. Once the catalogue completes, a sid
nothing carries answers `unknown` and drops from the wire on the next write.
