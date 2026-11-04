# Util

Project-agnostic plumbing for the viewer. Each topic owns a subfolder.
Physical constants, angles, frames and the Kepler solver are shared with
the build pipeline, so they live in `/src/astro-core/`.

- `ulp.ts` (+ test) — `ulpsBetween(a, b)`, the distance between two
  float64s in representable steps. The unit that separates a value which
  will not converge (a handful of ULP, re-derived each frame from inputs
  that round differently) from one that is genuinely moving (millions).
  Scale-free, which is what makes a threshold in it admissible where a
  world-space epsilon would not be. Consumers: the render gate's pose
  drift readout, and the navigate derived-pose settle floors.
- <a id="attribute-uploadts"></a>`attribute-upload.ts` (+ test) — partial GPU re-upload for an
  instanced attribute whose per-frame writes land on a small, fixed
  subset of items. `DirtyItemUploader` diffs those items against the
  previous flush and adds three.js update ranges over what moved,
  uploading nothing when nothing did; `uploadFull` is the whole-buffer
  flush, which must also be how any wholesale rewrite flushes, since a
  non-empty range list wins over the full array. `MAX_PARTIAL_RANGES`
  caps the driver-call budget, `RANGE_MERGE_GAP_ITEMS` the clean payload
  worth carrying to avoid an extra call. The uploader binds its
  attribute at construction and reads `itemSize` + the backing array off
  it, so the ranges it emits cannot address a different stride than the
  buffer they upload into — **while that attribute is a vertex
  attribute**. An itemSize-3 WebGPU storage attribute has both reassigned
  off a padded copy the uploader never sees, silently, which is why the
  WebGPU star layer reads the same array through an itemSize-1 table and
  forwards these ranges onto it verbatim
  ([One writer per buffer per submit](../webgpu/README.md#one-writer-per-buffer-per-submit)).
  Its shadow is NaN-seeded at construction and
  by `reset()` — NaN compares unequal to everything, so the first flush
  after either reports every tracked item, which is the truth in both
  cases (no GPU buffer yet / a stale one). Consumers + the invariants
  they ride on: [Partial re-upload](../binaries/README.md#partial-re-upload) (iPosition,
  iCompositeSuppress) and [Partial re-upload](../binaries/eclipse/README.md#partial-re-upload)
  (iEclipseDim).
- <a id="ecliptic-framets"></a>`ecliptic-frame.ts` (+ test) — `icrsToEcliptic` / `eclipticToIcrs`, the
  fixed `Rx(±ε)` pair about the J2000 obliquity, on plain `{x, y, z}`
  and safe to alias `out` with `v` (the moon resolver does). This is the
  scalar form; `orbit-rings-layer.ts`'s `refPlaneToEclipticQuat` is the
  quaternion one the ring vertices ride, and the two are parity-pinned
  against each other. Sign trap: the north ecliptic pole comes back with
  a NEGATIVE y — see [Gotchas](../solar-system/ephemerides/README.md#gotchas).
- `call-args.ts` (+ test) — `callArgs(src, name)`, the top-level argument
  list of a call in shader source. Walks the parens rather than matching a
  regex, so a nested call in an earlier slot cannot split the list in the
  wrong place, and matches a **whole identifier** — callers assert on
  argument text, so a hit inside a longer name would pin a different call and
  still pass. A TSL node-graph call is TypeScript, and the paren walk is
  indifferent to the language, so a pin shares this parser rather than
  matching source text with its indentation baked in. Its consumer pins which
  emitters may claim lit-surface coverage
  (`../hdr/attachments/statistic-mask.test.ts`). Nothing at runtime reads
  shader text.
- `orbit-line.ts` (+ test) — shared bits of the line overlays
  (`solar-system/ephemerides/orbit-rings-layer.ts`, `binaries/orbit-paths/binary-orbit-path-layer.ts`,
  `solar-system/probes/probe-path-layer.ts`,
  `constellation-figure/constellation-figure-layer.ts`,
  `constellation-boundaries/constellation-boundary-layer.ts`,
  `galactic/galactic-disc.ts`, `galactic/coord-spheres/coord-sphere.ts`,
  `local-group/local-group.ts`): the alpha-blended
  primitives `makeOrbitLineLoop` / `makeOrbitLine` (open polyline, for a
  traversed path with two ends) / `makeOrbitLineSegments` /
  `makeOrbitRingSegments` (many closed rings of one vertex count, indexed
  into a single draw) / `mirrorOrbitLine`
  — the **geometry** half only; the materials they take come from
  `../chrome-lines/README.md`, and `ORBIT_LINE_OPACITY` / `ORBIT_LINE_COLOUR`
  are the alpha and the stroke colour every consumer passes it. The colour is
  **one value for the whole family** — planet and moon rings, binary orbit
  paths, probe trails — at the fresnel shells' own hue
  (`SHELL_RIM_BLUE`, 210°), so the chrome the local scene draws over itself
  reads as one vocabulary. Three layers each authoring their own blue is what
  it replaced, and they had drifted to three different hues; a new line
  overlay takes this one rather than picking a fourth. A dashed consumer also owns the cumulative
  `lineDistance` attribute, because `computeLineDistances` resets the phase
  per segment pair ([Chart-mode layer](../constellation-boundaries/README.md#chart-mode-layer))
  — and the on-screen-size helpers `pixelsPerRadian`
  (+ `pixelsPerRadianFromFovRad` for callers holding the FOV in radians, and
  `pixelsPerRadianFromUniforms` for the `ScreenMetricUniforms` viewport / FOV
  slot pair every layer that sizes in screen pixels holds by reference —
  probe markers and trails, planet-body collapse, the boundary stipple) /
  `angularRadiusPx` the orbit
  layers use for their pixel-size visibility gate, plus the shared
  `FEATURE_LEGIBILITY_MIN_PX` floor + `isFeatureLegible` predicate that both
  the orbit-ring gate and the boundary-shell silhouette labels
  (`fresnel-shell/`) ride so their legibility cutoff can't drift.
  **An index entry's width turns on the vertices it addresses, never on
  how many entries there are** — `lineIndexFor` is the single place that
  rule lives, because both indexed primitives routinely build more than
  65,535 entries over a buffer a 16-bit entry still indexes, and reading
  the ceiling off the entry count widens it for nothing (the Local Group
  wireframe: 23,616 vertices, 47,232 entries, 16-bit). `writeRingVerts`
  is the ellipse sweep those buffers are filled by — a `RingSpec` names
  the two axes it sweeps and displaces the ring along the third, and a
  `place` callback carries each vertex into whatever frame the buffer
  holds. Shared by the galactic disc and the Local Group wireframe so the
  two cannot drift on the axis mapping. Also the anchored-line
  precision pair `bakeAnchoredLineVerts` / `trackAnchoredLine`: a loop
  whose centre rides far from the floating origin (a host star's ring
  under planet focus) keeps a float64 centre-relative master array and
  bakes its float32 GPU buffer renderer-local, rebaking once the centre
  drifts past `LINE_ANCHOR_MAX_DRIFT_PC` — otherwise the shader cancels
  two large float32 quantities per vertex and the line visibly jitters
  under camera motion at close framings (the Pluto-focus wobble).
- `polar-scale.ts` (+ test) — `scalePolarInto`, scaling a vector's
  component along a body's pole. `s = 1/polarRatio` carries an oblate
  spheroid onto the sphere of its equatorial radius; the map is linear
  about the body centre, so lines map to lines with their parameter
  unchanged, which is what makes a sphere test **exact** for a spheroid
  once both endpoints go through it rather than merely closer. Two
  consumers ask opposite questions of the same arithmetic: the atmosphere
  march runs in the frame where the body IS a unit sphere
  (`../solar-system/atmosphere/atmosphere-scattering-pure.ts:scalePolarComponent`,
  which stays the named CPU mirror of `stellata_scalePolar` and delegates
  here), and the label occluder asks whether a flattened body hides a
  point (`../occlusion/README.md`). The **value** of `1 − f` is not this
  file's to hold — that is
  `../solar-system/planets/spheroid-pure.ts:polarRadiusRatio`, and
  deriving it inline anywhere is the drift that README warns about.
- `pending-click.ts` — single/double-click disambiguator (hold a
  click for the double window, fire single on expiry), plus the
  `DBL_CLICK_MS` / `DBL_CLICK_DIST_PX_SQ` window every surface shares.
  Drives canvas clicks in both camera modes and the attitude ball's
  level / level-on-orbit pair (`../attitude/README.md`).
- `texture-bytes-pure.ts` (+ test) — `texelBytes(format, type)`, the one
  table mapping a three format/type pair to bytes per texel, plus
  `mipmapFactor(texture)` and the `MIP_CHAIN_FACTOR` (4/3) it returns.
  Charged by two consumers that ask different questions, which is why the
  mip halves are NOT shared: the planet-map VRAM budget
  (`../solar-system/planets/textures/texture-budget-pure.ts`) charges the
  chain unconditionally, because a planet map is minified over the whole
  disc and always ships one, while `mipmapFactor` gates on the
  minification filter, because an arbitrary texture only pays for a chain
  the filter actually samples — and `generateMipmaps` defaults to TRUE,
  so keying on the flag alone inflates every `NearestFilter` data texture
  by a third. `texelBytes` returns **null**, never a guess, for a
  compressed format or one three grew since; both callers surface that
  rather than reading it as zero. Consumers: the budget above and the
  memory inventory (`../debug/memory/README.md`).
- `fan-out.ts` (+ test) — `fanOut(label, items, fn)`: run every member of a
  fan-out, then rethrow the failures as one `AggregateError`. A bare `for`
  loop stops at the first throw, so a fan-out that puts shared state into a
  new mode (palette swap, recentre, teardown) strands the scene half in each
  mode with no recovery path, and the caller's own later steps are skipped
  too. Nothing is swallowed — a broken layer stays exactly as loud, it just
  cannot take its siblings with it. Consumers are `SceneLayerRegistry`'s four
  fan-outs (`../scene/README.md`). **Not** what `event-bus/` does, and the
  difference is deliberate: see its README.
- `radix-sort.ts` (+ test) — `sortIndicesByKeyWords(words, first, end)`,
  the stable index sort both whole-catalogue orderings ride: the
  Sol-distance proximity index ([Absorbing a chunk](../star-pipeline/star-frame/README.md#absorbing-a-chunk))
  and the extinction dispatch order
  ([Dispatch order](../webgpu/extinction/dispatch-order/README.md#dispatch-order)). A
  comparator sort of the dispatch order over the 983,068-record catalogue
  measures ~232 ms in Node; this is ~21. The key is one or more `Uint32Array` words,
  least significant first, each **indexed by record, not by position in
  the window**, and ties fall to record order. Twelve bits per pass, and a
  pass whose digit every index shares is skipped after its count, so a
  24-bit word costs two passes rather than three with no width argument.
  A float key sorts by its bit view only while every value is
  non-negative; that precondition belongs to the caller.
- `page-teardown.ts` (+ test) — `bindPageTeardown(target, reload)`: runs
  the release last passed to `hold` once, on the first `pagehide`, and
  reloads a page the back/forward cache restores after that release, since
  it comes back with nothing to draw with. `main.ts` holds the booted
  renderer's `dispose` until the shell exists, then `Stellata.dispose()`.
  `expose(name, value)` is the only way a value becomes a `window` global:
  `main.ts` binds it to `DevConsoleGlobals` (`../globals.d.ts`), so only
  `stellata` and `debug` compile, and `tests/page-teardown-contract.test.ts`
  fails any other `window` assignment under `src/client`. `pagehide` deletes every exposed name, and
  drops the held release once it has run. `signal` aborts on that same
  `pagehide`: a `window` / `document` listener nothing else removes passes
  it (`../ui/keyboard-shortcuts.ts`, `../camera/warp/warp-button.ts`,
  `../calibration/calibration-overlay.ts`), and the same test file fails
  one that does neither.
  **Why**: Safari keeps part of each reloaded page resident in the same
  content process until Safari quits
  ([WebKit bug 325706](https://bugs.webkit.org/show_bug.cgi?id=325706));
  Chrome frees it. On Stellata the device destroy is the release that
  measurably shrinks what each reload leaves behind. Clearing the globals
  made no measurable difference on its own: a heap snapshot showed the old
  shell held by a natively rooted function, not through `window`. The
  globals and listeners are released anyway because they are the
  references the page itself can drop
  ([Who releases what](../webgpu/README.md#who-releases-what)).
- `mutable.ts` — `Mutable<T>`, `T` with `readonly` stripped. For an owner
  that rewrites a context in place which its readers see as readonly
  (`FrameCtx` in `stellata.ts`, `CadenceCtx` in
  `../render-gate/cadence/clock-cadence.ts`): typing the backing object
  from the interface is what makes a field added there a compile error
  until the owner fills it.
- `event-bus/` — typed pub/sub used by `stellata.ts` for fan-out.
- `late/` — `Late<T>`: a value that lands after its reader exists, as
  pending / ready / absent with no nullable accessor.
- `sid-resolver/` — runtime SID → `{kind, localIndex}` resolution over
  attached artifacts ([§ 8](/docs/sid.md#8-runtime-resolver-b4)).
- `url-state/` — the share-URL wire format (v4) and the address-bar
  round-trip.
