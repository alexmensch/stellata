import type { Stellata } from '../../stellata';
import {
  type FilterState,
  DEFAULT_FOV,
  ALL_SPECT_MASK,
} from '../../filters/filter-state';
import { EV_MAX_STOPS, EV_STEP_STOPS } from '../../hdr/exposure/exposure-epoch';

/** The retired v1–v3 magnitude presets. Frozen decoders still emit these
 *  names; nothing downstream acts on them. */
type LegacyPresetName = 'naked-eye' | 'binoculars' | 'all';
import { type DetailLevel, DETAIL_LEVELS, DETAIL_RANK } from '../../scene/scene-elements';
import { POI_MAX_COUNT } from '../../poi/poi-store';
import { sliderToDist, distToSlider, SLIDER_STEPS } from '../../camera/controls/controls';
import { setUnit, getUnit, onUnitChange } from '../../ui/distance-util';
import { isLive } from '../../solar-system/time/time';
import type { SidResolver } from '../sid-resolver';
import { isHardTarget, type Target, type TargetKind } from '../../camera/focus/focus-target';
import { buildSharePath, pickShareBlob } from './share-path-pure';
import { GALACTIC_NORTH_POLE_ICRS } from '../../galactic/galactic-coords';
import type { CoordSphereFrame } from '../../galactic/coord-spheres/coord-sphere';

// URL state is a single opaque base64url blob carried in a `/v/<blob>/`
// path segment (canonical) or a legacy `?v=<blob>` query param (still
// decoded forever — old shared links are baked into YouTube comments).
// Four wire formats coexist (v1–v4); on load, legacy query-form links
// and superseded schema versions both rewrite to the canonical path per
// the migration table in docs/sid.md § 9.4. See
// src/client/util/url-state/README.md for the wire format and the
// "adding a field" recipe.
//
// Buffer order (FIELDS bit-index order) is independent of the dispatch
// order in applyDecodedView. Both are load-bearing — see the inline
// comments at each apply step.

// Trailing-debounce window for address-bar writes. 1s keeps the URL calm
// during continuous scrub/drag (writes fire once state settles, not
// mid-motion) and stays clear of browsers' history.replaceState rate
// limits. Shared with applyFromUrl's one-shot legacy-upgrade rewrite.
const DEBOUNCE_MS = 1000;
const SCHEMA_VERSION_V1 = 1;
const SCHEMA_VERSION_V2 = 2;
const SCHEMA_VERSION_V3 = 3;
const SCHEMA_VERSION = 4;
const EPS = 1e-3;
// Per-frame URL-write change detector: 1% of vector magnitude, capped
// at EPS (1e-3 pc) and floored at EPS_FLOOR (well below float32 ULP at
// any reasonable scene scale). The cap preserves the original absolute
// behaviour at scene scale (>= 0.1 pc, where float32 noise can approach
// 5e-4 pc); the relative floor handles solar-system scales where the
// fixed 1e-3 pc threshold equals ~206 AU and a zoom-out from the
// first-load 5 AU park wouldn't trip any axis until far past where
// the user expects the URL to update.
const EPS_REL = 0.01;
const EPS_FLOOR = 1e-9;

// Per-component change-detector threshold for `startUrlSync`. Exported
// for unit-level coverage of the scene-scale clamp / AU-scale floor.
export function frameTriggerEps(magnitude: number): number {
  return Math.max(EPS_FLOOR, Math.min(EPS, magnitude * EPS_REL));
}

// Default values that the encoder uses to decide whether to omit a field.
const DEFAULT_CAM: [number, number, number] = [0, 0, 30];
const DEFAULT_TGT: [number, number, number] = [0, 0, 0];
// The `up` slot carries the camera's REFERENCE axis (camera/controls/input/README.md
// § Reference up axis), whose canonical value is galactic north — so a share
// from a level camera omits the field entirely.
const DEFAULT_UP: [number, number, number] = [
  GALACTIC_NORTH_POLE_ICRS.x, GALACTIC_NORTH_POLE_ICRS.y, GALACTIC_NORTH_POLE_ICRS.z,
];
// v3's frozen default. A v3 blob was written when world +Y was the reference,
// so its elided components have to fill from that value or the decode isn't
// the one v3 meant — the axis then applies as a reference and reproduces the
// roll the link always had, since either value only ever reached the camera
// through a `lookAt` projection.
const DEFAULT_UP_V3: [number, number, number] = [0, 1, 0];
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

// Focus-tag-bit semantics: high bit set = HIP-resolved ID, clear = raw
// row index. The 0xFFFFFFFF sentinel is reserved (won't naturally appear
// since "explicitly unfocused" uses a separate presence bit, not a magic
// id value).
const FOCUS_HIP_TAG = 0x80000000;
const FOCUS_ID_MASK = 0x7fffffff;
// v2 packs the same tag + id space into 3 bytes: 1 tag bit + 23-bit id
// (covers row indices ≤ 313k and HIP ≤ ~120k with headroom).
const FOCUS_HIP_TAG_V2 = 0x800000;
const FOCUS_ID_MASK_V2 = 0x7fffff;

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
// coordSphereEquatorialField.
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
  /** HIP → row-index lookup. Built once at boot from `catalog.hip`. */
  hipToIndex: Map<number, number>;
  /** Row → HIP lookup; `indexToHip[i] === 0` when the star has no HIP. */
  indexToHip: Uint32Array;
  /** Total row count for bounds checks. */
  starCount: number;
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

/** Legacy v1–v3 star ref — decode-only since v4. */
export type StarRef = { kind: 'hip' | 'index'; id: number };
/** v4 universal object ref: a frozen Stellata ID of any kind (star,
 *  cloud, planet, …) — the runtime resolver supplies the kind. */
export type SidRef = { kind: 'sid'; id: number };
export type ObjectRef = StarRef | SidRef;

export interface DecodedView {
  cam?: [number, number, number];
  tgt?: [number, number, number];
  up?: [number, number, number];
  fov?: number;
  /** Legacy blobs only (v1–v3, and v4 shared before the field retired):
   *  the app-magnitude filter. Decode-and-ignore, same as `preset`. */
  mag?: number;
  /** Manual EV trim, in stops. Default 0, omitted when default. */
  ev?: number;
  dmin?: number;
  dmax?: number;
  spect?: number;
  /** Legacy blobs only: the retired magnitude preset. Decoded so old
   *  links still load, then ignored — the instrument owns the limit. */
  preset?: LegacyPresetName;
  /** Declutter detail level. Default 'all' (fully cluttered) — encoded
   *  only when the user cycled below it. */
  detailLevel?: DetailLevel;
  con?: number;
  /** Legacy blobs only: the retired star-size / footprint-window sliders.
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
   *  unfocused. v4 encodes a SidRef (any kind — a cloud focus is just a
   *  cloud-kind SID); hip/index StarRefs are legacy decode output. */
  focus?: 'cleared' | ObjectRef;
  /** Vector-to object (the chevron measurement line). Same ref
   *  semantics as `focus`. */
  to?: ObjectRef;
  /** Legacy v1–v3 cloud focus index — decode-only; v4 folds cloud
   *  focus into `focus` as a cloud-kind SID. */
  cloud?: number;
  /** Legacy v1–v3 vector-to-cloud index — decode-only, folded into
   *  `to` in v4. */
  toc?: number;
  /** Chart mode (observe-only). Only encoded when `mode === 'observe'`. */
  chart?: boolean;
  /** Legacy v1–v3 pinned points-of-interest as HIP IDs — decode-only;
   *  v4 persists POIs in `poiSids`. */
  pois?: number[];
  /** Pinned points-of-interest as SIDs (v4), any camera mode. SIDs
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
   *  fixed-size and ignore the argument. The `pois` field reads it to
   *  size the variable-length payload. */
  encodeBytes(v: DecodedView): number;
  /** Bytes the field consumes when decoding from `dv` starting at `off`.
   *  Same shape as encodeBytes — fixed-size fields ignore arguments;
   *  variable-length fields read a length-prefix byte. */
  decodeBytes(dv: DataView, off: number): number;
  isPresent(v: DecodedView): boolean;
  /** Encode the field at `off`. Returns the number of bytes written so
   *  the caller can advance `off` without a second `encodeBytes` call —
   *  matters for vec3FieldV3 / pois where the byte count requires
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

function vec3Field(bit: number, key: Vec3Key): FieldSpec {
  return {
    bit, key, ...fixed(12),
    isPresent: v => v[key] !== undefined,
    encode: (v, dv, o) => {
      const t = v[key]!;
      dv.setFloat32(o + 0, t[0], true);
      dv.setFloat32(o + 4, t[1], true);
      dv.setFloat32(o + 8, t[2], true);
      return 12;
    },
    decode: (v, dv, o) => {
      v[key] = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)];
    },
  };
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

function f32Field(bit: number, key: 'fov' | 'mag' | 'smin' | 'smax' | 'span'): FieldSpec {
  return {
    bit, key, ...fixed(4),
    isPresent: v => v[key] !== undefined,
    encode: (v, dv, o) => { dv.setFloat32(o, v[key]!, true); return 4; },
    decode: (v, dv, o) => { v[key] = dv.getFloat32(o, true); },
  };
}

function u16Field(bit: number, key: 'dmin' | 'dmax' | 'spect' | 'cloud' | 'toc'): FieldSpec {
  return {
    bit, key, ...fixed(2),
    isPresent: v => v[key] !== undefined,
    encode: (v, dv, o) => { dv.setUint16(o, v[key]!, true); return 2; },
    decode: (v, dv, o) => { v[key] = dv.getUint16(o, true); },
  };
}

function starRefField(bit: number, key: 'focus' | 'to'): FieldSpec {
  return {
    bit, key, ...fixed(4),
    isPresent: v => typeof v[key] === 'object' && v[key] !== null,
    encode: (v, dv, o) => {
      const ref = v[key] as StarRef;
      const tagged = ref.kind === 'hip' ? (ref.id | FOCUS_HIP_TAG) : (ref.id & FOCUS_ID_MASK);
      dv.setUint32(o, tagged >>> 0, true);
      return 4;
    },
    decode: (v, dv, o) => {
      const raw = dv.getUint32(o, true);
      v[key] = (raw & FOCUS_HIP_TAG)
        ? { kind: 'hip', id: raw & FOCUS_ID_MASK }
        : { kind: 'index', id: raw & FOCUS_ID_MASK };
    },
  };
}

// 24-bit little-endian helpers for the v2 presence mask, 3-byte star
// refs, and 3-byte POI HIP entries. DataView has no native u24, so we
// compose from three byte ops.
function readU24LE(dv: DataView, off: number): number {
  return dv.getUint8(off) | (dv.getUint8(off + 1) << 8) | (dv.getUint8(off + 2) << 16);
}
function writeU24LE(dv: DataView, off: number, val: number): void {
  dv.setUint8(off,     val         & 0xff);
  dv.setUint8(off + 1, (val >>> 8)  & 0xff);
  dv.setUint8(off + 2, (val >>> 16) & 0xff);
}

// LEB128: 7-bit payload + continuation bit per byte, low-group-first.
// v3 uses this for the outer presence mask, replacing v2's fixed
// 3-byte u24. bit 21 (t) is the only field that costs an extra byte
// vs u24, and it doesn't emit yet.
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

// Quantised uint8 field — replaces f32Field for fov/mag/smin/smax/span
// in v2. The quant grid matches each slider's native (min, max, step) so
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

// 3-byte star ref — same tag-bit + id semantics as v1 but in 24 bits.
function starRefFieldU24(bit: number, key: 'focus' | 'to'): FieldSpec {
  return {
    bit, key, ...fixed(3),
    isPresent: v => typeof v[key] === 'object' && v[key] !== null,
    encode: (v, dv, o) => {
      const ref = v[key] as StarRef;
      const tagged = ref.kind === 'hip'
        ? ((ref.id & FOCUS_ID_MASK_V2) | FOCUS_HIP_TAG_V2)
        : (ref.id & FOCUS_ID_MASK_V2);
      writeU24LE(dv, o, tagged >>> 0);
      return 3;
    },
    decode: (v, dv, o) => {
      const raw = readU24LE(dv, o);
      v[key] = (raw & FOCUS_HIP_TAG_V2)
        ? { kind: 'hip', id: raw & FOCUS_ID_MASK_V2 }
        : { kind: 'index', id: raw & FOCUS_ID_MASK_V2 };
    },
  };
}

// 1-byte cloud index — the cloud catalog has < 256 entries.
function u8CloudField(bit: number, key: 'cloud' | 'toc'): FieldSpec {
  return {
    bit, key, ...fixed(1),
    isPresent: v => v[key] !== undefined,
    encode: (v, dv, o) => { dv.setUint8(o, v[key]! & 0xff); return 1; },
    decode: (v, dv, o) => { v[key] = dv.getUint8(o); },
  };
}

// Shared leaf codecs for the bit slots whose byte shape never changed
// across schema versions. Each is a stable, parameterised spec factory
// — per-version FIELDS arrays below compose them; the golden-blob
// corpus in url-state.test.ts pins the resulting byte behaviour.

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

// Which coordinate sphere FLAG_GRID means — another zero-byte presence bit,
// since the flags byte is full. Set = equatorial, clear = galactic.
//
// Layering it over FLAG_GRID rather than replacing that bit with a 1-byte enum
// is what keeps both directions of compatibility free: a pre-equatorial link
// (FLAG_GRID alone) still decodes to the galactic sphere, and a stale client
// reading a new link ignores the unknown high mask bit and shows the galactic
// sphere instead of none. Decodes after flagsField (bit 13 < 24), so it
// overwrites the 'galactic' that unpackFlags wrote.
function coordSphereEquatorialField(bit: number): FieldSpec {
  return {
    bit, key: 'coordSphereEquatorial', ...fixed(0),
    isPresent: v => v.coordSphere === 'equatorial',
    encode: () => 0,
    decode: v => { v.coordSphere = 'equatorial'; },
  };
}

// Variable-length POI-HIP list: 1-byte count + count × fixed-width HIP
// IDs (4 bytes in v1, 3 in v2/v3 — HIP space is < 2^17 so 24 bits is
// plenty). Hard-capped at POI_MAX_COUNT both at encode time (defensive
// cap on `currentStateOf` emission) and at decode time (defensive cap
// on hand-edited URLs).
function poisHipField(bit: number, bytesPerId: 3 | 4): FieldSpec {
  return {
    bit, key: 'pois',
    encodeBytes: v => 1 + bytesPerId * Math.min(v.pois?.length ?? 0, POI_MAX_COUNT),
    decodeBytes: (dv, off) => 1 + bytesPerId * Math.min(dv.getUint8(off), POI_MAX_COUNT),
    isPresent: v => Array.isArray(v.pois) && v.pois.length > 0,
    encode: (v, dv, o) => {
      const list = (v.pois ?? []).slice(0, POI_MAX_COUNT);
      dv.setUint8(o, list.length);
      for (let i = 0; i < list.length; i++) {
        if (bytesPerId === 4) dv.setUint32(o + 1 + i * 4, list[i] >>> 0, true);
        else writeU24LE(dv, o + 1 + i * 3, list[i] >>> 0);
      }
      return 1 + bytesPerId * list.length;
    },
    decode: (v, dv, o) => {
      const n = Math.min(dv.getUint8(o), POI_MAX_COUNT);
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        out.push(bytesPerId === 4 ? dv.getUint32(o + 1 + i * 4, true) : readU24LE(dv, o + 1 + i * 3));
      }
      v.pois = out;
    },
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

// v4 universal object ref — an unsigned LEB128 SID (docs/sid.md § 9.1).
// No type tag on the wire; kind comes from the runtime resolver at
// apply time. isPresent claims the bit only for sid-kind refs, so a
// legacy hip/index ref that somehow survives into an encode is dropped
// rather than mis-encoded.
function sidRefField(bit: number, key: 'focus' | 'to'): FieldSpec {
  const sidOf = (v: DecodedView): number | null => {
    const ref = v[key];
    return typeof ref === 'object' && ref !== null && ref.kind === 'sid' ? ref.id : null;
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

// v4 POI list: 1-byte count + one LEB128 SID per entry. Same
// POI_MAX_COUNT cap discipline as the legacy HIP list.
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
// in observe mode when the sub-mask leaves z unset. Shared by every
// schema version that uses the sub-mask vec3 (v3 onward).
const camDefault: ComponentDefaults = v => defaultCamForMode(v.mode);
const camObservePostDecode: ApplyMode = (v, sub) => {
  if (v.cam && v.mode === 'observe' && !(sub & 4)) v.cam[2] = 0;
};

// ── FROZEN legacy schemas ────────────────────────────────────────────
// Deployed v1/v2/v3 blobs depend on these exact per-bit byte shapes
// forever. Each version's array is standalone — deliberately NOT
// derived from a shared builder, so a wire change for the live schema
// physically cannot alter a legacy decoder. Never edit an entry here;
// schema changes land in the live FIELDS_V<current> table only, with a
// SCHEMA_VERSION bump. The golden-blob corpus in url-state.test.ts
// pins each frozen decoder byte-for-byte.

// v1: 32-bit mask, flat 12-byte vec3s, float32 scalars, 4-byte tag-bit
// star refs, u16 cloud refs, 4-byte POI HIPs. No worldOffset / t.
const FIELDS_V1: FieldSpec[] = [
  vec3Field(0, 'cam'),
  vec3Field(1, 'tgt'),
  vec3Field(2, 'up'),
  f32Field(3, 'fov'),
  f32Field(4, 'mag'),
  u16Field(5, 'dmin'),
  u16Field(6, 'dmax'),
  u16Field(7, 'spect'),
  presetField(8),
  conField(9),
  f32Field(10, 'smin'),
  f32Field(11, 'smax'),
  f32Field(12, 'span'),
  flagsField(13),
  starRefField(14, 'focus'),
  starRefField(15, 'to'),
  u16Field(16, 'cloud'),
  u16Field(17, 'toc'),
  focusClearedField(18),
  poisHipField(19, 4),
];

// v2: 24-bit mask, flat 12-byte vec3s, quantised u8 scalars, 3-byte
// tag-bit star refs, u8 cloud refs, 3-byte POI HIPs, worldOffset + t.
const FIELDS_V2: FieldSpec[] = [
  vec3Field(0, 'cam'),
  vec3Field(1, 'tgt'),
  vec3Field(2, 'up'),
  u8Field(3,  'fov',  { min: 10, max: 120, step: 1   }),
  u8Field(4,  'mag',  { min: -2, max: 15,  step: 0.1 }),
  u16Field(5, 'dmin'),
  u16Field(6, 'dmax'),
  u16Field(7, 'spect'),
  presetField(8),
  conField(9),
  u8Field(10, 'smin', { min: 1, max: 6,  step: 0.1 }),
  u8Field(11, 'smax', { min: 2, max: 32, step: 0.5 }),
  u8Field(12, 'span', { min: 2, max: 20, step: 0.5 }),
  flagsField(13),
  starRefFieldU24(14, 'focus'),
  starRefFieldU24(15, 'to'),
  u8CloudField(16, 'cloud'),
  u8CloudField(17, 'toc'),
  focusClearedField(18),
  poisHipField(19, 3),
  vec3Field(20, 'worldOffset'),
  tField(21),
];

// v3: LEB128 mask + per-component sub-mask vec3s; everything else as
// v2. A typical near-Sol pose (cam=[0,0,3.7]) drops from v2's 12-byte
// cam to 5 bytes (1 sub-mask + 4 z-component).
const FIELDS_V3: FieldSpec[] = [
  vec3FieldV3(0, 'cam', camDefault, camObservePostDecode),
  vec3FieldV3(1, 'tgt', () => DEFAULT_TGT),
  vec3FieldV3(2, 'up', () => DEFAULT_UP_V3),
  u8Field(3,  'fov',  { min: 10, max: 120, step: 1   }),
  u8Field(4,  'mag',  { min: -2, max: 15,  step: 0.1 }),
  u16Field(5, 'dmin'),
  u16Field(6, 'dmax'),
  u16Field(7, 'spect'),
  presetField(8),
  conField(9),
  u8Field(10, 'smin', { min: 1, max: 6,  step: 0.1 }),
  u8Field(11, 'smax', { min: 2, max: 32, step: 0.5 }),
  u8Field(12, 'span', { min: 2, max: 20, step: 0.5 }),
  flagsField(13),
  starRefFieldU24(14, 'focus'),
  starRefFieldU24(15, 'to'),
  u8CloudField(16, 'cloud'),
  u8CloudField(17, 'toc'),
  focusClearedField(18),
  poisHipField(19, 3),
  // Floating-origin anchor. Appended at the *end* (rather than slotted
  // in by bit number) so a stale client reading a newer URL just stops
  // short of these trailing bytes — every preceding field decodes at
  // its expected offset and the missing worldOffset gracefully degrades
  // to "Sol-anchored". Future additions follow the same append-only
  // pattern.
  vec3FieldV3(20, 'worldOffset', () => DEFAULT_WORLD_OFFSET),
  tField(21),
];

// ── FIELDS_V4 — the live schema ──────────────────────────────────────
// v4 (docs/sid.md § 9.2): the three parallel object-ref encodings
// collapse into one universal LEB128 SID ref. focus/to carry a SID of
// any kind (a cloud focus is just a cloud-kind SID); POIs persist by
// SID. Bits 16/17 (legacy 1-byte cloud refs) are RETIRED — leave them
// unclaimed for ~6 months of deploy overlap before any reuse.
// Everything else is byte-identical to v3. Append-only bit policy
// continues: unknown high mask bits are ignored by the decoder.
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
  coordSphereEquatorialField(24),
  u8Field(25, 'ev', { min: -EV_MAX_STOPS, max: EV_MAX_STOPS, step: EV_STEP_STOPS }),
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
      // encodeBytes call (which would recompute vec3 sub-masks and pois
      // list lengths).
      off += f.encode(view, dv, off);
    }
  }
  return toBase64Url(new Uint8Array(ab));
}

export function encodeBlob(view: DecodedView): string {
  return encodeBlobWithMask(view, computePresence(view));
}

export interface DecodedBlob {
  view: DecodedView;
  /** Schema version the blob was written in. Lets callers detect legacy
   *  blobs and trigger an upgrade rewrite. */
  version: number;
}

export function decodeBlob(blob: string): DecodedBlob {
  const bytes = fromBase64Url(blob);
  if (bytes.length < 1) throw new Error(`Blob too short: ${bytes.length} bytes`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint8(0);
  if (version === SCHEMA_VERSION_V1) return { view: decodeV1(dv), version };
  if (version === SCHEMA_VERSION_V2) return { view: decodeV2(dv), version };
  if (version === SCHEMA_VERSION_V3) return { view: decodeVarintMasked(dv, FIELDS_V3, 'v3'), version };
  if (version === SCHEMA_VERSION)    return { view: decodeVarintMasked(dv, FIELDS_V4, 'v4'), version };
  throw new Error(`Unsupported view version: ${version}`);
}

function decodeV1(dv: DataView): DecodedView {
  if (dv.byteLength < 5) throw new Error(`v1 blob too short: ${dv.byteLength} bytes`);
  const mask = dv.getUint32(1, true);
  const view: DecodedView = {};
  let off = 5;
  for (const f of FIELDS_V1) {
    if (mask & (1 << f.bit)) {
      f.decode(view, dv, off);
      off += f.decodeBytes(dv, off);
    }
  }
  return view;
}

function decodeV2(dv: DataView): DecodedView {
  if (dv.byteLength < 4) throw new Error(`v2 blob too short: ${dv.byteLength} bytes`);
  const mask = readU24LE(dv, 1);
  const view: DecodedView = {};
  let off = 4;
  for (const f of FIELDS_V2) {
    if (mask & (1 << f.bit)) {
      f.decode(view, dv, off);
      off += f.decodeBytes(dv, off);
    }
  }
  return view;
}

// Shared LEB128-mask envelope walker (v3 onward). All per-version byte
// behaviour lives in the FIELDS table; unknown mask bits are ignored
// (append-only forward tolerance). The post-decode pass invokes
// postDecode hooks on fields whose mask bit was present this round —
// used by cam to swap z=0 in observe mode, since cam decodes at bit 0
// but mode is set by flags at bit 13.
function decodeVarintMasked(dv: DataView, fields: FieldSpec[], label: string): DecodedView {
  if (dv.byteLength < 2) throw new Error(`${label} blob too short: ${dv.byteLength} bytes`);
  const { val: mask, bytes: maskBytes } = readVarint(dv, 1, dv.byteLength);
  const view: DecodedView = {};
  let off = 1 + maskBytes;
  for (const f of fields) {
    if (mask & (1 << f.bit)) {
      f.decode(view, dv, off);
      off += f.decodeBytes(dv, off);
    }
  }
  for (const f of fields) {
    if ((mask & (1 << f.bit)) && f.postDecode) f.postDecode(view);
  }
  return view;
}

// RFC 4648 §5 base64url, no padding.
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

// Build a DecodedView from current Stellata state. Default-equality is
// computed against canonical defaults so omitted fields keep the blob
// minimal.
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

  // POIs are encoded as SIDs (not runtime indices) so a catalog rebuild
  // can't re-point old URLs; objects without a resolvable SID can't be
  // pinned in the first place. Any pinnable kind rides the same
  // untagged-SID wire the focus/to refs use. Capped at POI_MAX_COUNT
  // defensively.
  {
    const pois = stellata.pois.get();
    if (pois.length > 0) {
      const sidsOut: number[] = [];
      for (const t of pois) {
        if (sidsOut.length >= POI_MAX_COUNT) break;
        const ref = sidRefOf(idMaps, t.kind, t.idx);
        if (ref !== undefined) sidsOut.push(ref.id);
      }
      if (sidsOut.length > 0) view.poiSids = sidsOut;
    }
  }

  const c = stellata.camera.position;
  const t = stellata.controls.target;
  const u = stellata.referenceUp.get();
  // Skip each independently. Under floating origin, a focused-orbit URL
  // has tgt=[0,0,0] (the focal star's local position) and observe-mode
  // has cam=[0,0,0] (camera is parked *at* the focal star), so omitting
  // them when at default trims ~16 base64url chars from nearly every
  // URL. Cam's default depends on mode — receiver re-snaps cam to
  // origin via setCameraMode('observe', { animate: false }) on apply.
  //
  // Frame: cam/tgt are emitted as raw camera.position / controls.target
  // — i.e. in worldOffset-local frame. With focus, the focal object's
  // setFocus call has already recentred worldOffset to that object's
  // absolute position, so cam/tgt are object-local. Without focus, the
  // origin rides along with whatever object was most recently anchored
  // (the unfocus path no longer recentres to Sol). The
  // worldOffset field below carries the absolute anchor position so
  // the loader can re-establish the same frame on page-load. Old-style
  // URLs without worldOffset always had worldOffset=(0,0,0) at save
  // time, so the local frame was Sol — backward-compatible.
  //
  // Emit worldOffset only when no focus is active AND the anchor isn't
  // Sol. With focus, the loader's focusStar call recentres origin
  // automatically. With anchor at Sol, the local frame is implicitly
  // Sol-relative (matches the legacy default), so omitting saves
  // 12 bytes on every default-pose URL.
  const wo = stellata.getWorldOffset();
  const woNonSol = stellata.focus.getFocusedStar() === null
    && (!approx(wo.x, 0) || !approx(wo.y, 0) || !approx(wo.z, 0));
  if (woNonSol) {
    view.worldOffset = [wo.x, wo.y, wo.z];
  }
  // Two-layer elision is intentional: this site populates view.cam/tgt/up
  // when any component is meaningfully off-default at 1e-3 epsilon (so
  // tiny per-frame numerical noise from controls.update doesn't keep
  // re-triggering URL writes), then vec3FieldV3.isPresent re-checks at
  // strict equality to decide whether the field claims its outer
  // presence bit. Both layers are load-bearing — the inner strict
  // equality preserves floating-origin sub-µpc cam values
  // that would round to default under the outer
  // epsilon if the inner check were also approx. Don't collapse to one
  // predicate without preserving both regimes.
  //
  // When the anchor is non-Sol, always populate cam/tgt explicitly so
  // the decoder doesn't fall back to default-pose reconstruction in a
  // shifted local frame; vec3FieldV3.isPresent will still elide cam/tgt
  // from the wire if they happen to match default (the decoder's
  // worldOffset branch resets them to default anyway, so the net pose
  // is identical), but populating them here keeps the path explicit.
  const camDefault = defaultCamForMode(mode);
  if (woNonSol || !approx(c.x, camDefault[0]) || !approx(c.y, camDefault[1]) || !approx(c.z, camDefault[2])) {
    view.cam = [c.x, c.y, c.z];
  }
  if (woNonSol || !approx(t.x, DEFAULT_TGT[0]) || !approx(t.y, DEFAULT_TGT[1]) || !approx(t.z, DEFAULT_TGT[2])) {
    view.tgt = [t.x, t.y, t.z];
  }
  if (!approx(u.x, DEFAULT_UP[0]) || !approx(u.y, DEFAULT_UP[1]) || !approx(u.z, DEFAULT_UP[2])) {
    view.up = [u.x, u.y, u.z];
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

function resolveStarRef(ref: StarRef, idMaps: IdMaps, fallback: number): number {
  if (ref.kind === 'hip') {
    const idx = idMaps.hipToIndex.get(ref.id);
    return idx ?? fallback;
  }
  return ref.id >= 0 && ref.id < idMaps.starCount ? ref.id : fallback;
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

// Apply a decoded view to Stellata. **The order here is load-bearing**:
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
): void {
  if (view.unit) setUnit(view.unit);

  // Declutter level — applied before the filter patch below; drives the
  // scene-element binds (default 'all' omitted, so this only fires for a
  // decluttered share). Runs after layers are constructed (applyFromUrl
  // runs post-construction), so lazily-attached layers pick up the
  // permitted set via their per-frame detailPermits() read.
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
  // camera.position / controls.target / the reference axis sets this so the final
  // update() reads as "if any of those happened, refresh" — replaces
  // a hand-maintained N-way OR that grew with every new branch.
  let controlsDirty = false;

  if (view.up) {
    stellata.referenceUp.set(view.up[0], view.up[1], view.up[2]);
    stellata.referenceUp.correct(stellata.camera);
    controlsDirty = true;
  }

  const hasCam = view.cam !== undefined;
  const hasTgt = view.tgt !== undefined;

  if (view.focus !== undefined) {
    if (view.focus === 'cleared') {
      // URL restore — bypass the close-zoom unfocus animation.
      // cam/tgt below would overwrite camera.position mid-lerp, leaving
      // the transition state to silently drag the camera away from the
      // restored pose on the next frame.
      stellata.focus.unfocus({ animate: false });
    } else if (view.focus.kind === 'sid') {
      // v4 universal ref. Deferred-resolution contract (docs/sid.md
      // § 8): a sid whose domain hasn't attached yet applies on that
      // attach; a sid no attached domain claims expires silently and
      // the rest of the decoded state stands. Planet sids translate
      // domain index → flat Target index; a translation miss (host
      // body-field not attached) drops the focus like an unknown sid.
      const snap = hasCam || hasTgt;
      idMaps.sidResolver.whenResolved(view.focus.id, (kind, localIndex) => {
        const idx = targetIdxOf(idMaps, kind, localIndex);
        if (idx === null) return;
        if (snap) stellata.focus.setOrbitTarget({ kind, idx });
        else stellata.focus.flyTo({ kind, idx }, { animate: false });
      });
    } else {
      const idx = resolveStarRef(view.focus, idMaps, idMaps.solIndex);
      if (idx >= 0 && idx < idMaps.starCount) {
        if (hasCam || hasTgt) stellata.focus.setOrbitTarget({ kind: 'star', idx });
        else stellata.focus.focusStar(idx, { animate: false });
      }
    }
  }
  // Legacy cloud focus is mutually exclusive with star focus, but the
  // encoder never emitted both — apply after `focus` so cloud wins on
  // the off chance both are present in a hand-crafted blob.
  if (view.cloud !== undefined && view.cloud >= 0) {
    if (hasCam || hasTgt) stellata.focus.setOrbitTarget({ kind: 'cloud', idx: view.cloud });
    else stellata.focus.flyTo({ kind: 'cloud', idx: view.cloud }, { animate: false });
  }
  if (view.toc !== undefined && view.toc >= 0) {
    stellata.focus.setVector({ kind: 'cloud', idx: view.toc });
  }
  if (view.to) {
    if (view.to.kind === 'sid') {
      idMaps.sidResolver.whenResolved(view.to.id, (kind, localIndex) => {
        const idx = targetIdxOf(idMaps, kind, localIndex);
        if (idx === null) return;
        stellata.focus.setVector({ kind, idx });
      });
    } else {
      const idx = resolveStarRef(view.to, idMaps, -1);
      if (idx >= 0 && idx < idMaps.starCount) stellata.focus.setVector({ kind: 'star', idx });
    }
  }

  // Apply worldOffset *before* cam/tgt so the local frame is established
  // first. With focus, focusStar above already recentred the origin to
  // the focal object, and the encoder elides worldOffset in that case —
  // but apply it anyway when present (no-op when redundant). Without
  // focus, worldOffset carries the close-orbit unfocus origin
 // so cam/tgt can be tiny local-frame values that round-
  // trip cleanly through float32. setWorldOffset also shifts camera
  // and target alongside the origin to preserve the user-visible
  // pose; for URL load we explicitly reset them to defaults here so
  // an absent view.cam / view.tgt produces the conventional default
  // pose in the *new* local frame rather than the recentre-shifted
  // junk position. view.cam / view.tgt below override when present.
  if (view.worldOffset) {
    stellata.setWorldOffset(view.worldOffset[0], view.worldOffset[1], view.worldOffset[2]);
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
  // Mirror the encoder's observe-mode cam omission: pre-snap the camera
  // to the focal-star origin *before* controls.update so that lookAt
  // computes the right quaternion from (0,0,0)→tgt rather than from
  // focusStar's orbit position. setCameraMode('observe', animate:false)
  // below preserves that quaternion when it pins position again.
  // setCameraToDefault routes through defaultCamForMode so the elision
  // invariant lives in one place.
  const willEnterObserve = view.mode === 'observe' && isHardTarget(stellata.focus.getFocusedTarget());
  if (willEnterObserve && !hasCam) {
    setCameraToDefault(stellata, 'observe');
    controlsDirty = true;
  }
  if (controlsDirty) stellata.controls.update();

  if (willEnterObserve) {
    stellata.observe.setMode('observe', { animate: false });
  }

  // Chart applies after observe mode is engaged so the chart-mode
  // orchestrator's observe-gate sees the right cameraMode on the
  // resulting filter-change event.
  if (view.chart && stellata.focus.getCameraMode() === 'observe') {
    stellata.filters.setFilter({ chart: true });
  }

  // Legacy HIP POI lists resolve through idMaps (star-kind by
  // construction); v4 SID lists through the resolver, any pinnable
  // kind. Entries that don't resolve are silently dropped (graceful
  // partial restore). SID POIs resolve synchronously rather than via
  // deferred intents: the star domain attaches at catalog load and
  // main.ts awaits kinds.planet.systemsReady, both strictly before
  // applyFromUrl — a pending POI sid is therefore as dead as an
  // unknown one.
  {
    const resolved: Target[] = [];
    if (Array.isArray(view.pois)) {
      for (const hip of view.pois) {
        const idx = idMaps.hipToIndex.get(hip);
        if (idx !== undefined) resolved.push({ kind: 'star', idx });
      }
    }
    if (Array.isArray(view.poiSids)) {
      for (const sid of view.poiSids) {
        const r = idMaps.sidResolver.resolve(sid);
        if (r.status !== 'resolved') continue;
        const idx = targetIdxOf(idMaps, r.kind, r.localIndex);
        if (idx !== null) resolved.push({ kind: r.kind, idx });
      }
    }
    if (resolved.length > 0) stellata.pois.set(resolved);
  }
}

// The fragment is not URL state — boot flags (`#renderer=webgpu`,
// src/client/webgpu/README.md) ride it, and a bare-path replaceState
// resolves to a URL without one, silently dropping the flag.
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

// Returns true when a state blob was present and applied — from the
// canonical `/v/<blob>/` path or the legacy `?v=` query param, any schema
// version. The caller uses the false branch to fall back to the canonical
// first-load view. A malformed blob also returns false so the user lands
// on the framed default rather than the unframed canvas-default pose.
export function applyFromUrl(stellata: Stellata, idMaps: IdMaps): boolean {
  const { blob, legacyQueryForm } = pickShareBlob(location.pathname, location.search);
  if (!blob) {
    resetJunkUrl();
    return false;
  }
  let decoded: DecodedBlob;
  try {
    decoded = decodeBlob(blob);
  } catch (err) {
    console.warn('Failed to decode URL state:', err);
    resetJunkUrl();
    return false;
  }
  applyDecodedView(stellata, decoded.view, idMaps);
  // After the same debounce as routine writes, rewrite the address bar to
  // the canonical path form when the link arrived in legacy query form OR
  // in a superseded schema (the docs/sid.md § 9.4 migration: HIP refs land
  // exactly, index/cloud refs freeze to the current build, unresolvable
  // refs drop). Both conditions must stay — a current-schema `?v=` link
  // needs the query→path rewrite even though its bytes wouldn't change.
  // The rewrite is address-bar only; already-posted `?v=` links keep
  // decoding forever. Defers past state-change events the apply itself
  // triggers, which would otherwise schedule their own write on top.
  if (legacyQueryForm || decoded.version !== SCHEMA_VERSION) {
    setTimeout(() => writeUrl(stellata, idMaps), DEBOUNCE_MS);
  }
  return true;
}

// Write the live camera/target/up triple into `out` at the canonical
// layout the per-frame change detector reads from:
//   [0..2] camera.position, [3..5] controls.target, [6..8] reference up
// Single source of truth for that layout so seed and per-frame update
// can't drift apart on index.
function snapshotCam(stellata: Stellata, out: Float64Array): void {
  const c = stellata.camera.position;
  const t = stellata.controls.target;
  const u = stellata.referenceUp.get();
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
  snapshotCam(stellata, lastCam);
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

    const c = stellata.camera.position;
    const tg = stellata.controls.target;
    const u = stellata.referenceUp.get();
    // Component-wise epsilon comparison on the steady-state path. The
    // per-vector threshold scales with magnitude (frameTriggerEps) so
    // a zoom-out from solar-system scale trips at AU-resolution rather
    // than waiting for the camera to move 1e-3 pc ≈ 206 AU. At scene
    // scale (>= 0.1 pc) the threshold caps at EPS, preserving the
    // original behaviour. No allocations on the no-change path — used
    // to be 10+ string allocations per frame from a toFixed(3)×9 hash.
    const cEps = frameTriggerEps(Math.hypot(c.x, c.y, c.z));
    const tEps = frameTriggerEps(Math.hypot(tg.x, tg.y, tg.z));
    const uEps = frameTriggerEps(Math.hypot(u.x, u.y, u.z));
    const camMoved =
      Math.abs(c.x - lastCam[0]) >= cEps || Math.abs(c.y - lastCam[1]) >= cEps || Math.abs(c.z - lastCam[2]) >= cEps ||
      Math.abs(tg.x - lastCam[3]) >= tEps || Math.abs(tg.y - lastCam[4]) >= tEps || Math.abs(tg.z - lastCam[5]) >= tEps ||
      Math.abs(u.x - lastCam[6]) >= uEps || Math.abs(u.y - lastCam[7]) >= uEps || Math.abs(u.z - lastCam[8]) >= uEps;
    if (camMoved) {
      snapshotCam(stellata, lastCam);
      changed = true;
    }

    if (changed) schedule();
  });
}

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS;
}
