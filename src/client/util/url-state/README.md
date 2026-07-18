# URL state

All Stellata UI state — camera pose, focus, magnitude settings, overlay
toggles, observe-mode flag, POIs — lives in a single opaque URL param:
`?v=<base64url>`. The blob is a binary, versioned envelope —
`[1 byte version] [LEB128 presence mask, 1–4 bytes] [payload]` in
v3/v4 — and only the fields that diverge from canonical defaults
occupy bytes. A fully-default state has no `?v=` at all, a typical
share lands at ~10–25 chars, and worst-case (every field overridden)
tops out around 70 chars. See `url-state.ts` for the format and the
`FIELDS_V4` table.

## Files in this area

```
src/client/util/url-state/
  url-state.ts (+ test)           ?v= encode / decode (v1–v4 formats),
                                  default-compression presence mask,
                                  per-component vec3 sub-masks,
                                  applyFromUrl entry point + post-debounce
                                  legacy→v4 rewrite, startUrlSync
                                  subscription. The test file carries the
                                  golden-blob corpus pinning the frozen
                                  v1/v2/v3 decoders byte-for-byte.
```

Four wire formats coexist. **v4** (current) replaces every parallel
object-ref encoding with one universal unsigned-LEB128 **Stellata ID**
(docs/sid.md § 9): `focus` and `to` each carry a SID of any kind — a
cloud focus is just a cloud-kind SID — and POIs are a count byte plus
one LEB128 SID per entry. No type tag rides the wire; kind comes from
the runtime resolver (`../sid-resolver/README.md`) at apply time.
Bits 16/17 (the v1–v3 1-byte cloud refs) are retired — leave them
unclaimed for ~6 months of deploy overlap. SIDs are frozen forever in
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
docs/sid.md § 9.4 migration table: HIP refs re-key exactly
(hip → index → sid), index/cloud refs freeze best-effort to whatever
they resolve to in the current build, unresolvable refs drop while
the rest of the state applies.

The v1/v2/v3 `FIELDS_V*` tables are **frozen** — standalone literal
arrays, never edited (a golden-blob corpus in `url-state.test.ts`
pins them byte-for-byte). SID refs that arrive before their object's
artifact attaches ride the resolver's deferred-intent contract; a
retired/unknown SID expires silently. POI SIDs resolve synchronously
— only star-kind objects are pinnable today and the star domain
attaches at catalog load, strictly before `applyFromUrl`.

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
  produces no `?v=` at all (clean URL).
- Focus is encoded as the object's SID, which survives any catalog
  reordering for every object (not just the ~37% with a HIP, which is
  all v1–v3 could protect). Sol is the canonical default focus and is
  encoded by *omitting* the field; "explicitly unfocused" uses a
  separate zero-byte presence bit so the three states (default Sol /
  specific object / cleared) stay unambiguous.
- If `?v=` carries a focus without camera params (a hand-typed share),
  `applyDecodedView` calls `focusStar(idx, { animate: false })` which
  snaps the camera to the park pose — URL restore must not surface as a
  2 s glide on page load. If camera params are also present, it uses
  `setOrbitTarget` so the explicit camera wins.
- Camera changes are tracked via the `'frame'` event with a stringified-coord hash
  and a 300 ms debounced writer. The hash covers position, target,
  **and** `camera.up` — so two-finger roll (which only mutates `up`)
  still triggers a URL update.
- `camera.up` round-trips when it differs from `(0, 1, 0)` and is
  applied **before** focus/orbit dispatch because `focusStar` /
  `setOrbitTarget` call `controls.update()` which reads `camera.up` to
  derive orientation.
- `mode=observe` is applied **after** camera params + `controls.update()`
  so the saved pose lands first; the receiver then
  `setCameraMode('observe', { animate: false })` if the bit is set and
  a hard-kind focus (star / planet) exists. Default-omitted (navigate).
- The URL writer skips frame-hash updates while
  `isObserveTransitionActive()` is true, mirroring the warp guard — the
  observe enter/exit translate animates camera position and would
  otherwise flood history with intermediate poses.

Cloud-related state (cloud focus, cloud measurement vector) rides the
same universal `focus` / `to` SID refs; the shelved MC overlay toggle's
flag bit stays reserved.

`worldOffset` (FIELDS_V2 bit 20, vec3 Float32) serialises only when
`focusedStar === null` AND the offset isn't ≈Sol — see
`src/client/README.md` § Floating origin for the precision-anchor
semantics that make this round-trip safe.

**Adding a field.** Claim the next free presence bit in `FIELDS_V4`,
declare its type and bytes, and add encode/decode logic in
`currentStateOf` / `applyDecodedView`. Old shared URLs decode fine
because their bit is 0 in the presence mask. Don't repurpose retired
bits (16/17) for ~6 months of deploy overlap. Breaking-shape changes
(resizing existing fields, semantic shifts) need a new
`SCHEMA_VERSION` and a new standalone `FIELDS_V<n>` table; the old
one is already frozen (add corpus entries for any shape the corpus
doesn't yet pin), and `applyFromUrl` will auto-upgrade legacy URLs to
the new schema after the same 300 ms debounce as routine URL writes.

**Adding an object kind** costs nothing here: focus / to / POIs
already carry any-kind SIDs — register a resolver domain for the new
artifact and the wire just works (docs/sid.md § 10). The one wired
exception: planet sids resolve to a planet-within-host domain index,
which `IdMaps.planetTargetIndexOf` translates to the body-field flat
Target index at apply time (and `planetDomainIndexOf` back at encode
time); a translation miss — host body-field never attached — drops the
focus like an unknown sid while the rest of the state applies.
`main.ts` awaits `stellata.planetSystemsReady` before `applyFromUrl`
so the attach table is populated when a planet ref resolves.

**Console helpers.** `window.debug.decodeView('AQAA…')` decodes a blob
and `console.table`s the fields; `window.debug.encodeView()` returns
the blob for the current Stellata state. Useful when debugging a
shared URL that someone reports.
