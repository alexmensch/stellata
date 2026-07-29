import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encodeBlob,
  decodeBlob,
  currentStateOf,
  applyDecodedView,
  applyFromUrl,
  startUrlSync,
  writeVarint,
  readVarint,
  varintLen,
  frameTriggerEps,
  type DecodedView,
  type StarRef,
  type IdMaps,
} from './url-state';
import type { Stellata } from '../../stellata';
import type { Target } from '../../camera/focus/focus-target';
import { DEFAULT_FILTER, DEFAULT_FOV } from '../../filters/filter-state';
import { AU_PC } from '../astronomy-constants';
import { SidResolver, arrayDomain } from '../sid-resolver';
import { GALACTIC_NORTH_POLE_ICRS } from '../../galactic/galactic-coords';

// Round-trips the view through the wire format and returns the decoded
// view + version. Anything the encoder omits (e.g. default values) reads
// back as undefined, which is the contract callers downstream rely on.
function roundtrip(view: DecodedView) {
  const blob = encodeBlob(view);
  return decodeBlob(blob);
}

// Fully-settled resolver over a tiny star domain — enough for the
// currentStateOf tests, which never look sids up.
function makeResolver(starSids: number[] = []): SidResolver {
  const r = new SidResolver(['star']);
  r.attach('star', arrayDomain(starSids));
  return r;
}

// Decode a base64url blob to its underlying byte count. Used in byte-
// budget assertions across multiple describe blocks (LEB128 mask, vec3
// sub-mask elision, headline cam-orbit URL).
function blobBytes(blob: string): number {
  const padded = blob + '='.repeat((4 - (blob.length % 4)) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/')).length;
}

// Build a manually-shaped v1 blob (legacy 32-bit mask, float32 scalars,
// 4-byte star refs / POI HIPs). Used by the v1 backward-compat block
// to verify legacy decoders still work.
function buildV1Blob(mask: number, payload: Uint8Array): string {
  const ab = new ArrayBuffer(5 + payload.length);
  const dv = new DataView(ab);
  dv.setUint8(0, 1); // version
  dv.setUint32(1, mask >>> 0, true); // 32-bit mask in v1
  const bytes = new Uint8Array(ab);
  bytes.set(payload, 5);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Build a manually-shaped v2 blob (24-bit mask + flat 12-byte vec3
// fields). Used by the v2 backward-compat block and by the v2→v3
// auto-upgrade rewrite test.
function buildV2Blob(mask: number, payload: Uint8Array): string {
  const ab = new ArrayBuffer(4 + payload.length);
  const dv = new DataView(ab);
  dv.setUint8(0, 2); // version
  dv.setUint8(1, mask & 0xff);
  dv.setUint8(2, (mask >>> 8) & 0xff);
  dv.setUint8(3, (mask >>> 16) & 0xff);
  const bytes = new Uint8Array(ab);
  bytes.set(payload, 4);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The `up` wire slot carries the camera's reference axis, whose canonical
// default is galactic north. Duck-typed like every other vector here so the
// wire-format suite stays independent of THREE.
const GN_UP: [number, number, number] = [
  GALACTIC_NORTH_POLE_ICRS.x, GALACTIC_NORTH_POLE_ICRS.y, GALACTIC_NORTH_POLE_ICRS.z,
];

function referenceUpStub(up: [number, number, number] = GN_UP) {
  const vec = { x: up[0], y: up[1], z: up[2] };
  return {
    get: () => vec,
    set: (x: number, y: number, z: number) => {
      const len = Math.hypot(x, y, z) || 1;
      vec.x = x / len; vec.y = y / len; vec.z = z / len;
    },
    correct: () => 0,
  };
}

// Duck-typed THREE.Vector3 — url-state only ever reads x/y/z and calls
// set/normalize, so the wire suite stays independent of THREE.
function mockVec3(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set(nx: number, ny: number, nz: number) {
      this.x = nx; this.y = ny; this.z = nz;
      return this;
    },
    normalize() { return this; },
  };
}

// Fixture catalog: idx 0 = Sol (sid 100); idx 1 = HIP 32349 / sid 101;
// idx 2 = no-HIP / sid 102; idx 3 = HIP 91262 / sid 103. Two clouds with
// sids 201/202.
const SOL_SID = 100;
const STAR_SIDS = [SOL_SID, 101, 102, 103];
const STAR_HIPS = [0, 32349, 0, 91262];
const CLOUD_SIDS = [201, 202];

// A rebuild re-sorts the catalog by absolute magnitude, so every row
// index moves while the sids ride along. Build-B row → build-A row.
const REINDEX = [2, 3, 0, 1];
const REINDEXED_STAR_SIDS = REINDEX.map((a) => STAR_SIDS[a]);
const REINDEXED_STAR_HIPS = REINDEX.map((a) => STAR_HIPS[a]);

type PlanetTranslation = Pick<IdMaps, 'planetDomainIndexOf' | 'planetTargetIndexOf'>;

const NO_PLANET_HOST: PlanetTranslation = {
  planetDomainIndexOf: () => null,
  planetTargetIndexOf: () => null,
};

// Planet SID domain indices offset from the flat PlanetBodyField Target
// indices, so a test that passes this exercises both translation legs
// rather than an identity mapping that would hide a missing one.
function planetTranslation(domainCount: number, flatOffset: number): PlanetTranslation {
  return {
    planetDomainIndexOf: (t) =>
      t - flatOffset >= 0 && t - flatOffset < domainCount ? t - flatOffset : null,
    planetTargetIndexOf: (d) => (d >= 0 && d < domainCount ? d + flatOffset : null),
  };
}

// Fixture IdMaps over a star catalog. `sidResolver` defaults to a settled
// star-only resolver; pass one to add domains (planet / probe / cloud) or
// to leave a rostered domain unattached. `hips` is the row→HIP column
// (0 = no HIP) and seeds both directions of the legacy HIP maps.
function makeIdMaps({
  starSids = STAR_SIDS,
  hips = [],
  sidResolver = makeResolver(starSids),
  planet = NO_PLANET_HOST,
}: {
  starSids?: number[];
  hips?: number[];
  sidResolver?: SidResolver;
  planet?: PlanetTranslation;
} = {}): IdMaps {
  const indexToHip = new Uint32Array(starSids.length);
  const hipToIndex = new Map<number, number>();
  hips.forEach((hip, i) => {
    if (hip === 0) return;
    indexToHip[i] = hip;
    hipToIndex.set(hip, i);
  });
  return {
    hipToIndex,
    indexToHip,
    starCount: starSids.length,
    solIndex: starSids.indexOf(SOL_SID),
    sidResolver,
    ...planet,
  };
}

/** The fixture build: 4 stars with HIPs + 2 clouds, both domains settled. */
function makeFixtureBuild(starSids = STAR_SIDS, hips = STAR_HIPS): IdMaps {
  const sidResolver = new SidResolver(['star', 'cloud']);
  sidResolver.attach('star', arrayDomain(starSids));
  sidResolver.attach('cloud', arrayDomain(CLOUD_SIDS));
  return makeIdMaps({ starSids, hips, sidResolver });
}

// Mock Stellata that records what the URL layer dispatched onto it —
// enough for the apply → re-encode round-trips (focus / vector / POI /
// mode), which the getter-only mock in the cam-omission block can't drive.
function makeStatefulStellata() {
  const state = {
    focusedStar: 0 as number | null, // Sol default focus
    focusedCloud: null as number | null,
    focusedPlanet: null as number | null,
    focusedProbe: null as number | null,
    vectorTo: null as number | null,
    vectorToCloud: null as number | null,
    pois: [] as Target[],
    mode: 'navigate' as 'navigate' | 'observe',
  };
  const clearFocus = () => {
    state.focusedStar = null;
    state.focusedCloud = null;
    state.focusedPlanet = null;
    state.focusedProbe = null;
  };
  const setFocusSlot = (t: Target) => {
    if (t.kind === 'star') state.focusedStar = t.idx;
    else if (t.kind === 'planet') state.focusedPlanet = t.idx;
    else if (t.kind === 'probe') state.focusedProbe = t.idx;
    else state.focusedCloud = t.idx;
  };
  const stub: Partial<Stellata> = {
    getFilter: () => ({ ...DEFAULT_FILTER }),
    setFilter: () => {},
    applyMagnitudePreset: () => {},
    getCameraFov: () => DEFAULT_FOV,
    setCameraFov: () => {},
    getT: () => Date.now() / 1000,
    setT: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getWorldOffset: () => mockVec3() as any,
    setWorldOffset: () => {},
    getFocusedStar: () => state.focusedStar,
    getFocusedTarget: () => {
      if (state.focusedStar !== null) return { kind: 'star', idx: state.focusedStar };
      if (state.focusedPlanet !== null) return { kind: 'planet', idx: state.focusedPlanet };
      if (state.focusedProbe !== null) return { kind: 'probe', idx: state.focusedProbe };
      if (state.focusedCloud !== null) return { kind: 'cloud', idx: state.focusedCloud };
      return null;
    },
    getVectorTarget: () => {
      if (state.vectorTo !== null) return { kind: 'star', idx: state.vectorTo };
      if (state.vectorToCloud !== null) return { kind: 'cloud', idx: state.vectorToCloud };
      return null;
    },
    getPois: () => state.pois,
    getCameraMode: () => state.mode,
    setCameraMode: (m) => { state.mode = m; },
    focusStar: (idx) => { clearFocus(); state.focusedStar = idx; },
    setOrbitTarget: (t) => { clearFocus(); setFocusSlot(t); },
    unfocus: () => {
      state.focusedStar = null; state.focusedPlanet = null; state.focusedProbe = null;
    },
    flyTo: (t) => { clearFocus(); setFocusSlot(t); },
    setVector: (t) => {
      if (t === null) { state.vectorTo = null; state.vectorToCloud = null; }
      else if (t.kind === 'star') { state.vectorTo = t.idx; state.vectorToCloud = null; }
      else { state.vectorToCloud = t.idx; state.vectorTo = null; }
    },
    setPois: (l) => { state.pois = [...l]; },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    camera: { position: mockVec3(0, 0, 30), up: mockVec3(...GN_UP) } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    referenceUp: referenceUpStub() as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controls: { target: mockVec3(), update() {} } as any,
  };
  return { stellata: stub as Stellata, state };
}

// Decode a blob, apply it, re-encode the resulting live state — the
// applyFromUrl upgrade path minus the debounce.
function migrate(blob: string, idMaps = makeFixtureBuild()) {
  const { stellata, state } = makeStatefulStellata();
  applyDecodedView(stellata, decodeBlob(blob).view, idMaps);
  const re = decodeBlob(encodeBlob(currentStateOf(stellata, idMaps)));
  return { state, re };
}

/** v1/v2's 3-byte little-endian star ref / POI id. */
function u24(val: number): number[] {
  return [val & 0xff, (val >>> 8) & 0xff, (val >>> 16) & 0xff];
}

describe('url-state', () => {
  describe('empty view', () => {
    it('encodes to a 2-byte (version + 1-byte LEB128 mask) blob', () => {
      const blob = encodeBlob({});
      // 2 bytes → 3 base64url chars (no padding). v3's LEB128 mask
      // collapses the empty mask to 1 byte from v2's fixed 3 bytes.
      expect(blob.length).toBe(3);
    });

    it('decodes empty blob to empty view at current version', () => {
      const { view, version } = roundtrip({});
      expect(view).toEqual({});
      expect(version).toBe(4);
    });
  });

  describe('vec3 fields (cam, tgt, up)', () => {
    it('round-trips cam exactly', () => {
      const cam: [number, number, number] = [1.5, -2.25, 30];
      const { view } = roundtrip({ cam });
      expect(view.cam).toEqual(cam);
    });

    it('round-trips tgt exactly', () => {
      const tgt: [number, number, number] = [10, 20, 30];
      const { view } = roundtrip({ tgt });
      expect(view.tgt).toEqual(tgt);
    });

    it('round-trips a non-default up exactly', () => {
      // [0, 1, 0] would elide to default in v3 — see the v3 default-
      // elision test below. Use a tilted up to force the encoder to
      // actually carry components on the wire.
      const up: [number, number, number] = [0.7071, 0.7071, 0];
      const { view } = roundtrip({ up });
      expect(view.up![0]).toBeCloseTo(0.7071, 4);
      expect(view.up![1]).toBeCloseTo(0.7071, 4);
      expect(view.up![2]).toBe(0);
    });

    it('round-trips all three vec3 fields independently', () => {
      const view: DecodedView = {
        cam: [1, 2, 3],
        tgt: [4, 5, 6],
        up: [0.7071, 0, 0.7071],
      };
      const { view: out } = roundtrip(view);
      expect(out.cam).toEqual([1, 2, 3]);
      expect(out.tgt).toEqual([4, 5, 6]);
      expect(out.up![0]).toBeCloseTo(0.7071, 4);
      expect(out.up![2]).toBeCloseTo(0.7071, 4);
    });

    it('round-trips worldOffset alongside small local-frame cam/tgt', () => {
      // The close-orbit unfocus case: worldOffset
      // sits at a far-from-Sol focal star, cam/tgt are sub-µpc local
      // values. Float32 preserves both magnitudes cleanly when stored
      // in their natural frames (worldOffset absolute, cam/tgt local),
      // whereas combining them into Sol-absolute floats would round
      // the µpc separation to zero.
      const view: DecodedView = {
        worldOffset: [51.6, 257, -37.7],
        cam: [1.85e-6, -2.61e-6, 3.95e-5],
        tgt: [0, 0, 0],
      };
      const { view: out } = roundtrip(view);
      expect(out.worldOffset![0]).toBeCloseTo(51.6, 3);
      expect(out.worldOffset![1]).toBeCloseTo(257, 3);
      expect(out.worldOffset![2]).toBeCloseTo(-37.7, 3);
      // Local-frame cam preserved at sub-µpc precision because float32
      // ULP at these magnitudes is ~1e-13.
      expect(out.cam![0]).toBeCloseTo(1.85e-6, 9);
      expect(out.cam![2]).toBeCloseTo(3.95e-5, 9);
    });

    //: guards the architectural claim from the encoder design
    // comment that "Float32 ULP at megaparsec absolute scale is ~10⁻²
    // pc — invisible in any view because the user-visible pose is the
    // cam/tgt offset within the local frame, and that's encoded at full
    // Float32 precision relative to the anchor."
    it('preserves sub-pc cam precision at kpc-scale worldOffset (galactic-centre frame)', () => {
      // 8.5 kpc ≈ Sol-to-GC distance. Float32 has ~24 bits of mantissa,
      // so absolute resolution at 8500 pc is ~5e-4 pc — much coarser than
      // the µpc cam offset, which is exactly why the encoder splits the
      // anchor and the local-frame pose.
      const view: DecodedView = {
        worldOffset: [8500, 0, 0],
        cam: [1.85e-6, -2.61e-6, 3.95e-5],
        tgt: [0, 0, 0],
      };
      const { view: out } = roundtrip(view);
      // Anchor round-trips at the float32 precision available at 8.5 kpc.
      // 5e-4 pc absolute → roughly 4 decimals.
      expect(out.worldOffset![0]).toBeCloseTo(8500, 3);
      // ...and the local cam offset stays at sub-µpc precision because
      // it's encoded in the local frame, not added to the anchor first.
      expect(out.cam![0]).toBeCloseTo(1.85e-6, 9);
      expect(out.cam![1]).toBeCloseTo(-2.61e-6, 9);
      expect(out.cam![2]).toBeCloseTo(3.95e-5, 9);
    });

    it('elides up when it matches the default (galactic north)', () => {
      // v3 sub-mask: components matching the per-key default are
      // omitted, and a vec3 with all components default has isPresent=
      // false → the field doesn't even claim its outer presence bit.
      const { view } = roundtrip({ up: GN_UP });
      expect(view.up).toBeUndefined();
    });

    it('elides tgt when it matches the default [0, 0, 0]', () => {
      const { view } = roundtrip({ tgt: [0, 0, 0] });
      expect(view.tgt).toBeUndefined();
    });

    it('emits the headline 10-char cam=[0,0,3.7] URL exactly', () => {
      // The PR's headline scenario: a near-Sol orbit on the z-axis.
      // v2 would burn 12 bytes on cam (3 × f32 incl. two zero floats);
      // v3 emits 1 sub-mask byte + 4 bytes for z = 5 bytes for the cam
      // payload. Plus 1 version + 1 LEB128 outer mask (bit 0 only) = 7
      // bytes total → 10 base64url chars. Down from v2's 22.
      //
      // Pinned exactly to the headline number — a `<= 12` upper bound
      // would silently allow a future change that flipped a default
      // constant or added an outer-mask byte to regress the win to 11
      // or 12 chars without tripping any test.
      const blob = encodeBlob({ cam: [0, 0, 3.7] });
      expect(blobBytes(blob)).toBe(7);
      expect(blob.length).toBe(10);
      const { view } = decodeBlob(blob);
      expect(view.cam![0]).toBe(0);
      expect(view.cam![1]).toBe(0);
      expect(view.cam![2]).toBeCloseTo(3.7, 5);
    });

    it('emits only the diverging x-component for cam=[5,0,30]', () => {
      // navigate-mode default is [0,0,30]; only x diverges. sub=1, 5
      // bytes payload.
      const { view } = roundtrip({ cam: [5, 0, 30] });
      expect(view.cam).toEqual([5, 0, 30]);
    });

    it('uses observe default ([0,0,0]) for cam when mode=observe', () => {
      // mode=observe shifts cam's z-default from 30 to 0. cam=[0,0,30]
      // is *off-default* in observe → sub=4 (z bit), z=30 on the wire.
      const { view, version } = roundtrip({ cam: [0, 0, 30], mode: 'observe' });
      expect(version).toBe(4);
      expect(view.cam).toEqual([0, 0, 30]);
      expect(view.mode).toBe('observe');
    });

    it('elides cam in observe mode when it matches the observe default', () => {
      // cam=[0,0,0] matches the observe default — fully elided.
      const { view } = roundtrip({ cam: [0, 0, 0], mode: 'observe' });
      expect(view.cam).toBeUndefined();
      expect(view.mode).toBe('observe');
    });

    it('decoder fills observe-mode cam z-default when sub-mask omits z', () => {
      // Encode cam=[5,0,0] in observe mode: only x diverges from
      // observe default [0,0,0]. sub=1, payload = x. Decoder must fill
      // z=0 (not z=30, the static-table default) once flags reveals
      // mode=observe — that's the post-pass in decodeV3.
      const { view } = roundtrip({ cam: [5, 0, 0], mode: 'observe' });
      expect(view.cam).toEqual([5, 0, 0]);
    });

    it('elides worldOffset when it matches [0, 0, 0]', () => {
      const { view } = roundtrip({ worldOffset: [0, 0, 0] });
      expect(view.worldOffset).toBeUndefined();
    });

    it('preserves cam precision at Mpc-scale worldOffset (extragalactic anchor)', () => {
      // 1 Mpc ≈ Andromeda-distance scale. Float32 ULP here is ~10⁻² pc —
      // the encoder design comment's claim. Anchor precision degrades but
      // local-frame cam is unaffected because of the split storage.
      const view: DecodedView = {
        worldOffset: [1e6, 0, 0],
        cam: [1.85e-6, -2.61e-6, 3.95e-5],
        tgt: [1e-3, 0, 0],
      };
      const { view: out } = roundtrip(view);
      // 1 Mpc anchor: float32 ULP ≈ 0.06 pc absolute → relative precision ~1e-7.
      expect(Math.abs(out.worldOffset![0] - 1e6) / 1e6).toBeLessThan(1e-6);
      // Local cam values are stored as float32s relative to the anchor —
      // i.e. as their raw small magnitudes, NOT as anchor + offset. So
      // their precision is set by the cam magnitudes themselves
      // (~1e-13 ULP at 1e-6 pc), not by the worldOffset's ULP.
      expect(out.cam![0]).toBeCloseTo(1.85e-6, 9);
      expect(out.cam![1]).toBeCloseTo(-2.61e-6, 9);
      expect(out.cam![2]).toBeCloseTo(3.95e-5, 9);
      expect(out.tgt![0]).toBeCloseTo(1e-3, 9);
    });
  });

  describe('quantised u8 fields (v2)', () => {
    it('round-trips fov at slider step boundaries', () => {
      // fov: min=10, max=120, step=1 — integer values round-trip exactly
      for (const fov of [10, 30, 60, 90, 120]) {
        const { view } = roundtrip({ fov });
        expect(view.fov).toBe(fov);
      }
    });

    it('clamps fov to encoder range without wrapping', () => {
      // 200 is past max (120). It should saturate at 120, not wrap to a
      // wraparound value. Encoder clamp guards this.
      const { view } = roundtrip({ fov: 200 });
      expect(view.fov).toBe(120);
    });

    it('clamps fov below min to min', () => {
      const { view } = roundtrip({ fov: 5 });
      expect(view.fov).toBe(10);
    });

    it('round-trips mag at 0.1 step boundaries', () => {
      // mag: min=-2, max=15, step=0.1
      for (const mag of [-2, 0, 5.5, 12.3, 15]) {
        const { view } = roundtrip({ mag });
        expect(view.mag).toBeCloseTo(mag, 1);
      }
    });

    it('round-trips smin at 0.1 step boundaries', () => {
      for (const smin of [1, 1.5, 3.7, 6]) {
        const { view } = roundtrip({ smin });
        expect(view.smin).toBeCloseTo(smin, 1);
      }
    });

    it('round-trips smax at 0.5 step boundaries', () => {
      for (const smax of [2, 8, 16.5, 32]) {
        const { view } = roundtrip({ smax });
        expect(view.smax).toBeCloseTo(smax, 1);
      }
    });

    it('round-trips span at 0.5 step boundaries', () => {
      for (const span of [2, 5, 12.5, 20]) {
        const { view } = roundtrip({ span });
        expect(view.span).toBeCloseTo(span, 1);
      }
    });

    it('rounds to nearest step, not floor', () => {
      // 60.4 → 60 (round); 60.6 → 61 (round)
      expect(roundtrip({ fov: 60.4 }).view.fov).toBe(60);
      expect(roundtrip({ fov: 60.6 }).view.fov).toBe(61);
    });
  });

  describe('u16 fields (dmin, dmax, spect)', () => {
    it('round-trips dmin and dmax', () => {
      const { view } = roundtrip({ dmin: 100, dmax: 800 });
      expect(view.dmin).toBe(100);
      expect(view.dmax).toBe(800);
    });

    it('round-trips spectral mask at full 9-bit range', () => {
      const { view } = roundtrip({ spect: 0b111111111 });
      expect(view.spect).toBe(0b111111111);
    });

    it('round-trips zero spectral mask', () => {
      const { view } = roundtrip({ spect: 0 });
      expect(view.spect).toBe(0);
    });

    it('round-trips u16 boundary value', () => {
      const { view } = roundtrip({ dmax: 65535 });
      expect(view.dmax).toBe(65535);
    });
  });

  describe('preset and constellation', () => {
    it('round-trips each preset', () => {
      for (const preset of ['naked-eye', 'binoculars', 'all'] as const) {
        const { view } = roundtrip({ preset });
        expect(view.preset).toBe(preset);
      }
    });

    it('round-trips constellation index incl. negative values', () => {
      // con is signed int8 — covers full int8 range
      for (const con of [-128, -1, 0, 50, 87, 127]) {
        const { view } = roundtrip({ con });
        expect(view.con).toBe(con);
      }
    });
  });

  describe('flag byte (packFlags/unpackFlags)', () => {
    it('round-trips a galactic coordinate sphere as FLAG_GRID alone', () => {
      const { view } = roundtrip({ coordSphere: 'galactic' });
      expect(view.coordSphere).toBe('galactic');
    });

    // Bit 24 layers over FLAG_GRID rather than replacing it, so a client
    // predating the equatorial sphere ignores the unknown mask bit and still
    // shows a sphere. Which means the equatorial blob is strictly longer.
    it('round-trips an equatorial coordinate sphere via presence bit 24', () => {
      const { view } = roundtrip({ coordSphere: 'equatorial' });
      expect(view.coordSphere).toBe('equatorial');
      expect(encodeBlob({ coordSphere: 'equatorial' }).length)
        .toBeGreaterThan(encodeBlob({ coordSphere: 'galactic' }).length);
    });

    it('encodes no sphere for the default', () => {
      expect(encodeBlob({ coordSphere: 'none' })).toBe(encodeBlob({}));
    });

    it('round-trips showHud', () => {
      const { view } = roundtrip({ showHud: true });
      expect(view.showHud).toBe(true);
    });

    it('round-trips showConstellation=false', () => {
      const { view } = roundtrip({ showConstellation: false });
      expect(view.showConstellation).toBe(false);
    });

    it('round-trips showMilkyway=false', () => {
      const { view } = roundtrip({ showMilkyway: false });
      expect(view.showMilkyway).toBe(false);
    });

    it('round-trips showLgEmission=false (zero-byte presence bit, default-on elided)', () => {
      const { view } = roundtrip({ showLgEmission: false });
      expect(view.showLgEmission).toBe(false);
      const { view: defaults } = roundtrip({});
      expect(defaults.showLgEmission).toBeUndefined();
    });

    it('round-trips unit=pc (ly is the default, so only pc is encoded)', () => {
      const { view } = roundtrip({ unit: 'pc' });
      expect(view.unit).toBe('pc');
    });

    it('unit=ly is the default and is not encoded', () => {
      const { view } = roundtrip({ unit: 'ly' });
      expect(view.unit).toBeUndefined();
    });

    it('round-trips mode=observe', () => {
      const { view } = roundtrip({ mode: 'observe' });
      expect(view.mode).toBe('observe');
    });

    it('round-trips chart only when mode is observe', () => {
      // chart with mode=observe → encoded
      const { view: a } = roundtrip({ chart: true, mode: 'observe' });
      expect(a.chart).toBe(true);
      expect(a.mode).toBe('observe');

      // chart without mode=observe → dropped (chart-mode is observe-gated)
      const { view: b } = roundtrip({ chart: true });
      expect(b.chart).toBeUndefined();
    });

    it('round-trips multiple flags simultaneously', () => {
      const { view } = roundtrip({
        coordSphere: 'galactic',
        showHud: true,
        showConstellation: false,
        unit: 'pc',
      });
      expect(view.coordSphere).toBe('galactic');
      expect(view.showHud).toBe(true);
      expect(view.showConstellation).toBe(false);
      expect(view.unit).toBe('pc');
    });

    it('default flags are not encoded (no flags byte)', () => {
      // No flag bits → flags field is absent → smaller blob than +1 byte
      const empty = encodeBlob({});
      const withFlag = encodeBlob({ coordSphere: 'galactic' });
      expect(withFlag.length).toBeGreaterThan(empty.length);
    });
  });

  describe('object refs (focus, to) — v4 LEB128 SID refs', () => {
    // One universal encoding for every object kind; the wire carries no
    // type tag (kind comes from the runtime resolver at apply time).
    // Boundary sids exercise each LEB128 width step.
    const LEB128_BOUNDARY_SIDS = [
      1, 127,                 // 1 byte
      128, 16383,             // 2 bytes
      16384, 2097151,         // 3 bytes (PGC-scale headroom)
      2097152, 268435455,     // 4 bytes
      268435456, 4294967295,  // 5 bytes (u32 max)
    ];

    it('round-trips focus sids across every LEB128 width', () => {
      for (const id of LEB128_BOUNDARY_SIDS) {
        const { view, version } = roundtrip({ focus: { kind: 'sid', id } });
        expect(version).toBe(4);
        expect(view.focus).toEqual({ kind: 'sid', id });
      }
    });

    it('round-trips vector-to (to) sids', () => {
      const { view } = roundtrip({ to: { kind: 'sid', id: 306055 } });
      expect(view.to).toEqual({ kind: 'sid', id: 306055 });
    });

    it('round-trips focus and to together', () => {
      const { view } = roundtrip({
        focus: { kind: 'sid', id: 42 },
        to: { kind: 'sid', id: 327680 },
      });
      expect(view.focus).toEqual({ kind: 'sid', id: 42 });
      expect(view.to).toEqual({ kind: 'sid', id: 327680 });
    });

    it('pins the wire cost of a sid focus', () => {
      // 1 version + 3 LEB128 mask bytes (bit 14 = 0x4000 spans three
      // 7-bit groups) + LEB128 sid: 1 byte for sid 42, 3 for 306055.
      expect(blobBytes(encodeBlob({ focus: { kind: 'sid', id: 42 } }))).toBe(5);
      expect(blobBytes(encodeBlob({ focus: { kind: 'sid', id: 306055 } }))).toBe(7);
    });

    it("'cleared' focus uses zero-byte sentinel and round-trips", () => {
      const { view } = roundtrip({ focus: 'cleared' });
      expect(view.focus).toBe('cleared');
    });

    it('drops legacy hip/index refs instead of mis-encoding them', () => {
      // v4 has no hip/index wire form; a legacy StarRef that somehow
      // reaches the encoder must be omitted, never coerced into a sid.
      const hipRef: StarRef = { kind: 'hip', id: 32349 };
      const idxRef: StarRef = { kind: 'index', id: 12345 };
      expect(roundtrip({ focus: hipRef }).view.focus).toBeUndefined();
      expect(roundtrip({ to: idxRef }).view.to).toBeUndefined();
    });

    it('drops legacy cloud/toc indices (bits 16/17 retired in v4)', () => {
      // Cloud focus rides the universal `focus` sid in v4; the legacy
      // 1-byte fields decode from old blobs (golden corpus) but never
      // encode. The retired bits stay unclaimed for deploy overlap.
      const { view } = roundtrip({ cloud: 42, toc: 7 });
      expect(view.cloud).toBeUndefined();
      expect(view.toc).toBeUndefined();
    });
  });

  describe('POI sids (variable-length, v4)', () => {
    it('round-trips a single POI sid', () => {
      const { view } = roundtrip({ poiSids: [306055] });
      expect(view.poiSids).toEqual([306055]);
    });

    it('round-trips multiple POI sids in order, mixed LEB128 widths', () => {
      const poiSids = [5, 200, 16384, 327680, 100];
      const { view } = roundtrip({ poiSids });
      expect(view.poiSids).toEqual(poiSids);
    });

    it('truncates POI sids above the 16-entry cap', () => {
      const poiSids = Array.from({ length: 25 }, (_, i) => 1000 + i);
      const { view } = roundtrip({ poiSids });
      expect(view.poiSids).toHaveLength(16);
      expect(view.poiSids![0]).toBe(1000);
      expect(view.poiSids![15]).toBe(1015);
    });

    it('round-trips exactly 16 POI sids (the cap)', () => {
      const poiSids = Array.from({ length: 16 }, (_, i) => 2000 + i);
      const { view } = roundtrip({ poiSids });
      expect(view.poiSids).toEqual(poiSids);
    });

    it('empty POI array is not encoded as present', () => {
      // poiSids: [] → isPresent returns false → not in blob
      const empty = encodeBlob({});
      const emptyPois = encodeBlob({ poiSids: [] });
      expect(emptyPois.length).toBe(empty.length);
    });

    it('legacy HIP pois never encode in v4', () => {
      const { view } = roundtrip({ pois: [32349] });
      expect(view.pois).toBeUndefined();
      expect(view.poiSids).toBeUndefined();
    });
  });

  describe('full-state round-trip', () => {
    it('round-trips a realistic shared-URL state', () => {
      const view: DecodedView = {
        cam: [50, -20, 100],
        tgt: [0, 0, 0],
        fov: 45,
        mag: 6.5,
        dmax: 500,
        spect: 0b111111110, // hide M-class
        preset: 'binoculars',
        smin: 2.5,
        smax: 18,
        span: 8,
        coordSphere: 'galactic',
        showConstellation: false,
        unit: 'pc',
        focus: { kind: 'sid', id: 101 },
        mode: 'observe',
        chart: true,
        poiSids: [100, 200, 300],
      };
      const { view: out, version } = roundtrip(view);
      expect(version).toBe(4);
      expect(out.cam).toEqual(view.cam);
      // tgt=[0,0,0] matches the per-key default in v3 → elided. Same
      // contract as up=[0,1,0] and worldOffset=[0,0,0]. Receiver
      // recomputes tgt from default.
      expect(out.tgt).toBeUndefined();
      expect(out.fov).toBe(45);
      expect(out.mag).toBeCloseTo(6.5, 1);
      expect(out.dmax).toBe(500);
      expect(out.spect).toBe(view.spect);
      expect(out.preset).toBe('binoculars');
      expect(out.smin).toBeCloseTo(2.5, 1);
      expect(out.smax).toBeCloseTo(18, 1);
      expect(out.span).toBeCloseTo(8, 1);
      expect(out.coordSphere).toBe('galactic');
      expect(out.showConstellation).toBe(false);
      expect(out.unit).toBe('pc');
      expect(out.focus).toEqual(view.focus);
      expect(out.mode).toBe('observe');
      expect(out.chart).toBe(true);
      expect(out.poiSids).toEqual(view.poiSids);
    });
  });

  describe('version dispatch', () => {
    it('rejects unknown version with descriptive error', () => {
      // Construct a blob with version=99 (one byte = base64 'YwAA' → 'Yw')
      const dv = new DataView(new ArrayBuffer(4));
      dv.setUint8(0, 99);
      const bytes = new Uint8Array(dv.buffer);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      const blob = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      expect(() => decodeBlob(blob)).toThrow(/version: 99/);
    });

    it('rejects empty blob', () => {
      expect(() => decodeBlob('')).toThrow();
    });

    it('rejects v2 blob too short to contain a presence mask', () => {
      // Just version byte 0x02, no mask
      const blob = btoa('\x02').replace(/=+$/, '');
      expect(() => decodeBlob(blob)).toThrow(/v2 blob too short/);
    });
  });

  describe('v1 backward compatibility', () => {
    // Manually-constructed v1 blobs verify the legacy decoder still
    // works and reports version=1 so callers can trigger a rewrite.

    it('decodes v1 empty blob and reports version=1', () => {
      const blob = buildV1Blob(0, new Uint8Array(0));
      const { view, version } = decodeBlob(blob);
      expect(version).toBe(1);
      expect(view).toEqual({});
    });

    it('decodes v1 fov as float32 (not quantised)', () => {
      // v1 bit 3 = fov, 4 bytes f32 LE
      const payload = new Uint8Array(4);
      new DataView(payload.buffer).setFloat32(0, 75.5, true);
      const blob = buildV1Blob(1 << 3, payload);
      const { view, version } = decodeBlob(blob);
      expect(version).toBe(1);
      expect(view.fov).toBeCloseTo(75.5, 5);
    });

    it('decodes v1 star ref as 4-byte u32', () => {
      // v1 bit 14 = focus, 4 bytes u32 LE
      const FOCUS_HIP_TAG = 0x80000000;
      const id = 32349;
      const payload = new Uint8Array(4);
      new DataView(payload.buffer).setUint32(0, (id | FOCUS_HIP_TAG) >>> 0, true);
      const blob = buildV1Blob(1 << 14, payload);
      const { view, version } = decodeBlob(blob);
      expect(version).toBe(1);
      expect(view.focus).toEqual({ kind: 'hip', id: 32349 });
    });

    it('decodes v1 POI list with 4-byte HIP entries', () => {
      // v1 bit 19 = pois, 1-byte count + 4 bytes per HIP
      const hips = [100, 200, 300];
      const payload = new Uint8Array(1 + hips.length * 4);
      const dv = new DataView(payload.buffer);
      dv.setUint8(0, hips.length);
      for (let i = 0; i < hips.length; i++) {
        dv.setUint32(1 + i * 4, hips[i] >>> 0, true);
      }
      const blob = buildV1Blob(1 << 19, payload);
      const { view, version } = decodeBlob(blob);
      expect(version).toBe(1);
      expect(view.pois).toEqual(hips);
    });

    it('caps v1 POI count at 16 even when blob declares more', () => {
      // count byte = 25, but only 16 should decode
      const count = 25;
      const payload = new Uint8Array(1 + count * 4);
      const dv = new DataView(payload.buffer);
      dv.setUint8(0, count);
      for (let i = 0; i < count; i++) dv.setUint32(1 + i * 4, 1000 + i, true);
      const blob = buildV1Blob(1 << 19, payload);
      const { view } = decodeBlob(blob);
      expect(view.pois).toHaveLength(16);
    });
  });

  describe('v2 backward compatibility', () => {
    // v2 was the prior schema (1-byte version + 24-bit mask + flat
    // 12-byte vec3 fields). Manually construct v2-shaped blobs to
    // verify decodeV2 still works after v3 became the default writer.

    it('decodes v2 empty blob and reports version=2', () => {
      const blob = buildV2Blob(0, new Uint8Array(0));
      const { view, version } = decodeBlob(blob);
      expect(version).toBe(2);
      expect(view).toEqual({});
    });

    it('decodes v2 cam as a flat 12-byte float32 vec3', () => {
      // v2 bit 0 = cam, 12 bytes f32 LE × 3 — no sub-mask.
      const payload = new Uint8Array(12);
      const dv = new DataView(payload.buffer);
      dv.setFloat32(0, 1.5, true);
      dv.setFloat32(4, -2.25, true);
      dv.setFloat32(8, 3.7, true);
      const blob = buildV2Blob(1 << 0, payload);
      const { view, version } = decodeBlob(blob);
      expect(version).toBe(2);
      expect(view.cam![0]).toBeCloseTo(1.5, 5);
      expect(view.cam![1]).toBeCloseTo(-2.25, 5);
      expect(view.cam![2]).toBeCloseTo(3.7, 5);
    });

    it('decodes v2 fov as quantised u8 (already compressed in v2)', () => {
      // v2 bit 3 = fov, 1 byte u8 (raw=50 → fov = 10 + 50*1 = 60)
      const payload = new Uint8Array([50]);
      const blob = buildV2Blob(1 << 3, payload);
      const { view, version } = decodeBlob(blob);
      expect(version).toBe(2);
      expect(view.fov).toBe(60);
    });

    it('decodes v2 star ref as 3-byte u24', () => {
      // v2 bit 14 = focus, 3 bytes u24 LE; HIP tag = 0x800000
      const FOCUS_HIP_TAG_V2 = 0x800000;
      const id = 32349;
      const tagged = (id | FOCUS_HIP_TAG_V2) >>> 0;
      const payload = new Uint8Array(3);
      payload[0] = tagged & 0xff;
      payload[1] = (tagged >>> 8) & 0xff;
      payload[2] = (tagged >>> 16) & 0xff;
      const blob = buildV2Blob(1 << 14, payload);
      const { view, version } = decodeBlob(blob);
      expect(version).toBe(2);
      expect(view.focus).toEqual({ kind: 'hip', id: 32349 });
    });

    it('decodes v2 POI list with 3-byte HIP entries', () => {
      // v2 bit 19 = pois, 1-byte count + 3 bytes per HIP
      const hips = [100, 200, 300];
      const payload = new Uint8Array(1 + hips.length * 3);
      payload[0] = hips.length;
      for (let i = 0; i < hips.length; i++) {
        const off = 1 + i * 3;
        payload[off]     = hips[i]         & 0xff;
        payload[off + 1] = (hips[i] >>> 8)  & 0xff;
        payload[off + 2] = (hips[i] >>> 16) & 0xff;
      }
      const blob = buildV2Blob(1 << 19, payload);
      const { view, version } = decodeBlob(blob);
      expect(version).toBe(2);
      expect(view.pois).toEqual(hips);
    });
  });

  describe('currentStateOf cam-omission', () => {
    // Minimal mock — currentStateOf only reads getters and the camera /
    // controls vec3-shaped fields. Anything not exercised by these tests
    // returns the "default" sentinel so encoder skips that field.
    function makeMockStellata(opts: {
      mode?: 'navigate' | 'observe';
      camPos?: [number, number, number];
      target?: [number, number, number];
      up?: [number, number, number];
      focusedStar?: number | null;
    } = {}): Stellata {
      const mode = opts.mode ?? 'navigate';
      const camPos = opts.camPos ?? [0, 0, 30];
      const tgt = opts.target ?? [0, 0, 0];
      const up = opts.up ?? GN_UP;
      const stub: Partial<Stellata> = {
        getFilter: () => ({ ...DEFAULT_FILTER }),
        getCameraFov: () => DEFAULT_FOV,
        getFocusedStar: () => opts.focusedStar ?? null,
        getFocusedTarget: () => (opts.focusedStar != null
          ? { kind: 'star' as const, idx: opts.focusedStar }
          : null),
        getVectorTarget: () => null,
        getCameraMode: () => mode,
        getPois: () => [],
        // Live `t` — encoder gates emission on isLive(getT()), so returning
        // wall-clock now keeps the existing assertions at "no t in URL".
        getT: () => Date.now() / 1000,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getWorldOffset: () => ({ x: 0, y: 0, z: 0 } as any),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        camera: {
          position: { x: camPos[0], y: camPos[1], z: camPos[2] },
          up: { x: up[0], y: up[1], z: up[2] },
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        referenceUp: referenceUpStub(up) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        controls: {
          target: { x: tgt[0], y: tgt[1], z: tgt[2] },
        } as any,
      };
      return stub as Stellata;
    }

    const idMaps = makeIdMaps({ starSids: [100] });

    it('omits cam when observe-mode camera is parked at the focal-star origin', () => {
      // PR #1's optimisation: cam=[0,0,0] is the floating-origin local
      // position of the focal star, so it shouldn't roundtrip through the
      // URL. Regression: a future change that points camDefault elsewhere
      // for observe would silently re-introduce the 16 chars.
      const view = currentStateOf(
        makeMockStellata({ mode: 'observe', camPos: [0, 0, 0], focusedStar: 5 }),
        idMaps,
      );
      expect(view.cam).toBeUndefined();
      expect(view.mode).toBe('observe');
    });

    it('emits cam when observe-mode camera is *not* at the focal origin', () => {
      const view = currentStateOf(
        makeMockStellata({ mode: 'observe', camPos: [1, 2, 3], focusedStar: 5 }),
        idMaps,
      );
      expect(view.cam).toEqual([1, 2, 3]);
    });

    it('emits cam when navigate-mode camera is at [0,0,0] (not its default)', () => {
      // Navigate-mode default is [0, 0, 30]; [0, 0, 0] is meaningfully
      // off-default and must round-trip.
      const view = currentStateOf(
        makeMockStellata({ mode: 'navigate', camPos: [0, 0, 0] }),
        idMaps,
      );
      expect(view.cam).toEqual([0, 0, 0]);
    });

    it('omits cam when navigate-mode camera is at the navigate default', () => {
      const view = currentStateOf(
        makeMockStellata({ mode: 'navigate', camPos: [0, 0, 30] }),
        idMaps,
      );
      expect(view.cam).toBeUndefined();
    });
  });

  describe('blob size', () => {
    it('full-default state encodes to 3 chars (1 version + 1-byte LEB128 mask)', () => {
      expect(encodeBlob({}).length).toBe(3);
    });

    it('single-flag state is small', () => {
      // 1 version + 2-byte LEB128 mask (bit 13) + 1 flags byte = 4
      // bytes → 6 base64url chars. v2 was 5 bytes / 7 chars.
      expect(encodeBlob({ coordSphere: 'galactic' }).length).toBeLessThanOrEqual(6);
    });

    it('encodes shorter than v1 would for the same scalar fields', () => {
      // v2 quantises fov/mag/smin/smax/span to u8, so a state that
      // exercises all five takes 5 bytes of payload vs 20 in v1. v3
      // additionally shrinks the mask via LEB128: bits 3,4,10,11,12
      // give mask 0x1c18 → 2 LEB128 bytes vs v2's fixed 3.
      const blob = encodeBlob({
        fov: 60, mag: 5, smin: 3, smax: 20, span: 10,
      });
      // 1 version + 2 mask + 5 u8 = 8 bytes → 11 base64url chars
      expect(blob.length).toBeLessThanOrEqual(11);
    });
  });

  describe('LEB128 presence mask (v3)', () => {
    // Verify the wire-format size for representative mask shapes. The
    // numbers here are the bytes-on-wire after base64url; we infer
    // the underlying byte count via the module-scoped blobBytes helper.

    it('low-bit-only mask (cam, bit 0) fits in 1 byte', () => {
      // cam = bit 0; cam=[0,0,3.7] → sub-mask 0x04 + z f32 = 5 byte
      // payload. 1 ver + 1 mask + 5 payload = 7 bytes total.
      const blob = encodeBlob({ cam: [0, 0, 3.7] });
      expect(blobBytes(blob)).toBe(7);
    });

    it('mid-bit mask (flags, bit 13) needs 2 bytes', () => {
      // bit 13 = 0x002000; LEB128 groups bits 0-6 (=0) and 7-13 (=64)
      // → 2 bytes (0x80, 0x40). 1 ver + 2 mask + 1 flags = 4 bytes.
      const blob = encodeBlob({ coordSphere: 'galactic' });
      expect(blobBytes(blob)).toBe(4);
    });

    it('high-bit mask (worldOffset, bit 20) needs 3 bytes', () => {
      // bit 20 = 0x100000; LEB128 groups (0, 0, 64) → 3 bytes. Same
      // as v2's fixed u24 — no regression for far-from-Sol anchors.
      // worldOffset payload = 1 sub-mask + 12 components = 13 bytes.
      const blob = encodeBlob({ worldOffset: [1, 2, 3] });
      expect(blobBytes(blob)).toBe(1 + 3 + 13);
    });

    it('round-trips a mask with both low and high bits', () => {
      // cam (bit 0) + worldOffset (bit 20) — varint must encode
      // both groups correctly and the decoder must recover the mask
      // before stepping through fields.
      const view = { cam: [1, 2, 3] as [number, number, number], worldOffset: [10, 20, 30] as [number, number, number] };
      const { view: out } = roundtrip(view);
      expect(out.cam).toEqual([1, 2, 3]);
      expect(out.worldOffset).toEqual([10, 20, 30]);
    });

    it('rejects a v3 blob whose varint mask runs past the buffer end', () => {
      // Version=3, then a continuation byte (0x80) with no follow-up
      // — readVarint should throw rather than read past the buffer.
      const blob = btoa('\x03\x80').replace(/=+$/, '');
      expect(() => decodeBlob(blob)).toThrow(/Varint runs past blob end/);
    });
  });

  describe('vec3 sub-mask elision byte budgets (v3)', () => {
    // The headline win of v3 is per-component vec3 elision. The cam
    // case is covered by the "emits the headline 10-char" test above;
    // these tests pin the exact byte counts for tgt, up, and
    // worldOffset partial-divergence cases so a future change that
    // flips a default constant or breaks the strict-equality predicate
    // can't silently regress the saving to zero with all other tests
    // still green.

    it('emits one f32 for tgt=[5,0,0] (default y/z elided)', () => {
      // 1 ver + 1 mask (bit 1) + 1 sub + 4 x = 7 bytes → 10 chars.
      const blob = encodeBlob({ tgt: [5, 0, 0] });
      expect(blobBytes(blob)).toBe(7);
      const { view } = decodeBlob(blob);
      expect(view.tgt).toEqual([5, 0, 0]);
    });

    it('emits two f32s for an up matching the default in y only', () => {
      // up's per-key default is galactic north — y matches, x and z diverge.
      // 1 ver + 1 mask (bit 2) + 1 sub + 8 (x,z) = 11 bytes → 15 chars.
      const up: [number, number, number] = [1, GN_UP[1], 1];
      const blob = encodeBlob({ up });
      expect(blobBytes(blob)).toBe(11);
      const { view } = decodeBlob(blob);
      expect(view.up).toEqual(up);
    });

    it('emits one f32 for worldOffset=[100,0,0] (default y/z elided)', () => {
      // worldOffset is at bit 20 → outer mask is 3 LEB128 bytes (high
      // group). 1 ver + 3 mask + 1 sub + 4 x = 9 bytes → 12 chars.
      const blob = encodeBlob({ worldOffset: [100, 0, 0] });
      expect(blobBytes(blob)).toBe(9);
      const { view } = decodeBlob(blob);
      expect(view.worldOffset).toEqual([100, 0, 0]);
    });

    it('emits two f32s for worldOffset=[100,200,0] (default z elided)', () => {
      // 1 ver + 3 mask + 1 sub + 8 (x,y) = 13 bytes → 18 chars.
      const blob = encodeBlob({ worldOffset: [100, 200, 0] });
      expect(blobBytes(blob)).toBe(13);
      const { view } = decodeBlob(blob);
      expect(view.worldOffset).toEqual([100, 200, 0]);
    });

    it('decoder ignores reserved high 5 bits of vec3 sub-mask', () => {
      // The wire format uses low 3 bits of the sub-mask for component
      // divergence and reserves bits 3-7 for forward-compat. A hand-
      // edited or future-encoder blob that sets reserved bits should
      // still decode the low 3 bits correctly. Build a v3 blob with
      // cam sub-mask 0xF9 (binary 11111001 — low bit 0 set for x,
      // y/z clear, high bits 3-7 all set as reserved) and assert cam
      // decodes as [x, default_y, default_z].
      const camX = 7.5;
      const ab = new ArrayBuffer(7);
      const dv = new DataView(ab);
      dv.setUint8(0, 3);     // version
      dv.setUint8(1, 0x01);  // LEB128 mask: bit 0 (cam) only
      dv.setUint8(2, 0xF9);  // sub-mask: low bit 0 set + all reserved
      dv.setFloat32(3, camX, true);
      const bytes = new Uint8Array(ab);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      const blob = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const { view, version } = decodeBlob(blob);
      expect(version).toBe(3);
      expect(view.cam![0]).toBeCloseTo(camX, 5);
      expect(view.cam![1]).toBe(0);   // navigate-default y
      expect(view.cam![2]).toBe(30);  // navigate-default z
    });
  });

  describe('bit-21 t (Float64 wall-clock)', () => {
    // The `t` field is wired in v2/v3 but never emitted by
    // `currentStateOf` until the time-scrubber
    // flips on emission (gated on isLive). Pin the round-trip path
    // now so a regression in float64 LE write/read won't surface
    // only at nmu's first emission.

    it('round-trips a float64 t through encodeBlob/decodeBlob', () => {
      const t = 1234567890.123456;
      const { view, version } = roundtrip({ t });
      expect(version).toBe(4);
      expect(view.t).toBe(t);
    });

    it('emits 8 bytes for t (1 ver + 4 mask + 8 t = 13)', () => {
      // Bit 21 sits in LEB128 group 3 (bits 21-27), so the mask costs
      // 4 bytes — one more than v2's flat u24. The bead's design
      // comment calls this out explicitly: "bit 21 (t) is the only
      // field that costs an extra byte vs u24, and it doesn't emit
      // yet (gated on the time-scrubber)".
      const blob = encodeBlob({ t: 0 });
      expect(blobBytes(blob)).toBe(13);
    });

    it('does not occupy bit 21 when t is undefined', () => {
      // The presence guard (`v.t !== undefined`) keeps an empty view
      // at the 2-byte minimum (1 ver + 1 LEB128 empty mask).
      expect(blobBytes(encodeBlob({}))).toBe(2);
    });

    it('round-trips t alongside cam (mixed low + high bits)', () => {
      const t = 9876543210.5;
      const view: DecodedView = { cam: [0, 0, 3.7], t };
      const { view: out, version } = roundtrip(view);
      expect(version).toBe(4);
      expect(out.cam![2]).toBeCloseTo(3.7, 5);
      expect(out.t).toBe(t);
    });
  });

  describe('LEB128 helpers (writeVarint / readVarint / varintLen)', () => {
    // The varint is the only piece of v3 that doesn't have a fixed-
    // size analogue in v1 or v2. Direct unit coverage of write/read
    // symmetry and varintLen consistency makes the helpers' contract
    // load-bearing — a future change that drifts varintLen from
    // writeVarint's actual byte count would silently mis-size the
    // encodeBlob buffer, but the round-trip suite above would only
    // catch that for masks the suite happens to exercise.

    const REPRESENTATIVE_MASKS = [
      0,
      1,
      0x7f,
      0x80,
      0x3fff,
      0x4000,
      0x1fffff,
      0x200000,
      0xfffffff,
      0x10000000,
      0xffffffff,
    ];

    it('write→read round-trip is exact for representative masks', () => {
      for (const m of REPRESENTATIVE_MASKS) {
        const buf = new ArrayBuffer(5);
        const dv = new DataView(buf);
        const written = writeVarint(dv, 0, m);
        const { val, bytes } = readVarint(dv, 0, 5);
        expect(val).toBe(m >>> 0);
        expect(bytes).toBe(written);
      }
    });

    it('varintLen agrees with writeVarint for every representative mask', () => {
      for (const m of REPRESENTATIVE_MASKS) {
        const buf = new ArrayBuffer(5);
        const dv = new DataView(buf);
        const written = writeVarint(dv, 0, m);
        expect(varintLen(m)).toBe(written);
      }
    });

    it('empty mask writes exactly 1 byte', () => {
      // The 1-byte minimum is what makes empty-state URLs cheaper than
      // v2 (which paid a fixed 3-byte u24 mask).
      expect(varintLen(0)).toBe(1);
      const buf = new ArrayBuffer(5);
      const dv = new DataView(buf);
      expect(writeVarint(dv, 0, 0)).toBe(1);
      expect(dv.getUint8(0)).toBe(0); // continuation bit clear, payload 0
    });

    it('rejects a varint longer than 5 bytes (shift >= 32 guard)', () => {
      // A varint with 6 continuation bytes would imply >= 35 bits of
      // payload — readVarint must throw rather than overflow into
      // adjacent fields.
      const buf = new Uint8Array(6).fill(0xFF);
      buf[5] = 0x7F; // last byte clears continuation
      const dv = new DataView(buf.buffer);
      expect(() => readVarint(dv, 0, 6)).toThrow(/Varint mask too long/);
    });

    it('readVarint rejects a buffer that ends mid-varint', () => {
      // A continuation byte (0x80) at the last position with no
      // follow-up — readVarint must surface the truncation rather
      // than silently return a value built from out-of-bounds bytes.
      const buf = new Uint8Array([0x80]);
      const dv = new DataView(buf.buffer);
      expect(() => readVarint(dv, 0, 1)).toThrow(/Varint runs past blob end/);
    });
  });

  describe('golden-blob corpus — frozen v1/v2/v3 decoders', () => {
    // Real `?v=` blobs captured from the shipped coders (v3 via the
    // production encoder, v1/v2 hand-encoded and validated through the
    // production decoder at capture time), paired with their exact
    // decoded views. These pin the FROZEN per-version FIELDS arrays
    // byte-for-byte: any change that alters how a legacy blob decodes
    // — a helper edit, a field-shape change leaking across versions —
    // fails here. Float components are the post-float32 values the
    // decoder actually produces. NEVER regenerate these entries to
    // make a failure pass; a failure means legacy decoding broke.
    const GOLDEN_CORPUS: { version: number; label: string; blob: string; view: DecodedView }[] = [
      {
        version: 3,
        label: 'realistic share: cam + fov + mag + HIP focus + grid',
        blob: 'A5nAAQcAAEhCAACgwQAAyEIjVQFdfoA',
        view: { cam: [50, -20, 100], fov: 45, mag: 6.5, coordSphere: 'galactic', focus: { kind: 'hip', id: 32349 } },
      },
      {
        version: 3,
        label: 'observe + chart + POIs + tilted up',
        blob: 'A4TAIQOBBDU_gQQ1P2B-ZIEDXX4AfmQBVW0A',
        view: { up: [0.707099974155426, 0.707099974155426, 0], mode: 'observe', chart: true, focus: { kind: 'hip', id: 91262 }, pois: [32349, 91262, 27989] },
      },
      {
        version: 3,
        label: 'index focus + HIP to-vector',
        blob: 'A4CAA0DiAcL_gA',
        view: { focus: { kind: 'index', id: 123456 }, to: { kind: 'hip', id: 65474 } },
      },
      {
        version: 3,
        label: 'cloud focus + cloud to-vector',
        blob: 'A4GADATNzGxADAM',
        view: { cam: [0, 0, 3.700000047683716], cloud: 12, toc: 3 },
      },
      {
        version: 3,
        label: 'cleared focus + worldOffset anchor + local cam/tgt',
        blob: 'A4OAUAeETfg1dScvts2sJTgBAACgQAdmZk5CAICAQ83MFsI',
        view: { cam: [0.0000018499999896448571, -0.000002609999910418992, 0.00003949999882024713], tgt: [5, 0, 0], focus: 'cleared', worldOffset: [51.599998474121094, 257, -37.70000076293945] },
      },
      {
        version: 3,
        label: 'pinned t + cam',
        blob: 'A4GAgAEEzcxsQAAAIMD7GtpB',
        view: { cam: [0, 0, 3.700000047683716], t: 1751904000.5 },
      },
      {
        version: 3,
        label: 'kitchen sink scalars + flags',
        blob: 'A-h_NGQAIAP-AQEpDyAMmg',
        view: { fov: 62, dmin: 100, dmax: 800, spect: 510, preset: 'binoculars', con: 41, smin: 2.5, smax: 18, span: 8, showHud: true, showConstellation: false, showMilkyway: false, unit: 'pc' },
      },
      {
        version: 2,
        label: 'v2: cam + fov + mag + HIP focus',
        blob: 'AhlAAAAASEIAAKDBAADIQiNVXX6A',
        view: { cam: [50, -20, 100], fov: 45, mag: 6.5, focus: { kind: 'hip', id: 32349 } },
      },
      {
        version: 2,
        label: 'v2: observe + index focus + POIs',
        blob: 'AgBgCCBA4gEDXX4AfmQBVW0A',
        view: { mode: 'observe', focus: { kind: 'index', id: 123456 }, pois: [32349, 91262, 27989] },
      },
      {
        version: 2,
        label: 'v2: cloud focus + toc + worldOffset',
        blob: 'AgAAEwwDZmZOQgCAgEPNzBbC',
        view: { cloud: 12, toc: 3, worldOffset: [51.599998474121094, 257, -37.70000076293945] },
      },
      {
        version: 2,
        label: 'v2: cleared focus + pinned t',
        blob: 'AgAAJAAAIMD7GtpB',
        view: { focus: 'cleared', t: 1751904000.5 },
      },
      {
        version: 1,
        label: 'v1: cam + fov + mag + HIP focus',
        blob: 'ARlAAAAAAEhCAACgwQAAyEIAADRCAADQQF1-AIA',
        view: { cam: [50, -20, 100], fov: 45, mag: 6.5, focus: { kind: 'hip', id: 32349 } },
      },
      {
        version: 1,
        label: 'v1: observe + index focus + cloud + POIs',
        blob: 'AQBgCQAgQOIBAAcAAmQAAADIAAAA',
        view: { mode: 'observe', focus: { kind: 'index', id: 123456 }, cloud: 7, pois: [100, 200] },
      },
    ];

    for (const entry of GOLDEN_CORPUS) {
      it(`decodes byte-identically: ${entry.label}`, () => {
        const { view, version } = decodeBlob(entry.blob);
        expect(version).toBe(entry.version);
        expect(view).toEqual(entry.view);
      });
    }
  });

  describe('legacy → v4 migration (decode → apply → re-encode)', () => {
    // applyFromUrl detects `decoded.version !== SCHEMA_VERSION` and
    // schedules a debounced writeUrl that re-encodes the *live state*
    // as v4 — that apply-then-re-encode pair IS the docs/sid.md § 9.4
    // migration table. These tests drive it end-to-end over a stateful
    // mock Stellata: decode a legacy blob, applyDecodedView, then
    // currentStateOf → encodeBlob and assert the v4 wire.

    it('HIP focus migrates exactly: hip → index → sid', () => {
      const blob = buildV2Blob(1 << 14, new Uint8Array(u24((32349 | 0x800000) >>> 0)));
      const { state, re } = migrate(blob);
      expect(state.focusedStar).toBe(1);
      expect(re.version).toBe(4);
      expect(re.view.focus).toEqual({ kind: 'sid', id: 101 });
    });

    it('unknown HIP focus drops to the default (Sol, omitted)', () => {
      const blob = buildV2Blob(1 << 14, new Uint8Array(u24((555 | 0x800000) >>> 0)));
      const { state, re } = migrate(blob);
      expect(state.focusedStar).toBe(0);
      expect(re.view.focus).toBeUndefined();
    });

    it('index focus freezes best-effort to the current-build sid', () => {
      const blob = buildV2Blob(1 << 14, new Uint8Array(u24(2)));
      const { state, re } = migrate(blob);
      expect(state.focusedStar).toBe(2);
      expect(re.view.focus).toEqual({ kind: 'sid', id: 102 });
    });

    it('out-of-range index focus drops to the default', () => {
      const blob = buildV2Blob(1 << 14, new Uint8Array(u24(50)));
      const { re } = migrate(blob);
      expect(re.view.focus).toBeUndefined();
    });

    it('legacy cloud focus + toc fold into universal sid refs', () => {
      const blob = buildV2Blob((1 << 16) | (1 << 17), new Uint8Array([1, 0]));
      const { state, re } = migrate(blob);
      expect(state.focusedCloud).toBe(1);
      expect(state.vectorToCloud).toBe(0);
      expect(re.view.focus).toEqual({ kind: 'sid', id: 202 });
      expect(re.view.to).toEqual({ kind: 'sid', id: 201 });
      expect(re.view.cloud).toBeUndefined();
      expect(re.view.toc).toBeUndefined();
    });

    it('HIP to-vector migrates to a star sid', () => {
      const blob = buildV2Blob(1 << 15, new Uint8Array(u24((91262 | 0x800000) >>> 0)));
      const { state, re } = migrate(blob);
      expect(state.vectorTo).toBe(3);
      expect(re.view.to).toEqual({ kind: 'sid', id: 103 });
    });

    it('legacy HIP POIs migrate per entry; unresolvable HIPs drop', () => {
      // observe flag (bit 5 of the flags byte) + POIs [32349, 91262,
      // 555]; 555 resolves to nothing in this catalog and drops.
      const payload = new Uint8Array([
        1 << 5,
        3, ...u24(32349), ...u24(91262), ...u24(555),
      ]);
      const blob = buildV2Blob((1 << 13) | (1 << 19), payload);
      const { state, re } = migrate(blob);
      expect(state.mode).toBe('observe');
      expect(state.pois).toEqual([{ kind: 'star', idx: 1 }, { kind: 'star', idx: 3 }]);
      expect(re.view.poiSids).toEqual([101, 103]);
      expect(re.view.pois).toBeUndefined();
    });

    it('v1 blobs migrate through the same path', () => {
      const payload = new Uint8Array(4);
      new DataView(payload.buffer).setUint32(0, (32349 | 0x80000000) >>> 0, true);
      const blob = buildV1Blob(1 << 14, payload);
      const { state, re } = migrate(blob);
      expect(state.focusedStar).toBe(1);
      expect(re.view.focus).toEqual({ kind: 'sid', id: 101 });
    });

    it('a v4 sid focus applies and re-encodes stably', () => {
      const blob = encodeBlob({ focus: { kind: 'sid', id: 103 } });
      const { state, re } = migrate(blob);
      expect(state.focusedStar).toBe(3);
      expect(re.view.focus).toEqual({ kind: 'sid', id: 103 });
    });

    it('an unknown v4 sid expires silently, leaving the rest applied', () => {
      const blob = encodeBlob({ focus: { kind: 'sid', id: 999 }, fov: 62 });
      const { state, re } = migrate(blob);
      expect(state.focusedStar).toBe(0); // untouched default
      expect(re.view.focus).toBeUndefined();
    });

    it('a pending sid applies as a deferred intent when its domain attaches', () => {
      // Cloud domain registered but not attached at apply time — the
      // docs/sid.md § 8 late-artifact contract. The focus intent must
      // fire on the attach, not throw or drop.
      const sidResolver = new SidResolver(['star', 'cloud']);
      sidResolver.attach('star', arrayDomain(STAR_SIDS));
      const idMaps = makeIdMaps({ sidResolver });
      const { stellata, state } = makeStatefulStellata();
      const blob = encodeBlob({ focus: { kind: 'sid', id: 202 } });
      applyDecodedView(stellata, decodeBlob(blob).view, idMaps);
      expect(state.focusedCloud).toBeNull();
      sidResolver.attach('cloud', arrayDomain(CLOUD_SIDS));
      expect(state.focusedCloud).toBe(1);
    });

    it('planet focus round-trips: sid on the wire, flat Target index in the runtime', () => {
      // The planet SID domain is keyed planet-within-host; the Target
      // currency is the body field's flat instance index.
      const PLANET_SIDS = [901, 902, 903];
      const FLAT_OFFSET = 5;
      const sidResolver = new SidResolver(['star', 'planet']);
      sidResolver.attach('star', arrayDomain(STAR_SIDS));
      sidResolver.attach('planet', arrayDomain(PLANET_SIDS));
      const idMaps = makeIdMaps({
        sidResolver,
        planet: planetTranslation(PLANET_SIDS.length, FLAT_OFFSET),
      });
      // Encoder: focused planet at flat idx 7 → domain 2 → sid 903.
      const tx = makeStatefulStellata();
      tx.state.focusedStar = null;
      tx.state.focusedPlanet = 7;
      const view = currentStateOf(tx.stellata, idMaps);
      expect(view.focus).toEqual({ kind: 'sid', id: 903 });
      // Receiver: the sid resolves to domain 2 and translates back to
      // the flat index before the flyTo dispatch.
      const rx = makeStatefulStellata();
      applyDecodedView(rx.stellata, decodeBlob(encodeBlob(view)).view, idMaps);
      expect(rx.state.focusedPlanet).toBe(7);
      expect(rx.state.focusedStar).toBeNull();
    });

    it('probe focus round-trips with no index translation, on both decode branches', () => {
      // Unlike the planet domain, a probe's resolver localIndex IS its
      // Target idx — so the translation legs stay null here and a miss in
      // them can't be what carries the focus.
      const PROBE_SIDS = [330277, 330278];
      const sidResolver = new SidResolver(['star', 'probe']);
      sidResolver.attach('star', arrayDomain(STAR_SIDS));
      sidResolver.attach('probe', arrayDomain(PROBE_SIDS));
      const idMaps = makeIdMaps({ sidResolver });
      const tx = makeStatefulStellata();
      tx.state.focusedStar = null;
      tx.state.focusedProbe = 1;
      const view = currentStateOf(tx.stellata, idMaps);
      expect(view.focus).toEqual({ kind: 'sid', id: 330278 });

      // No camera params on the wire → the flyTo branch.
      const flyRx = makeStatefulStellata();
      applyDecodedView(flyRx.stellata, decodeBlob(encodeBlob(view)).view, idMaps);
      expect(flyRx.state.focusedProbe).toBe(1);
      expect(flyRx.state.focusedStar).toBeNull();

      // With a scrubbed pose the decoder takes setOrbitTarget instead, so
      // both branches need pinning.
      const snapRx = makeStatefulStellata();
      applyDecodedView(
        snapRx.stellata,
        decodeBlob(encodeBlob({ ...view, cam: [1, 2, 3] })).view,
        idMaps,
      );
      expect(snapRx.state.focusedProbe).toBe(1);
    });

    it('mixed star + planet POIs round-trip through the untagged SID list', () => {
      const PLANET_SIDS = [901, 902, 903];
      const FLAT_OFFSET = 5;
      const sidResolver = new SidResolver(['star', 'planet']);
      sidResolver.attach('star', arrayDomain(STAR_SIDS));
      sidResolver.attach('planet', arrayDomain(PLANET_SIDS));
      const idMaps = makeIdMaps({
        sidResolver,
        planet: planetTranslation(PLANET_SIDS.length, FLAT_OFFSET),
      });
      // Encoder: star idx 1 → its sid; planet flat idx 6 → domain 1 →
      // sid 902. Order preserved.
      const tx = makeStatefulStellata();
      tx.state.pois = [
        { kind: 'star', idx: 1 },
        { kind: 'planet', idx: 6 },
      ];
      const view = currentStateOf(tx.stellata, idMaps);
      expect(view.poiSids).toEqual([STAR_SIDS[1], 902]);
      // Receiver: both kinds restore, planet sid translated back to the
      // flat Target index.
      const rx = makeStatefulStellata();
      applyDecodedView(rx.stellata, decodeBlob(encodeBlob(view)).view, idMaps);
      expect(rx.state.pois).toEqual([
        { kind: 'star', idx: 1 },
        { kind: 'planet', idx: 6 },
      ]);
    });

    it('a planet sid with no attached body-field host drops the focus, rest applies', () => {
      const PLANET_SIDS = [901];
      const sidResolver = new SidResolver(['star', 'planet']);
      sidResolver.attach('star', arrayDomain(STAR_SIDS));
      sidResolver.attach('planet', arrayDomain(PLANET_SIDS));
      const idMaps = makeIdMaps({ sidResolver }); // host never attached
      const { stellata, state } = makeStatefulStellata();
      const blob = encodeBlob({ focus: { kind: 'sid', id: 901 }, mag: 9 });
      applyDecodedView(stellata, decodeBlob(blob).view, idMaps);
      expect(state.focusedPlanet).toBeNull();
      expect(state.focusedStar).toBe(0); // untouched default
    });
  });

  describe('membership re-index survival', () => {
    // The catalogue-driver swap (docs/catalog-driver.md) re-drives
    // membership from Gaia DR3, which re-sorts every row. A shared link
    // has to land on the same STAR across that, not the same row — the
    // property SIDs exist for and the reason star refs stopped encoding
    // row indices. Build A shares the link, build B receives it.
    const buildA = () => makeFixtureBuild();
    const buildB = () => makeFixtureBuild(REINDEXED_STAR_SIDS, REINDEXED_STAR_HIPS);

    // Share the live state of a build-A session, as writeUrl would.
    function shareFrom(setup: (s: ReturnType<typeof makeStatefulStellata>['state']) => void) {
      const tx = makeStatefulStellata();
      setup(tx.state);
      return encodeBlob(currentStateOf(tx.stellata, buildA()));
    }

    it('a no-HIP star focus lands on the same star after a re-index', () => {
      // Row 2 in build A, row 0 in build B — and no HIP, so v1–v3 had
      // nothing but the row index to encode it with.
      const blob = shareFrom((s) => { s.focusedStar = 2; });
      expect(decodeBlob(blob).view.focus).toEqual({ kind: 'sid', id: 102 });
      const { state } = migrate(blob, buildB());
      expect(state.focusedStar).toBe(0);
    });

    it('the legacy index ref it replaced lands on a DIFFERENT star', () => {
      // Same star, encoded the pre-v4 way: a bare row index. Build B's
      // row 2 is Sol, so the link silently retargets — the drift the SID
      // ref removes.
      const legacy = buildV2Blob(1 << 14, new Uint8Array(u24(2)));
      const { state } = migrate(legacy, buildB());
      expect(state.focusedStar).toBe(2);
      expect(REINDEXED_STAR_SIDS[2]).toBe(SOL_SID);
    });

    it('vector-to and POIs survive the same re-index', () => {
      const blob = shareFrom((s) => {
        s.focusedStar = null;
        s.vectorTo = 3;
        s.pois = [{ kind: 'star', idx: 2 }, { kind: 'star', idx: 3 }];
      });
      const { state } = migrate(blob, buildB());
      expect(state.vectorTo).toBe(1);
      expect(state.pois).toEqual([{ kind: 'star', idx: 0 }, { kind: 'star', idx: 1 }]);
    });

    it('a star dropped from the new membership expires without moving the rest', () => {
      // Build C drops sid 102 entirely (a record the swap retires). Its
      // focus ref resolves to nothing, so the focus is skipped rather
      // than landing on whatever now occupies the row — and the POI whose
      // sid survived still applies.
      const blob = shareFrom((s) => {
        s.focusedStar = 2;
        s.pois = [{ kind: 'star', idx: 3 }];
      });
      const buildC = makeFixtureBuild([SOL_SID, 101, 103], [0, 32349, 91262]);
      const { stellata, state } = makeStatefulStellata();
      applyDecodedView(stellata, decodeBlob(blob).view, buildC);
      expect(state.focusedStar).toBe(0); // untouched Sol default
      expect(state.pois).toEqual([{ kind: 'star', idx: 2 }]);
    });
  });

  describe('startUrlSync per-frame change-detector threshold', () => {
    // The per-component trigger threshold is min(EPS, mag * EPS_REL),
    // floored at EPS_FLOOR. This pins the regime boundaries so a
    // future tweak that flips a constant doesn't silently re-introduce
    // the "1e-3 pc absolute everywhere" bug — at solar-system scales
    // (cam at AU magnitudes) that threshold equals ~206 AU and a zoom-
    // out from the first-load 5 AU park doesn't trip any axis until
    // the camera has moved hundreds of AU.

    it('caps at EPS = 1e-3 pc for scene-scale magnitudes', () => {
      // 0.1 pc (where mag * 0.01 = 1e-3 = EPS) is the boundary.
      expect(frameTriggerEps(0.1)).toBe(1e-3);
      expect(frameTriggerEps(30)).toBe(1e-3);     // navigate-default cam
      expect(frameTriggerEps(8500)).toBe(1e-3);   // ~Sol-to-GC distance
      expect(frameTriggerEps(1e6)).toBe(1e-3);    // ~Andromeda
    });

    it('scales to 1% of magnitude at solar-system scales', () => {
      // At the first-load 5 AU park, a zoom of ~0.05 AU per frame
      // crosses the per-axis threshold for the dominant component —
      // far below the prior 206-AU absolute threshold.
      const fiveAU = 5 * AU_PC;
      expect(frameTriggerEps(fiveAU)).toBeCloseTo(fiveAU * 0.01, 12);
      const oneAU = 1 * AU_PC;
      expect(frameTriggerEps(oneAU)).toBeCloseTo(oneAU * 0.01, 12);
    });

    it('floors at 1e-9 pc to avoid noise-triggering at the origin', () => {
      // observe-mode cam pins to [0, 0, 0]. A magnitude of zero with
      // no floor would let any float-noise tick trigger a URL write.
      expect(frameTriggerEps(0)).toBe(1e-9);
      // Magnitudes below the EPS_REL crossover (1e-9 / 0.01 = 1e-7 pc
      // ≈ 0.02 AU) clamp to the floor.
      expect(frameTriggerEps(1e-8)).toBe(1e-9);
      expect(frameTriggerEps(1e-7)).toBeCloseTo(1e-9, 12);
    });

    it('demonstrates the zoom-out fix at first-load 5 AU magnitude', () => {
      // First-load parks the camera at 5 AU on a ~(-0.063, 0.799,
      // 0.600) unit vector. The dominant component is y at ~0.8 of
      // magnitude. Threshold for y to trip = eps / |y_unit|.
      // Pre-fix: eps = 1e-3 pc absolute → trip distance = 1e-3 /
      //   0.799 ≈ 1.25e-3 pc ≈ 258 AU.
      // Post-fix: eps = mag * 0.01 = 5 AU * 0.01 = 0.05 AU per axis,
      //   so the y-component trips after a zoom of 0.05 / 0.8 ≈ 0.06
      //   AU — orders of magnitude finer.
      const fiveAU = 5 * AU_PC;
      const eps = frameTriggerEps(fiveAU);
      const yUnit = 0.799;
      const tripDistanceAU = eps / yUnit / AU_PC;
      // At least 1000× tighter than the prior 258 AU — exact value
      // here is ~0.0626 AU.
      expect(tripDistanceAU).toBeLessThan(0.1);
    });
  });
});

// Wiring around the pure path helpers (share-path-pure.test.ts covers the
// parsing itself): the load-time junk-URL reset, the legacy query→path
// rewrite, and the per-frame pinned-`t` detector — the 4bq1 fix, which a
// scrub on a still camera exercises. Needs mocked location/history/window
// because url-state.ts reads/writes them directly in the node test env.
describe('address-bar transport (applyFromUrl / writeUrl / startUrlSync)', () => {
  const syncIdMaps = () => makeIdMaps({ starSids: [100] });

  // Live wall-clock t (isLive ⇒ omitted from the blob); a scrubbed t sits
  // well outside the 1 s live tolerance.
  const liveT = () => Date.now() / 1000;
  const scrubbedT = () => Date.now() / 1000 - 100_000;

  function makeSyncStellata() {
    const state = {
      fov: DEFAULT_FOV,
      t: liveT(),
      focusedStar: 0 as number | null, // Sol → default focus, omitted
      mode: 'navigate' as 'navigate' | 'observe',
      pois: [] as Target[],
      transition: false,
    };
    const cam = { position: mockVec3(0, 0, 30), up: mockVec3(...GN_UP) };
    const controls = { target: mockVec3(0, 0, 0), update() {} };
    const referenceUp = referenceUpStub();
    const handlers: Record<string, Array<(p: unknown) => void>> = { frame: [], state: [] };
    const stub: Partial<Stellata> = {
      getFilter: () => ({ ...DEFAULT_FILTER }),
      setFilter: () => {},
      applyMagnitudePreset: () => {},
      getCameraFov: () => state.fov,
      setCameraFov: (f) => { state.fov = f; },
      getT: () => state.t,
      setT: (t) => { if (t !== null) state.t = t; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getWorldOffset: () => mockVec3() as any,
      setWorldOffset: () => {},
      getFocusedStar: () => state.focusedStar,
      getFocusedTarget: () => (state.focusedStar !== null ? { kind: 'star', idx: state.focusedStar } : null),
      getVectorTarget: () => null,
      getPois: () => state.pois,
      setPois: (l) => { state.pois = [...l]; },
      getCameraMode: () => state.mode,
      setCameraMode: (m) => { state.mode = m; },
      focusStar: (idx) => { state.focusedStar = idx; },
      setOrbitTarget: () => {},
      unfocus: () => { state.focusedStar = null; },
      flyTo: () => {},
      setVector: () => {},
      isCameraTransitionActive: () => state.transition,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      camera: cam as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      controls: controls as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      referenceUp: referenceUp as any,
    };
    stub.on = ((name: string, h: (p: unknown) => void) => {
      handlers[name].push(h);
      return () => {};
    }) as unknown as Stellata['on'];
    return {
      stellata: stub as Stellata,
      state, cam, controls, referenceUp,
      frame: () => handlers.frame.forEach((h) => h(undefined)),
    };
  }

  // history.replaceState mutates the mocked location so writeUrl's
  // "already at this URL?" idempotence check observes the rewrite.
  function installUrl(initial: string) {
    const loc = { pathname: '/', search: '' };
    const set = (url: string) => {
      const q = url.indexOf('?');
      if (q === -1) { loc.pathname = url; loc.search = ''; }
      else { loc.pathname = url.slice(0, q); loc.search = url.slice(q); }
    };
    set(initial);
    const replaceState = vi.fn((_s: unknown, _t: unknown, url: string) => set(url));
    vi.stubGlobal('location', loc);
    vi.stubGlobal('history', { replaceState });
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
      clearTimeout: (id: number) => clearTimeout(id),
    });
    return { loc, replaceState };
  }

  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  describe('applyFromUrl junk reset', () => {
    it('strips a bogus non-share path back to bare /', () => {
      const { loc, replaceState } = installUrl('/garbage');
      const { stellata } = makeSyncStellata();
      expect(applyFromUrl(stellata, syncIdMaps())).toBe(false);
      expect(replaceState).toHaveBeenCalledWith(null, '', '/');
      expect(loc.pathname).toBe('/');
    });

    it('strips a /v/<blob>/ whose blob will not decode', () => {
      // Single byte 0xFF → version 255, an unknown schema decodeBlob rejects.
      const { loc } = installUrl('/v/_w/');
      const { stellata } = makeSyncStellata();
      expect(applyFromUrl(stellata, syncIdMaps())).toBe(false);
      expect(loc.pathname).toBe('/');
      expect(loc.search).toBe('');
    });

    it('strips a stray/undecodable ?v= query', () => {
      const { loc } = installUrl('/?v=_w');
      const { stellata } = makeSyncStellata();
      expect(applyFromUrl(stellata, syncIdMaps())).toBe(false);
      expect(loc.pathname).toBe('/');
      expect(loc.search).toBe('');
    });

    it('leaves a clean / untouched (no history write)', () => {
      const { replaceState } = installUrl('/');
      const { stellata } = makeSyncStellata();
      expect(applyFromUrl(stellata, syncIdMaps())).toBe(false);
      expect(replaceState).not.toHaveBeenCalled();
    });
  });

  describe('legacy ?v= → canonical /v/<blob>/ rewrite', () => {
    it('rewrites a current-schema query link to the path form after the debounce', () => {
      const blob = encodeBlob({ fov: 90 }); // non-default (DEFAULT_FOV = 50)
      const { loc, replaceState } = installUrl(`/?v=${blob}`);
      const { stellata, state } = makeSyncStellata();
      expect(applyFromUrl(stellata, syncIdMaps())).toBe(true);
      expect(state.fov).toBe(90);
      // Address-bar rewrite is deferred to the shared debounce window.
      expect(replaceState).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(loc.pathname.startsWith('/v/')).toBe(true);
      expect(loc.search).toBe('');
      expect(decodeBlob(loc.pathname.slice(3, -1)).view.fov).toBe(90);
    });
  });

  describe('startUrlSync pinned-t detector (4bq1)', () => {
    it('writes a /v/<blob>/ when time is scrubbed on a still camera', () => {
      const { loc } = installUrl('/');
      const { stellata, state, frame } = makeSyncStellata();
      startUrlSync(stellata, syncIdMaps());
      state.t = scrubbedT();        // scrub without moving the camera
      frame();
      vi.advanceTimersByTime(1000);
      expect(loc.pathname.startsWith('/v/')).toBe(true);
    });

    it('does not write while the live clock advances (t stays live)', () => {
      const { replaceState } = installUrl('/');
      const { stellata, state, frame } = makeSyncStellata();
      startUrlSync(stellata, syncIdMaps());
      state.t = liveT();            // still within the 1 s live tolerance
      frame();
      vi.advanceTimersByTime(1000);
      expect(replaceState).not.toHaveBeenCalled();
    });

    it('does not write scrubbed time while a camera transition is active', () => {
      const { replaceState } = installUrl('/');
      const { stellata, state, frame } = makeSyncStellata();
      startUrlSync(stellata, syncIdMaps());
      state.transition = true;
      state.t = scrubbedT();
      frame();
      vi.advanceTimersByTime(1000);
      expect(replaceState).not.toHaveBeenCalled();
    });

    it('still writes on a camera move (detector refactor intact)', () => {
      const { loc } = installUrl('/');
      const { stellata, cam, frame } = makeSyncStellata();
      startUrlSync(stellata, syncIdMaps());
      cam.position.set(0, 0, 0);    // off the [0,0,30] navigate default
      frame();
      vi.advanceTimersByTime(1000);
      expect(loc.pathname.startsWith('/v/')).toBe(true);
    });
  });
});
