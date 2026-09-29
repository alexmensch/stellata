import * as THREE from 'three';
import type { Stellata } from '../../stellata';
import {
  type FilterState,
  DEFAULT_FOV,
  ALL_SPECT_MASK,
} from '../../filters/filter-state';
import { EV_MAX_STOPS, EV_STEP_STOPS } from '../../hdr/exposure/exposure-epoch';

/** The retired magnitude presets, decoded off v4 blobs shared before the
 *  field retired; nothing downstream acts on them. */
type LegacyPresetName = 'naked-eye' | 'binoculars' | 'all';
import { type DetailLevel, DETAIL_LEVELS, DETAIL_RANK } from '../../scene/declutter/scene-elements';
import { POI_MAX_COUNT } from '../../poi/poi-store';
import { sliderToDist, distToSlider, SLIDER_STEPS } from '../../camera/controls/controls';
import { setUnit, getUnit, onUnitChange } from '../../ui/distance-util';
import { isLive } from '../../solar-system/time/time';
import type { SidResolver } from '../sid-resolver';
import { isHardTarget, targetListsEqual, type Target, type TargetKind } from '../../camera/focus/focus-target';
import { buildSharePath, pickShareBlob } from './share-path-pure';
import {
  divergesFromDefault, orbitRadius, poseChanged, type Vec3Like,
} from './pose-change-pure';
import { GALACTIC_NORTH_POLE_ICRS } from '../../galactic/galactic-coords';
import type {
  CoordSphereFrame,
  DrawnCoordSphereFrame,
} from '../../galactic/coord-spheres/coord-sphere';

// Wire format and the "adding a field" recipe: README.md.
//
// Buffer order (FIELDS bit-index order) is independent of the dispatch
// order in applyDecodedView. Both are load-bearing — see the inline
// comments at each apply step.

// Trailing-debounce window for address-bar writes. 1s keeps the URL calm
// during continuous scrub/drag (writes fire once state settles, not
// mid-motion) and stays clear of browsers' history.replaceState rate
// limits. Shared with applyFromUrl's one-shot query→path rewrite.
const DEBOUNCE_MS = 1000;
const SCHEMA_VERSION = 4;
// Quantised-scalar slots only — `fov` in degrees and `ev` in stops, each far
// coarser than this. Pose vectors carry no absolute threshold at all; they go
// through `pose-change-pure.ts`.
const SCALAR_EPS = 1e-3;

// Default values that the encoder uses to decide whether to omit a field.
const DEFAULT_CAM: [number, number, number] = [0, 0, 30];
const DEFAULT_TGT: [number, number, number] = [0, 0, 0];
// The `up` slot carries `camera.up` (/src/client/camera/controls/input/README.md#roll-authority).
// A galactic-LEVEL camera omits the field, and the receiver's own
// default reproduces it — the test is the rendered roll, not the vector,
// because up is the pole's image-plane projection and so equals the pole
// itself from no viewpoint at all.
const DEFAULT_UP: [number, number, number] = [
  GALACTIC_NORTH_POLE_ICRS.x, GALACTIC_NORTH_POLE_ICRS.y, GALACTIC_NORTH_POLE_ICRS.z,
];
// Roll off galactic level under which the `up` field is omitted, and the
// receiver reproduces it from DEFAULT_UP instead. Far above the float noise
// of the projection and far below any roll a gesture can hold, so only a
// camera the user levelled elides it.
const LEVEL_UP_EPS_RAD = 1e-5;
const DEFAULT_WORLD_OFFSET: [number, number, number] = [0, 0, 0];
// In observe mode the camera is parked AT the focal star (origin in the
// local frame), so the canonical default is [0,0,0] rather than DEFAULT_CAM.
// Encoder elides cam against this; decoder snaps to it when restoring an
// observe pose with cam absent. Single name shared by both halves so the
// invariant is enforced in code, not just prose.
const OBSERVE_CAM_LOCAL: [number, number, number] = [0, 0, 0];

// Mode-aware default for cam, used by both encoder (omit-if-equal) and
// decoder (snap-when-absent). The cam-omission invariant says: a default
// observe pose has cam=[0,0,0], a default navigate pose has cam=DEFAULT_CAM.
// Both sites must use the same predicate or round-trips diverge.
function defaultCamForMode(mode: 'navigate' | 'observe' | undefined): [number, number, number] {
  return mode === 'observe' ? OBSERVE_CAM_LOCAL : DEFAULT_CAM;
}

/** Every pose slot a blob can carry, omitted ones filled.
 *  README.md, the applyFocusTarget bullet. */
export interface ViewPose {
  cam: [number, number, number];
  tgt: [number, number, number];
  up: [number, number, number];
  fov: number;
}

export function viewPose(view: DecodedView): ViewPose {
  return {
    cam: view.cam ?? defaultCamForMode(view.mode),
    tgt: view.tgt ?? DEFAULT_TGT,
    up: view.up ?? DEFAULT_UP,
    fov: view.fov !== undefined && view.fov > 0 ? view.fov : DEFAULT_FOV,
  };
}

const PRESET_TO_INDEX: Record<LegacyPresetName, number> = {
  'naked-eye': 0,
  'binoculars': 1,
  'all': 2,
};
const INDEX_TO_PRESET: LegacyPresetName[] = ['naked-eye', 'binoculars', 'all'];

// Flags byte — packed booleans + small enums. Each bit is "non-default":
//   0 = a coordinate sphere is up, 1 = HUD on, 2 = reserved, 3 = MW disabled,
//   4 = unit pc, 5 = mode observe, 6 = chart on (only set when also
//   mode=observe — chart is observe-gated), 7 = constellations disabled.
// Which sphere is up rides presence bit 24 on top of bit 0 — see
// coordSphereFrameField.
const FLAG_GRID         = 1 << 0;
const FLAG_HUD          = 1 << 1;
// bit 2 reserved (formerly FLAG_MC_DISABLED — retired; molecular-cloud
// visibility is the declutter floor, no per-layer flag)
// bit 3 reserved (formerly FLAG_MW_DISABLED — retired; the galactic band
// is physical light gated by the declutter floor, not a user overlay)
const FLAG_UNIT_PC      = 1 << 4;
const FLAG_MODE_OBSERVE = 1 << 5;
const FLAG_CHART        = 1 << 6;
// bit 7 reserved (formerly FLAG_CON_DISABLED — retired; constellation
// chrome is the declutter floor's call, no master toggle)

export interface IdMaps {
  /** Sol's row index, or -1 if missing. */
  solIndex: number;
  /** Global SID resolver over every object-carrying artifact —
   *  see src/client/util/sid-resolver/README.md for the wiring map. */
  sidResolver: SidResolver;
  /** Planet index translation between the SID planet domain
   *  (planet-within-host, host implicit per domain — Sol today) and
   *  the Target {kind:'planet'} currency (PlanetBodyField flat
   *  instance index). Null when the host isn't attached / the index
   *  isn't covered. */
  planetDomainIndexOf: (targetIdx: number) => number | null;
  planetTargetIndexOf: (domainIndex: number) => number | null;
}

/** v4 universal object ref: a frozen Stellata ID of any kind (star,
 *  cloud, planet, …) — the runtime resolver supplies the kind. */
export type SidRef = { kind: 'sid'; id: number };

export interface DecodedView {
  cam?: [number, number, number];
  tgt?: [number, number, number];
  up?: [number, number, number];
  fov?: number;
  /** v4 blobs shared before the field retired: the app-magnitude filter. Decode-and-ignore, same as `preset`. */
  mag?: number;
  /** Manual EV trim, in stops. Default 0, omitted when default. */
  ev?: number;
  dmin?: number;
  dmax?: number;
  spect?: number;
  /** v4 blobs shared before it retired: the magnitude preset. Decoded so old
   *  links still load, then ignored — the instrument owns the limit. */
  preset?: LegacyPresetName;
  /** Declutter detail level. Default 'all' (fully cluttered) — encoded
   *  only when the user cycled below it. */
  detailLevel?: DetailLevel;
  con?: number;
  /** v4 blobs shared before they retired: the star-size / footprint-window sliders.
   *  Decode-and-ignore, same as `mag` — the plate scale owns star pixel
   *  size and the instrument owns the footprint window. */
  smin?: number;
  smax?: number;
  span?: number;
  /** Which coordinate sphere is up. Default 'none'; 'galactic' is FLAG_GRID
   *  alone, 'equatorial' is FLAG_GRID plus presence bit 24 (so a client
   *  predating the equatorial sphere still shows *a* sphere). */
  coordSphere?: CoordSphereFrame;
  showHud?: boolean;
  showLgEmission?: boolean;
  unit?: 'pc' | 'ly';
  mode?: 'navigate' | 'observe';
  /** Object focus. Undefined = default (Sol). 'cleared' = explicitly
   *  unfocused. A SidRef of any kind — a cloud focus is just a cloud-kind
   *  SID. */
  focus?: 'cleared' | SidRef;
  /** Vector-to object (the chevron measurement line). Same ref
   *  semantics as `focus`. */
  to?: SidRef;
  /** Chart mode (observe-only). Only encoded when `mode === 'observe'`. */
  chart?: boolean;
  /** ORB armed on the attitude instrument — the focused object's own orbital
   *  plane. Not a `coordSphere` value: the instrument holds this one, and the
   *  frame itself rebuilds from the focus, so the bit needs no payload
   *  (`../../attitude/orbit-frame/README.md`). */
  orb?: boolean;
  /** The orbit lock engaged. ORB-only, and the receiver's own
   *  `orbitLockShowing` rule still decides whether it can exist. */
  orbLock?: boolean;
  /** Pinned points-of-interest as SIDs, any camera mode. SIDs
   *  survive catalog rebuilds by construction. Hard-capped at
   *  POI_MAX_COUNT to bound the blob. */
  poiSids?: number[];
  /** Absolute-space position anchoring the floating origin. Emitted
   *  only when no focus is active and the anchor isn't Sol — i.e.
   *  after a close-orbit unfocus left the origin parked at the former
   *  focal object. The loader applies this *before* cam/tgt so cam/tgt
   *  (kept as small local-frame coordinates) land in the right frame.
   *
   *  Why a free vec3 rather than a catalog ref: the anchor concept
   *  generalises beyond stars to clouds, planets, probes, and other
   *  future objects. Encoding the world-space position directly keeps
   *  the URL agnostic to anchor type and decouples it from catalog
   *  identifiers that may not exist (planets) or may shift under
   *  catalog rebuilds. Float32 ULP at megaparsec absolute scale is
   *  ~10⁻² pc — invisible in any view because the user-visible pose
   *  is the cam/tgt offset *within* the local frame, and that's
   *  encoded at full Float32 precision relative to the anchor. */
  worldOffset?: [number, number, number];
  /** Wall-clock `t` (Unix-seconds, double precision) for the solar-
   *  system layer. Emitted only when the user has scrubbed away from
   *  "now"; absence ⇒ receiver resolves to their local wall-clock at
   *  load time. v1 wires the path but never emits —
   *  the time-scrubber epic flips on emission by
   *  introducing pinned-`t` state. */
  t?: number;
}

type Vec3Key = 'cam' | 'tgt' | 'up' | 'worldOffset';
type ComponentDefaults = (v: DecodedView) => readonly [number, number, number];
/** Mode-dependent post-decode fix-up for vec3FieldV3 fields whose
 *  default depends on view state populated by a *later* field in the
 *  decode loop (currently just cam, whose z-default depends on mode
 *  set by flags at bit 13). `sub` is the sub-mask byte the field
 *  decoded; the hook uses it to distinguish "value on the wire" from
 *  "value filled from the static default". */
type ApplyMode = (v: DecodedView, sub: number) => void;

interface FieldSpec {
  bit: number;
  key: string;
  /** Bytes the field consumes when encoding `v`. Most fields are
   *  fixed-size and ignore the argument. The `poiSids` field reads it to
   *  size the variable-length payload. */
  encodeBytes(v: DecodedView): number;
  /** Bytes the field consumes when decoding from `dv` starting at `off`.
   *  Same shape as encodeBytes — fixed-size fields ignore arguments;
   *  variable-length fields read a length-prefix byte. */
  decodeBytes(dv: DataView, off: number): number;
  isPresent(v: DecodedView): boolean;
  /** Encode the field at `off`. Returns the number of bytes written so
   *  the caller can advance `off` without a second `encodeBytes` call —
   *  matters for vec3FieldV3 / poiSids where the byte count requires
   *  recomputing the sub-mask or list length. */
  encode(v: DecodedView, dv: DataView, off: number): number;
  decode(v: DecodedView, dv: DataView, off: number): void;
  /** Optional post-pass invoked after the full field-decode loop, only
   *  when the field's mask bit is set this round. Used by vec3FieldV3
   *  to apply mode-dependent default fix-up that can't run during
   *  decode itself because the relevant view field decodes later. */
  postDecode?(v: DecodedView): void;
}

function fixed(n: number) {
  return { encodeBytes: (_v: DecodedView) => n, decodeBytes: (_dv: DataView, _o: number) => n };
}

// v3 vec3 — 1-byte sub-mask (low 3 bits = which components diverge
// from default) + per-set-bit float32 LE. A vec3 matching its default
// in all three components has isPresent=false and is omitted from the
// outer presence mask entirely.
//
// `getDefault` resolves the per-component default for the current view.
// Static-default keys (tgt, up, worldOffset) pass `() => def`; cam's
// default depends on mode and passes `v => defaultCamForMode(v.mode)`.
// Localising the rule on the field spec means the encoder never branches
// on the key string.
//
// `postDecode` (optional) runs after the full field-decode loop, only
// when this field's mask bit was present this round. Used by cam to
// swap z=0 in observe mode when the sub-mask leaves z unset (cam
// decodes before flags-which-sets-mode, so the fix-up can't run during
// cam.decode itself).
//
// Strict equality (===), not approx — under floating-origin the local-
// frame cam can land at sub-µpc magnitudes (~1e-6 pc) that are well
// inside the URL-write debouncer's 1e-3 epsilon. Eliding those as
// "approximately default" would round the camera silently to the
// frame origin on round-trip and break the close-orbit unfocus contract.
function vec3FieldV3(
  bit: number,
  key: Vec3Key,
  getDefault: ComponentDefaults,
  postDecode?: ApplyMode,
): FieldSpec {
  // Captured during decode so the optional postDecode hook can
  // distinguish "z was on the wire" from "z came from the static def".
  // Module-singleton FieldSpec is safe under synchronous decode; the
  // value is freshly written by decode() in the same round before the
  // post-decode loop reads it.
  let lastSub = 0;
  return {
    bit, key,
    encodeBytes: v => {
      const t = v[key]!;
      const d = getDefault(v);
      let n = 1;
      if (t[0] !== d[0]) n += 4;
      if (t[1] !== d[1]) n += 4;
      if (t[2] !== d[2]) n += 4;
      return n;
    },
    decodeBytes: (dv, off) => {
      const sub = dv.getUint8(off);
      let n = 1;
      if (sub & 1) n += 4;
      if (sub & 2) n += 4;
      if (sub & 4) n += 4;
      return n;
    },
    isPresent: v => {
      const t = v[key];
      if (!t) return false;
      const d = getDefault(v);
      return t[0] !== d[0] || t[1] !== d[1] || t[2] !== d[2];
    },
    encode: (v, dv, o) => {
      const t = v[key]!;
      const d = getDefault(v);
      let sub = 0;
      if (t[0] !== d[0]) sub |= 1;
      if (t[1] !== d[1]) sub |= 2;
      if (t[2] !== d[2]) sub |= 4;
      dv.setUint8(o, sub);
      let p = o + 1;
      if (sub & 1) { dv.setFloat32(p, t[0], true); p += 4; }
      if (sub & 2) { dv.setFloat32(p, t[1], true); p += 4; }
      if (sub & 4) { dv.setFloat32(p, t[2], true); p += 4; }
      return p - o;
    },
    decode: (v, dv, o) => {
      // Sub-mask bit budget: low 3 bits = which components diverge
      // from default; high 5 bits (bits 3-7) are reserved and
      // silently ignored on decode. A future encoder can repurpose
      // them (e.g. a per-component f64 escape) without bumping
      // SCHEMA_VERSION — older clients will keep decoding the low 3
      // bits correctly.
      const sub = dv.getUint8(o);
      lastSub = sub;
      // `getDefault` rather than a captured record: `up`'s default differs
      // per schema version (v3 predates the galactic reference axis), and
      // cam's mode-dependent default resolves to its navigate value here
      // because `v.mode` decodes later — which is what postDecode fixes.
      const d = getDefault(v);
      const out: [number, number, number] = [d[0], d[1], d[2]];
      let p = o + 1;
      if (sub & 1) { out[0] = dv.getFloat32(p, true); p += 4; }
      if (sub & 2) { out[1] = dv.getFloat32(p, true); p += 4; }
      if (sub & 4) { out[2] = dv.getFloat32(p, true); p += 4; }
      v[key] = out;
    },
    postDecode: postDecode ? v => postDecode(v, lastSub) : undefined,
  };
}

function u16Field(bit: number, key: 'dmin' | 'dmax' | 'spect'): FieldSpec {
  return {
    bit, key, ...fixed(2),
    isPresent: v => v[key] !== undefined,
    encode: (v, dv, o) => { dv.setUint16(o, v[key]!, true); return 2; },
    decode: (v, dv, o) => { v[key] = dv.getUint16(o, true); },
  };
}

// LEB128: 7-bit payload + continuation bit per byte, low-group-first —
// the outer presence mask and every SID ref.
//
// Exported for unit-level tests in url-state.test.ts.
export function writeVarint(dv: DataView, off: number, val: number): number {
  let n = 0;
  let x = val >>> 0;
  do {
    let byte = x & 0x7f;
    x >>>= 7;
    if (x !== 0) byte |= 0x80;
    dv.setUint8(off + n, byte);
    n++;
  } while (x !== 0);
  return n;
}

export function readVarint(dv: DataView, off: number, end: number): { val: number; bytes: number } {
  let val = 0;
  let n = 0;
  let shift = 0;
  for (;;) {
    if (off + n >= end) throw new Error('Varint runs past blob end');
    const byte = dv.getUint8(off + n);
    val |= (byte & 0x7f) << shift;
    n++;
    if (!(byte & 0x80)) return { val: val >>> 0, bytes: n };
    shift += 7;
    if (shift >= 32) throw new Error('Varint mask too long');
  }
}

export function varintLen(val: number): number {
  let n = 0;
  let x = val >>> 0;
  do {
    x >>>= 7;
    n++;
  } while (x !== 0);
  return n;
}

// Quantised uint8 field. The quant grid matches each slider's native (min, max, step) so
// round-trips are exact at slider resolution. Encoder clamps to [0, max
// byte] so a programmatic out-of-range setter saturates instead of
// wrapping.
function u8Field(
  bit: number,
  key: 'fov' | 'mag' | 'smin' | 'smax' | 'span' | 'ev',
  q: { min: number; max: number; step: number },
): FieldSpec {
  const maxByte = Math.round((q.max - q.min) / q.step);
  return {
    bit, key, ...fixed(1),
    isPresent: v => v[key] !== undefined,
    encode: (v, dv, o) => {
      const raw = Math.round((v[key]! - q.min) / q.step);
      const u = Math.max(0, Math.min(maxByte, raw));
      dv.setUint8(o, u);
      return 1;
    },
    decode: (v, dv, o) => {
      v[key] = q.min + dv.getUint8(o) * q.step;
    },
  };
}

/** Retire a field without breaking blobs that already carry it: the
 *  encoder never emits the bit, but the decoder still consumes the
 *  payload bytes so every later field keeps its offset. */
function decodeOnly(spec: FieldSpec): FieldSpec {
  return { ...spec, isPresent: () => false };
}

function presetField(bit: number): FieldSpec {
  return {
    bit, key: 'preset', ...fixed(1),
    isPresent: v => v.preset !== undefined,
    encode: (v, dv, o) => { dv.setUint8(o, PRESET_TO_INDEX[v.preset!]); return 1; },
    decode: (v, dv, o) => {
      const idx = dv.getUint8(o);
      v.preset = INDEX_TO_PRESET[idx] ?? 'naked-eye';
    },
  };
}

// Declutter detail level — 1-byte enum, present only when != 'all' (the
// default). Mirrors presetField's shape.
function detailLevelField(bit: number): FieldSpec {
  return {
    bit, key: 'detailLevel', ...fixed(1),
    isPresent: v => v.detailLevel !== undefined && v.detailLevel !== 'all',
    encode: (v, dv, o) => { dv.setUint8(o, DETAIL_RANK[v.detailLevel!]); return 1; },
    decode: (v, dv, o) => {
      const idx = dv.getUint8(o);
      v.detailLevel = DETAIL_LEVELS[idx] ?? 'all';
    },
  };
}

function conField(bit: number): FieldSpec {
  return {
    bit, key: 'con', ...fixed(1),
    isPresent: v => v.con !== undefined,
    encode: (v, dv, o) => { dv.setInt8(o, v.con!); return 1; },
    decode: (v, dv, o) => { v.con = dv.getInt8(o); },
  };
}

function flagsField(bit: number): FieldSpec {
  return {
    bit, key: 'flags', ...fixed(1),
    isPresent: v => packFlags(v) !== 0,
    encode: (v, dv, o) => { dv.setUint8(o, packFlags(v)); return 1; },
    decode: (v, dv, o) => { unpackFlags(v, dv.getUint8(o)); },
  };
}

// Zero-byte sentinel — presence bit IS the value. Distinct from "focus
// bit absent" (= default Sol) and from "focus bit present" (= some
// specific star). When this bit is set, the receiver explicitly clears
// focus regardless of starting state.
function focusClearedField(bit: number): FieldSpec {
  return {
    bit, key: 'focusCleared', ...fixed(0),
    isPresent: v => v.focus === 'cleared',
    encode: () => 0,
    decode: v => { v.focus = 'cleared'; },
  };
}

// The flags byte (bits 0-7) is full, so this default-on toggle rides a
// zero-byte presence bit of its own: bit set = LG emission disabled.
function lgEmissionDisabledField(bit: number): FieldSpec {
  return {
    bit, key: 'lgEmissionDisabled', ...fixed(0),
    isPresent: v => v.showLgEmission === false,
    encode: () => 0,
    decode: v => { v.showLgEmission = false; },
  };
}

// A boolean whose presence bit IS the value: set means true, absent means the
// default. Zero payload, so it costs nothing but the mask bit — which is what
// the flags byte being full leaves as the cheap way to add one.
function boolBitField(bit: number, key: 'orb' | 'orbLock'): FieldSpec {
  return {
    bit, key, ...fixed(0),
    isPresent: v => v[key] === true,
    encode: () => 0,
    decode: v => { v[key] = true; },
  };
}

// Which coordinate sphere FLAG_GRID means — one zero-byte presence bit per
// frame past the default, since the flags byte is full. No bit set = galactic.
// Each decodes after flagsField (bit 13), so it overwrites the 'galactic' that
// unpackFlags wrote. A frame's bit is frozen once it ships.
function coordSphereFrameField(bit: number, frame: DrawnCoordSphereFrame): FieldSpec {
  return {
    bit, key: `coordSphere-${frame}`, ...fixed(0),
    isPresent: v => v.coordSphere === frame,
    encode: () => 0,
    decode: v => { v.coordSphere = frame; },
  };
}

// Scrubber-pinned `t` (Unix-seconds, float64). Stale clients silently
// ignore it and resolve `t` to local wall-clock now — the same fallback
// as a URL without the field.
function tField(bit: number): FieldSpec {
  return {
    bit, key: 't', ...fixed(8),
    isPresent: v => v.t !== undefined,
    encode: (v, dv, o) => { dv.setFloat64(o, v.t!, true); return 8; },
    decode: (v, dv, o) => { v.t = dv.getFloat64(o, true); },
  };
}

// v4 universal object ref — an unsigned LEB128 SID (/docs/sid.md#91-sid-ref).
// No type tag on the wire; kind comes from the runtime resolver at
// apply time.
function sidRefField(bit: number, key: 'focus' | 'to'): FieldSpec {
  const sidOf = (v: DecodedView): number | null => {
    const ref = v[key];
    return typeof ref === 'object' ? ref.id : null;
  };
  return {
    bit, key,
    encodeBytes: v => varintLen(sidOf(v)!),
    decodeBytes: (dv, off) => readVarint(dv, off, dv.byteLength).bytes,
    isPresent: v => sidOf(v) !== null,
    encode: (v, dv, o) => writeVarint(dv, o, sidOf(v)!),
    decode: (v, dv, o) => {
      v[key] = { kind: 'sid', id: readVarint(dv, o, dv.byteLength).val };
    },
  };
}

// POI list: 1-byte count + one LEB128 SID per entry, capped at
// POI_MAX_COUNT both ways — the decode cap guards a hand-edited URL.
function poiSidsField(bit: number): FieldSpec {
  return {
    bit, key: 'poiSids',
    encodeBytes: v => {
      const list = (v.poiSids ?? []).slice(0, POI_MAX_COUNT);
      return 1 + list.reduce((n, sid) => n + varintLen(sid), 0);
    },
    decodeBytes: (dv, off) => {
      const n = Math.min(dv.getUint8(off), POI_MAX_COUNT);
      let p = off + 1;
      for (let i = 0; i < n; i++) p += readVarint(dv, p, dv.byteLength).bytes;
      return p - off;
    },
    isPresent: v => Array.isArray(v.poiSids) && v.poiSids.length > 0,
    encode: (v, dv, o) => {
      const list = (v.poiSids ?? []).slice(0, POI_MAX_COUNT);
      dv.setUint8(o, list.length);
      let p = o + 1;
      for (const sid of list) p += writeVarint(dv, p, sid);
      return p - o;
    },
    decode: (v, dv, o) => {
      const n = Math.min(dv.getUint8(o), POI_MAX_COUNT);
      const out: number[] = [];
      let p = o + 1;
      for (let i = 0; i < n; i++) {
        const { val, bytes } = readVarint(dv, p, dv.byteLength);
        out.push(val);
        p += bytes;
      }
      v.poiSids = out;
    },
  };
}

// cam's per-component default depends on mode (set by flags at bit 13,
// which decodes after cam), so cam carries a postDecode that swaps z=0
// in observe mode when the sub-mask leaves z unset.
const camDefault: ComponentDefaults = v => defaultCamForMode(v.mode);
const camObservePostDecode: ApplyMode = (v, sub) => {
  if (v.cam && v.mode === 'observe' && !(sub & 4)) v.cam[2] = 0;
};

// ── FIELDS_V4 — the live schema ──────────────────────────────────────
// v4 (/docs/sid.md#92-fields_v4): the three parallel object-ref encodings
// collapse into one universal LEB128 SID ref. focus/to carry a SID of
// any kind (a cloud focus is just a cloud-kind SID); POIs persist by
// SID. Bits 16/17 (the pre-SID 1-byte cloud refs) are RETIRED — leave
// them unclaimed for ~6 months of deploy overlap before any reuse.
// Append-only bit policy: unknown high mask bits are ignored by the
// decoder.
// Bits 4 (app-magnitude filter), 8 (magnitude preset), 10/11/12 (star
// size min / max / footprint window) are RETIRED — the instrument owns the
// limiting magnitude and the plate scale owns the footprint, so a blob
// carrying any of them decodes and is ignored rather than failing. They
// stay in this table as decode-only specs, NOT just as unclaimed bits:
// v4 blobs already in the wild have them set with payload bytes, and a
// spec-less bit would leave those bytes unconsumed, shifting every later
// field's offset.
const FIELDS_V4: FieldSpec[] = [
  vec3FieldV3(0, 'cam', camDefault, camObservePostDecode),
  vec3FieldV3(1, 'tgt', () => DEFAULT_TGT),
  vec3FieldV3(2, 'up', () => DEFAULT_UP),
  u8Field(3,  'fov',  { min: 10, max: 120, step: 1   }),
  decodeOnly(u8Field(4, 'mag', { min: -2, max: 15, step: 0.1 })),
  u16Field(5, 'dmin'),
  u16Field(6, 'dmax'),
  u16Field(7, 'spect'),
  decodeOnly(presetField(8)),
  conField(9),
  decodeOnly(u8Field(10, 'smin', { min: 1, max: 6,  step: 0.1 })),
  decodeOnly(u8Field(11, 'smax', { min: 2, max: 32, step: 0.5 })),
  decodeOnly(u8Field(12, 'span', { min: 2, max: 20, step: 0.5 })),
  flagsField(13),
  sidRefField(14, 'focus'),
  sidRefField(15, 'to'),
  focusClearedField(18),
  poiSidsField(19),
  vec3FieldV3(20, 'worldOffset', () => DEFAULT_WORLD_OFFSET),
  tField(21),
  lgEmissionDisabledField(22),
  detailLevelField(23),
  coordSphereFrameField(24, 'equatorial'),
  u8Field(25, 'ev', { min: -EV_MAX_STOPS, max: EV_MAX_STOPS, step: EV_STEP_STOPS }),
  coordSphereFrameField(26, 'ecliptic'),
  boolBitField(27, 'orb'),
  boolBitField(28, 'orbLock'),
];

function packFlags(v: DecodedView): number {
  let f = 0;
  if (v.coordSphere !== undefined && v.coordSphere !== 'none') f |= FLAG_GRID;
  if (v.showHud) f |= FLAG_HUD;
  if (v.unit === 'pc') f |= FLAG_UNIT_PC;
  if (v.mode === 'observe') f |= FLAG_MODE_OBSERVE;
  // Chart only persists when observe is also active — chart-mode is an
  // observe-only feature, so emitting chart=on without mode=observe would
  // round-trip to a state that can't activate.
  if (v.chart && v.mode === 'observe') f |= FLAG_CHART;
  return f;
}

function unpackFlags(v: DecodedView, f: number): void {
  if (f & FLAG_GRID) v.coordSphere = 'galactic';
  if (f & FLAG_HUD) v.showHud = true;
  if (f & FLAG_UNIT_PC) v.unit = 'pc';
  if (f & FLAG_MODE_OBSERVE) v.mode = 'observe';
  if (f & FLAG_CHART) v.chart = true;
}

function computePresence(view: DecodedView): number {
  let mask = 0;
  for (const f of FIELDS_V4) {
    if (f.isPresent(view)) mask |= (1 << f.bit);
  }
  return mask;
}

// Encode a view given a pre-computed presence mask. Split out so
// writeUrl can compute the mask once for both the "should we emit
// `?v=`?" gate and the encode itself — the public encodeBlob runs
// computePresence again internally for callers that don't have a
// mask handy.
function encodeBlobWithMask(view: DecodedView, mask: number): string {
  let total = 1 + varintLen(mask); // 1 version + LEB128 presence (1–4 bytes)
  for (const f of FIELDS_V4) {
    if (mask & (1 << f.bit)) total += f.encodeBytes(view);
  }
  const ab = new ArrayBuffer(total);
  const dv = new DataView(ab);
  dv.setUint8(0, SCHEMA_VERSION);
  let off = 1 + writeVarint(dv, 1, mask);
  for (const f of FIELDS_V4) {
    if (mask & (1 << f.bit)) {
      // encode returns its own byte count, so this loop avoids a second
      // encodeBytes call (which would recompute vec3 sub-masks and the
      // POI list length).
      off += f.encode(view, dv, off);
    }
  }
  return toBase64Url(new Uint8Array(ab));
}

export function encodeBlob(view: DecodedView): string {
  return encodeBlobWithMask(view, computePresence(view));
}

/** Throws on any version but SCHEMA_VERSION. postDecode runs after the
 *  field loop because cam (bit 0) reads the mode flags (bit 13) sets. */
export function decodeBlob(blob: string): DecodedView {
  const bytes = fromBase64Url(blob);
  if (bytes.length < 1) throw new Error(`Blob too short: ${bytes.length} bytes`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint8(0);
  if (version !== SCHEMA_VERSION) throw new Error(`Unsupported view version: ${version}`);
  if (dv.byteLength < 2) throw new Error(`v4 blob too short: ${dv.byteLength} bytes`);
  const { val: mask, bytes: maskBytes } = readVarint(dv, 1, dv.byteLength);
  const view: DecodedView = {};
  let off = 1 + maskBytes;
  for (const f of FIELDS_V4) {
    if (mask & (1 << f.bit)) {
      f.decode(view, dv, off);
      off += f.decodeBytes(dv, off);
    }
  }
  for (const f of FIELDS_V4) {
    if ((mask & (1 << f.bit)) && f.postDecode) f.postDecode(view);
  }
  return view;
}

// RFC 4648 Sect. 5 base64url, no padding.
function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(blob: string): Uint8Array {
  let s = blob.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Default-equality is computed against canonical defaults so omitted fields
// keep the blob minimal.
export function currentStateOf(stellata: Stellata, idMaps: IdMaps): DecodedView {
  const f = stellata.filters.getFilter();
  const view: DecodedView = {};

  const sMin = distToSlider(f.minDistSol, true);
  const sMax = distToSlider(f.maxDistSol, false);
  if (sMin !== 0) view.dmin = sMin;
  if (sMax !== SLIDER_STEPS) view.dmax = sMax;
  if (f.detailLevel !== 'all') view.detailLevel = f.detailLevel;
  if (f.spectMask !== ALL_SPECT_MASK) view.spect = f.spectMask;
  if (f.highlightCon !== -1) view.con = f.highlightCon;
  if (f.coordSphere !== 'none') view.coordSphere = f.coordSphere;
  if (f.showHud) view.showHud = true;
  if (!f.showLgEmission) view.showLgEmission = false;

  const fov = stellata.filters.getCameraFov();
  if (!approx(fov, DEFAULT_FOV)) view.fov = fov;

  const ev = stellata.exposure.getEv();
  if (!approx(ev, 0)) view.ev = ev;

  if (getUnit() === 'pc') view.unit = 'pc';

  // One focused Target of any kind emits into the one universal `focus`
  // SID ref. Sol focus is the default, encoded by *omitting* the field —
  // so a fully-default state has no `?v=` at all. An object without a
  // SID (never on a shipped catalog) omits the field rather than
  // falling back to a build-volatile index.
  const focused = stellata.focus.getFocusedTarget();
  if (focused === null) {
    view.focus = 'cleared';
  } else if (focused.kind !== 'star' || focused.idx !== idMaps.solIndex) {
    view.focus = sidRefOf(idMaps, focused.kind, focused.idx);
  }

  const to = stellata.focus.getVectorTarget();
  if (to !== null) {
    view.to = sidRefOf(idMaps, to.kind, to.idx);
  }

  const mode = stellata.focus.getCameraMode();
  if (mode !== 'navigate') view.mode = mode;

  // Chart on/off rides FLAG_CHART, gated to observe-only at pack time.
  if (f.chart) view.chart = true;

  // A link pin still pending rides along, or a reload before its chunk
  // lands would lose it from the address bar.
  {
    const sidsOut: number[] = [];
    for (const t of stellata.pois.get()) {
      const ref = sidRefOf(idMaps, t.kind, t.idx);
      if (ref !== undefined) sidsOut.push(ref.id);
    }
    for (const sid of pendingPinSids(stellata, idMaps)) {
      if (!sidsOut.includes(sid)) sidsOut.push(sid);
    }
    if (sidsOut.length > 0) view.poiSids = sidsOut.slice(0, POI_MAX_COUNT);
  }

  const c = encodeCam;
  const t = encodeTgt;
  anchoredPose(stellata, focused, c, t);
  const u = stellata.camera.up;
  // README.md#what-counts-as-a-camera-move owns every gate below — each a
  // fraction of the orbit radius, none a distance.
  //
  // Don't collapse this to one predicate: vec3FieldV3.isPresent re-checks at
  // strict equality, and that inner layer is what keeps sub-µpc floating-origin
  // cam values any outer band would round to the frame origin.
  //
  // `worldOffset` rides the wire exactly when the receiver will NOT rebuild the
  // anchor itself — the complement of the subtraction `anchoredPose` just made,
  // which is why a soft-kind focus carries it as an unfocused view does. Only
  // a hard focus recentres the origin (`../../camera/focus/focus-target.ts`
  // KIND_TRAITS), so a cloud, an LG object or a shell leaves the sender's frame
  // reachable through this field and no other.
  const wo = stellata.floatingOrigin.worldOffset;
  const scale = orbitRadius(c, t);
  const camDefault = defaultCamForMode(mode);
  if (!isHardTarget(focused)
    && divergesFromDefault(wo, DEFAULT_WORLD_OFFSET, scale)) {
    view.worldOffset = [wo.x, wo.y, wo.z];
  }
  if (view.worldOffset || divergesFromDefault(c, camDefault, scale)) {
    view.cam = [c.x, c.y, c.z];
  }
  if (view.worldOffset || divergesFromDefault(t, DEFAULT_TGT, scale)) {
    view.tgt = [t.x, t.y, t.z];
  }
  if (Math.abs(stellata.roll.upRollError(stellata.camera, GALACTIC_NORTH_POLE_ICRS))
    > LEVEL_UP_EPS_RAD) {
    view.up = [u.x, u.y, u.z];
  }

  // ORB and its lock live on the instrument rather than in filter.coordSphere,
  // so they reach the wire through the port and nowhere else. Both are single
  // bits: the frame itself rebuilds from the focus this blob already carries.
  const orbitPort = stellata.getOrbitFramePort();
  if (orbitPort?.isArmed()) {
    view.orb = true;
    if (orbitPort.isLocked()) view.orbLock = true;
  }

  // Scrubber-pinned `t` only — when the user is on live wall-clock,
  // omit so the share link resolves to the receiver's local now (the
  // contract baked into the solar-system contract). v1 always lands in the live
  // branch; the gate flips on once the time-scrubber epic introduces pinning.
  const tNow = stellata.getT();
  if (!isLive(tNow)) view.t = tNow;

  return view;
}

function sidRefOf(idMaps: IdMaps, kind: TargetKind, localIndex: number): SidRef | undefined {
  // Planet Targets carry the PlanetBodyField flat instance index; the
  // SID planet domain is keyed by planet-within-host — translate
  // through IdMaps before the reverse lookup.
  const domainIndex = kind === 'planet'
    ? idMaps.planetDomainIndexOf(localIndex)
    : localIndex;
  if (domainIndex === null) return undefined;
  const sid = idMaps.sidResolver.sidOf(kind, domainIndex);
  return sid === null ? undefined : { kind: 'sid', id: sid };
}

/** Decode-direction sibling of `sidRefOf`: a resolver domain localIndex →
 *  Target idx. Planet sids carry a planet-within-host domain index that
 *  translates to the body-field flat instance index; every other kind's
 *  domain index IS its Target idx. Null on a planet translation miss
 *  (host body-field not attached). */
function targetIdxOf(idMaps: IdMaps, kind: TargetKind, localIndex: number): number | null {
  return kind === 'planet' ? idMaps.planetTargetIndexOf(localIndex) : localIndex;
}

// Single source of truth for "park the camera at the mode's default
// pose" — used by the worldOffset branch (after origin recentre, before
// any explicit cam/tgt overrides) and the observe-enter branch (when no
// explicit cam came on the wire). Both routed through `defaultCamForMode`
// so the cam-omission invariant lives in one place.
function setCameraToDefault(stellata: Stellata, mode: 'navigate' | 'observe' | undefined): void {
  const d = defaultCamForMode(mode);
  stellata.camera.position.set(d[0], d[1], d[2]);
}

// The one route into focus for every decoded blob — README.md, the
// applyFocusTarget bullet.
/** Re-seat the camera in a local frame that only existed once a deferred
 *  focus recentred the origin. Only the frame-relative part of the pose —
 *  everything else in the restore is absolute and already correct. */
function reapplyPose(stellata: Stellata, view: DecodedView): void {
  if (view.cam) stellata.camera.position.set(view.cam[0], view.cam[1], view.cam[2]);
  if (view.tgt) stellata.controls.target.set(view.tgt[0], view.tgt[1], view.tgt[2]);
  if (view.cam || view.tgt) stellata.controls.update();
}

function applyFocusTarget(stellata: Stellata, target: Target, snap: boolean): void {
  if (snap) stellata.focus.setOrbitTarget(target);
  else stellata.focus.flyTo(target, { animate: false });
}

/** OBSERVE's enter leg plus the chart flag it gates. The origin pre-snap
 *  precedes `controls.update()` so `lookAt` resolves the quaternion from the
 *  focal origin, not the orbit position the focus left; `setMode` preserves it
 *  when it pins position again. Exactly one of its two call sites runs it: the
 *  deferred focus callback while a focus is pending, the synchronous tail
 *  otherwise. */
function restoreObserve(stellata: Stellata, view: DecodedView): void {
  if (view.mode !== 'observe') return;
  if (!isHardTarget(stellata.focus.getFocusedTarget())) return;
  if (view.cam === undefined) {
    setCameraToDefault(stellata, 'observe');
    stellata.controls.update();
    stellata.roll.adoptFromCamera(stellata.camera);
  }
  stellata.observe.setMode('observe', { animate: false });
  if (view.chart) stellata.filters.setFilter({ chart: true });
}

// **The order here is load-bearing**:
//   - unit is applied first so any DOM sync triggered later reads it
//   - preset before filter, so derived size defaults are populated before
//     explicit overrides layer on top
//   - up before focus/orbit, since focusStar/setOrbitTarget call
//     controls.update() which reads camera.up
//   - cam/tgt overwrite whatever focusStar/setOrbitTarget computed
//   - mode last, because the observe snap reads the camera quaternion
//     just set by controls.update(position, target, up)
export function applyDecodedView(
  stellata: Stellata,
  view: DecodedView,
  idMaps: IdMaps,
): Promise<void> | null {
  if (view.unit) setUnit(view.unit);

  // Declutter level — applied before the filter patch below; drives
  // SceneDeclutter's pushes (default 'all' omitted, so this only fires for
  // a decluttered share). Runs after layers are constructed (applyFromUrl
  // runs post-construction), so lazily-attached layers pick up the
  // permitted set via their per-frame permit read.
  if (view.detailLevel) stellata.filters.applyDetailPreset(view.detailLevel);

  const patch: Partial<FilterState> = {};
  if (view.dmin !== undefined || view.dmax !== undefined) {
    patch.minDistSol = sliderToDist(view.dmin ?? 0, true);
    patch.maxDistSol = sliderToDist(view.dmax ?? SLIDER_STEPS, false);
  }
  if (view.spect !== undefined) patch.spectMask = view.spect;
  if (view.con !== undefined) patch.highlightCon = view.con;
  if (view.coordSphere !== undefined) patch.coordSphere = view.coordSphere;
  if (view.showHud !== undefined) patch.showHud = view.showHud;
  if (view.showLgEmission !== undefined) patch.showLgEmission = view.showLgEmission;
  if (Object.keys(patch).length) stellata.filters.setFilter(patch);

  if (view.fov !== undefined && view.fov > 0) stellata.setCameraFov(view.fov);
  if (view.ev !== undefined) stellata.exposure.setEv(view.ev);

  // Pinned `t` — only present when the sender's `t` was scrubbed away
  // from live (the encoder gates emission on isLive). Apply before any
  // ephemeris-driven reads downstream.
  if (view.t !== undefined) stellata.setT(view.t);

  // Single dirty flag for everything that requires controls.update() at
  // the end of the camera-touching block. Each branch below that mutates
  // camera.position / controls.target / camera.up sets this so the final
  // update() reads as "if any of those happened, refresh" — replaces
  // a hand-maintained N-way OR that grew with every new branch.
  let controlsDirty = false;
  // Non-null once a focus sid has queued as a deferred intent — README.md#a-focus-that-resolves-after-the-pose.
  let focusPending: Promise<void> | null = null;

  // An omitted `up` is a positive statement — the sender was galactic-LEVEL
  // — so the receiver restores the pole itself and lets the `lookAt` below
  // project it. Leaving `camera.up` alone instead restores the roll of
  // whatever pose this session last held: at boot that is the pole projected
  // into the DEFAULT view axis, which renders level from that vantage and no
  // other. A level share from +X came back rolled 66 degrees.
  const up = view.up ?? DEFAULT_UP;
  stellata.roll.restore(stellata.camera, up[0], up[1], up[2]);
  controlsDirty = true;

  const hasCam = view.cam !== undefined;
  const hasTgt = view.tgt !== undefined;
  const snap = hasCam || hasTgt;

  // A Sol focus rides the wire as an ABSENT field, and a hard focus is also
  // what elides `worldOffset` — so a blob carrying neither states the default
  // frame and leaves the receiver owing the rebuild. Inheriting instead is
  // invisible at boot, where the session is already on Sol, and wrong for
  // every blob applied to a running session: `cam` / `tgt` below would be
  // written as coordinates of a frame this session never established.
  const assertsDefaultFrame = view.focus === undefined && view.worldOffset === undefined;
  if (assertsDefaultFrame && idMaps.solIndex >= 0) {
    applyFocusTarget(stellata, { kind: 'star', idx: idMaps.solIndex }, snap);
  }

  if (view.focus !== undefined) {
    if (view.focus === 'cleared') {
      // URL restore — bypass the close-zoom unfocus animation.
      // cam/tgt below would overwrite camera.position mid-lerp, leaving
      // the transition state to silently drag the camera away from the
      // restored pose on the next frame.
      stellata.focus.unfocus({ animate: false });
    } else {
      // Deferred-resolution contract (/docs/sid.md#8-runtime-resolver-b4):
      // a sid whose domain hasn't attached yet applies on that
      // attach; a sid no attached domain claims expires silently and
      // the rest of the decoded state stands. Planet sids translate
      // domain index → flat Target index; a translation miss (host
      // body-field not attached) drops the focus like an unknown sid.
      // Flips once `whenResolved` has returned, so the callback can tell
      // which side of the synchronous window it ran on.
      let deferred = false;
      let resolvedInline = false;
      let settle: (() => void) | undefined;
      idMaps.sidResolver.whenResolved(view.focus.id, (kind, localIndex) => {
        if (!deferred) resolvedInline = true;
        const idx = targetIdxOf(idMaps, kind, localIndex);
        if (idx !== null) {
          applyFocusTarget(stellata, { kind, idx }, snap);
          // README.md#a-focus-that-resolves-after-the-pose both halves:
          // why a late focus has to re-seat, and why user input vetoes it.
          // The mode rides the same veto: entering observe parks the camera,
          // which is the move the veto exists to abandon.
          if (deferred && !stellata.renderGate.sawUserInput) {
            reapplyPose(stellata, view);
            restoreObserve(stellata, view);
          }
          // Last: a sid whose domain attaches after this function returns fires
          // its 'focus' event then, and the mode change above disarms ORB too.
          restoreOrbitFrame(stellata, view);
        }
        settle?.();
      });
      deferred = true;
      if (!resolvedInline) {
        focusPending = new Promise<void>((resolve) => { settle = resolve; });
      }
    }
  }
  if (view.to) {
    idMaps.sidResolver.whenResolved(view.to.id, (kind, localIndex) => {
      const idx = targetIdxOf(idMaps, kind, localIndex);
      if (idx === null) return;
      stellata.focus.setVector({ kind, idx });
    });
  }

  // Apply worldOffset *before* cam/tgt so the local frame is established
  // first. With focus, focusStar above already recentred the origin to
  // the focal object, and the encoder elides worldOffset in that case —
  // but apply it anyway when present (no-op when redundant). Without
  // focus, worldOffset carries the close-orbit unfocus origin
 // so cam/tgt can be tiny local-frame values that round-
  // trip cleanly through float32. The recentre also shifts camera
  // and target alongside the origin to preserve the user-visible
  // pose; for URL load we explicitly reset them to defaults here so
  // an absent view.cam / view.tgt produces the conventional default
  // pose in the *new* local frame rather than the recentre-shifted
  // junk position. view.cam / view.tgt below override when present.
  if (view.worldOffset) {
    stellata.floatingOrigin.recenterTo(new THREE.Vector3(...view.worldOffset));
    setCameraToDefault(stellata, view.mode);
    stellata.controls.target.set(DEFAULT_TGT[0], DEFAULT_TGT[1], DEFAULT_TGT[2]);
    controlsDirty = true;
  }

  if (view.cam) {
    stellata.camera.position.set(view.cam[0], view.cam[1], view.cam[2]);
    controlsDirty = true;
  }
  if (view.tgt) {
    stellata.controls.target.set(view.tgt[0], view.tgt[1], view.tgt[2]);
    controlsDirty = true;
  }
  if (controlsDirty) {
    stellata.controls.update();
    // The restored `up` arrived as an axis, ahead of the position and target
    // it has to be perpendicular to. The lookAt inside update() has now
    // resolved the roll from it; this puts up itself back on the
    // perpendicular invariant (/src/client/camera/controls/input/README.md#roll-authority)
    // without changing what is on screen.
    stellata.roll.adoptFromCamera(stellata.camera);
  }

  // Pending focus → the deferred callback owns this leg instead.
  if (focusPending === null) restoreObserve(stellata, view);

  if (Array.isArray(view.poiSids)) restorePins(stellata, view.poiSids, idMaps);
  else linkPins.delete(stellata);

  // LAST, and that is the whole of this field's difficulty. Every one of the
  // three clearing rules above disarms ORB on its way past — the instrument
  // drops it on a focus change, on a coordSphere change, and with the camera
  // mode — so a restore anywhere earlier is silently undone by a later step of
  // this same function. Applied again from the deferred focus callback for the
  // one case that lands after this returns; `restore` is idempotent.
  restoreOrbitFrame(stellata, view);

  return focusPending;
}

/** A link's pins, one slot per sid in the link's order. */
interface LinkPins {
  sids: readonly number[];
  slots: (Target | null)[];
  /** What this restore last wrote to the pin list. */
  written: readonly Target[];
}

// Keyed by shell, since the restore and the encoder are called apart.
const linkPins = new WeakMap<Stellata, LinkPins>();

function landedPins(pins: LinkPins): Target[] {
  return pins.slots.filter((t): t is Target => t !== null);
}

/** see README.md#a-pin-that-resolves-after-the-link */
function restorePins(stellata: Stellata, sids: readonly number[], idMaps: IdMaps): void {
  const pins: LinkPins = { sids, slots: sids.map(() => null), written: [] };
  linkPins.set(stellata, pins);
  let inline = true;
  sids.forEach((sid, i) => {
    idMaps.sidResolver.whenResolved(sid, (kind, localIndex) => {
      const idx = targetIdxOf(idMaps, kind, localIndex);
      if (idx === null) return;
      const target = { kind, idx };
      pins.slots[i] = target;
      if (inline || linkPins.get(stellata) !== pins) return;
      const live = stellata.pois.get();
      const next = targetListsEqual(live, pins.written) ? landedPins(pins) : [...live, target];
      stellata.pois.set(next);
      pins.written = stellata.pois.get().slice();
    });
  });
  inline = false;
  const landed = landedPins(pins);
  if (landed.length > 0) stellata.pois.set(landed);
  pins.written = stellata.pois.get().slice();
}

/** Link pin sids the resolver still holds pending. */
function pendingPinSids(stellata: Stellata, idMaps: IdMaps): number[] {
  const pins = linkPins.get(stellata);
  if (!pins) return [];
  return pins.sids.filter((sid, i) =>
    pins.slots[i] === null && idMaps.sidResolver.resolve(sid).status === 'pending');
}

/** Absent bits mean the gesture was never made, which is a positive
 *  statement — a sky-frame link has to disarm an ORB the session was already
 *  holding, not leave it standing. */
function restoreOrbitFrame(stellata: Stellata, view: DecodedView): void {
  stellata.getOrbitFramePort()?.restore(view.orb === true, view.orbLock === true);
}

// README.md#transport--canonical-path-vs-legacy-query — the fragment is not URL state, and a bare-path
// replaceState would drop it.
function replacePathKeepHash(path: string): void {
  history.replaceState(null, '', path + location.hash);
}

function writeUrl(stellata: Stellata, idMaps: IdMaps): void {
  const view = currentStateOf(stellata, idMaps);
  // Single computePresence pass — the mask gates the path segment itself
  // and is also passed to encodeBlobWithMask so the encoder doesn't
  // re-walk FIELDS_V4.
  const mask = computePresence(view);
  const path = mask === 0 ? '/' : buildSharePath(encodeBlobWithMask(view, mask));
  if (path !== location.pathname + location.search) {
    replacePathKeepHash(path);
  }
}

// Nothing decodable in the URL (bogus path, stray query, or a `/v/<blob>/`
// whose blob won't decode) → strip the address bar back to bare `/`. The
// SPA not_found_handling already served index.html for any path; this is
// the client half that keeps the bar off junk the user can't act on,
// rather than leaving the unmatched path sitting there.
function resetJunkUrl(): void {
  if (location.pathname !== '/' || location.search !== '') {
    replacePathKeepHash('/');
  }
}

export interface AppliedUrl {
  /** False sends the caller to the first-load view, including for a blob
   *  that will not decode. */
  applied: boolean;
  /** README.md#a-focus-that-resolves-after-the-pose. */
  focusPending: Promise<void> | null;
}

export function applyFromUrl(stellata: Stellata, idMaps: IdMaps): AppliedUrl {
  const { blob, legacyQueryForm } = pickShareBlob(location.pathname, location.search);
  if (!blob) {
    resetJunkUrl();
    return { applied: false, focusPending: null };
  }
  let decoded: DecodedView;
  try {
    decoded = decodeBlob(blob);
  } catch (err) {
    console.warn('Failed to decode URL state:', err);
    resetJunkUrl();
    return { applied: false, focusPending: null };
  }
  const focusPending = applyDecodedView(stellata, decoded, idMaps);
  // Deferred past the state events the apply itself fires, which would
  // otherwise schedule their own write on top.
  if (legacyQueryForm) {
    setTimeout(() => writeUrl(stellata, idMaps), DEBOUNCE_MS);
  }
  return { applied: true, focusPending };
}

// Write the live camera/target/up triple into `out` at the canonical
// layout the per-frame change detector reads from:
//   [0..2] camera.position, [3..5] controls.target, [6..8] reference up
// Single source of truth for that layout so seed and per-frame update
// can't drift apart on index.
const anchorScratch = new THREE.Vector3();
const frameCam = new THREE.Vector3();
const frameTgt = new THREE.Vector3();
const encodeCam = new THREE.Vector3();
const encodeTgt = new THREE.Vector3();

/**
 * cam and tgt as the wire means them: relative to the anchor the RECEIVER
 * re-establishes, which for a hard focus is the focal object itself
 * (`applyDecodedView` recentres onto it before either lands).
 *
 * The sender's own origin recentres only once the camera has drifted 16× the
 * eye distance (`../../camera/focus/focal-ride/focal-ride-pure.ts`), and between two of
 * those the moving-focal ride translates camera and target together every
 * frame. Raw local values therefore drift out of any frame the receiver
 * rebuilds — up to 16 eye distances of pose error — while carrying motion the
 * viewer cannot see, which on a scale-relative change detector is unbounded
 * URL churn. Subtracting the anchor removes both at once.
 *
 * Both writers read this, so the change detector and the encoder cannot
 * disagree about what has moved. A pose left un-anchored — no focus, a
 * soft-kind one, or a source that will not resolve — is one the receiver
 * rebuilds from `worldOffset` instead, which `currentStateOf` emits on
 * exactly the complement of this test.
 */
function anchoredPose(
  stellata: Stellata,
  focused: Target | null,
  outCam: THREE.Vector3,
  outTgt: THREE.Vector3,
): void {
  outCam.copy(stellata.camera.position);
  outTgt.copy(stellata.controls.target);
  if (!isHardTarget(focused)) return;
  if (!stellata.focusables[focused.kind].localPositionInto(focused.idx, anchorScratch)) return;
  outCam.sub(anchorScratch);
  outTgt.sub(anchorScratch);
}

function snapshotCam(out: Float64Array, c: Vec3Like, t: Vec3Like, u: Vec3Like): void {
  out[0] = c.x; out[1] = c.y; out[2] = c.z;
  out[3] = t.x; out[4] = t.y; out[5] = t.z;
  out[6] = u.x; out[7] = u.y; out[8] = u.z;
}

// Effective persisted `t` for the per-frame change detector. Mirrors
// currentStateOf's encode gate (`!isLive` ⇒ emit t) exactly, so the
// detector schedules a write precisely when the blob's t would change:
// null = live (t omitted from the blob and tracks the receiver's clock),
// otherwise the pinned value. A live clock advances every frame but must
// NOT trigger writes — the scrubber drives getT() directly without any
// 'state' event, so t is invisible to the detector otherwise.
function persistedT(stellata: Stellata): number | null {
  const t = stellata.getT();
  return isLive(t) ? null : t;
}

export function startUrlSync(stellata: Stellata, idMaps: IdMaps): void {
  let timer: number | undefined;
  // Per-frame camera/target/up + pinned-t change detector. Seeded from
  // the live state at registration time so the first frame doesn't
  // trigger a write — the URL stays empty (or in sync with whatever
  // applyFromUrl/applyFirstLoadView just applied) until the user
  // actually moves the camera, scrubs time, or changes a setting.
  const lastCam = new Float64Array(9);
  anchoredPose(stellata, stellata.focus.getFocusedTarget(), frameCam, frameTgt);
  snapshotCam(lastCam, frameCam, frameTgt, stellata.camera.up);
  let lastT = persistedT(stellata);

  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(() => writeUrl(stellata, idMaps), DEBOUNCE_MS);
  };

  stellata.on('state', schedule);
  onUnitChange(schedule);

  stellata.on('frame', () => {
    // Skip URL writes while any camera-position lerp is in flight
    // (warp, observe enter/exit, or navigate-mode unfocus zoom-out) —
    // the camera mutates every frame and we don't want intermediate
    // poses in the URL. End-of-animation events flush the final pose.
    if (stellata.isCameraTransitionActive()) return;
    let changed = false;

    // Scrubbed time: the scrubber mutates getT() without a 'state' event,
    // so watch it here. During live playback t evolves every frame and
    // schedule() coalesces via the debounce — one write once the clock
    // settles.
    const t = persistedT(stellata);
    if (t !== lastT) {
      lastT = t;
      changed = true;
    }

    anchoredPose(stellata, stellata.focus.getFocusedTarget(), frameCam, frameTgt);
    const u = stellata.camera.up;
    // Steady-state path: one scale-free comparison against the snapshot
    // (`pose-change-pure.ts`). No allocations on the no-change path — this
    // used to be 10+ string allocations per frame from a toFixed(3)×9 hash.
    if (poseChanged(lastCam, frameCam, frameTgt, u)) {
      snapshotCam(lastCam, frameCam, frameTgt, u);
      changed = true;
    }

    if (changed) schedule();
  });
}

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < SCALAR_EPS;
}
