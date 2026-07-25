import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  cullDistancePc,
  PlanetBodyField,
} from './planet-body-field';
import type {
  ChartDiscUniforms,
  PerceptualDiscUniforms,
} from '../../star-pipeline/perceptual-disc-uniforms';
import { chartDiscPxForAppMag } from '../../chart-mode/chart-disc-pure';
import { AU_PC, KM_PC, R_SUN_PC } from '../../util/astronomy-constants';
import type { PlanetSystem, Planet } from '../planet-system';
import {
  MERCURY_PHASE,
  SATURN_PHASE,
  VENUS_PHASE,
  alphaZeroPhaseFactor,
  phaseFactorFor,
} from '../phase-function';
import { planetApparentMagnitude } from '../perceptual-magnitude';
import {
  MESH_FADE_FULL_PX,
  MESH_FADE_MIN_PX,
  meshFadeFromPhysPx,
} from './mesh-crossfade';
import { DIM_FLOOR } from '../../binaries/eclipse-photometry-pure';

function makeSharedUniforms(
  maxAppMag = 6.5,
): PerceptualDiscUniforms & ChartDiscUniforms {
  return {
    uMonochrome: { value: 0 },
    uChartDiscMaxPx: { value: 28 },
    uChartDiscMinPx: { value: 1.5 },
    uChartMagBright: { value: -2 },
    uMaxAppMag: { value: maxAppMag },
    uSizeMin: { value: 2 },
    uSizeMax: { value: 24 },
    uSizeSpan: { value: 8 },
    uSizeKnee: { value: 16 },
    uVisibleThreshold: { value: 0.2 },
    uVisibleK: { value: -Math.log(0.2) },
    uCoreThreshold: { value: 0.4 },
    uDiscardThreshold: { value: 0.02 },
    uDistNMin: { value: 2.2 },
    uDistNMax: { value: 10.0 },
    uLumBiasMin: { value: 1.0 },
    uLumBiasMax: { value: 0.6 },
    uViewport: { value: new THREE.Vector2(800, 600) },
    uPixelRatio: { value: 1 },
    uFovYRad: { value: (60 * Math.PI) / 180 },
  };
}

function makePlanet(overrides: Partial<Planet> = {}): Planet {
  return {
    name: 'Test',
    radiusKm: 1000,
    semiMajorAxisAu: 1,
    eccentricity: 0,
    type: 'rocky',
    colour: [1, 1, 1],
    albedo: 0.5,
    ...overrides,
  };
}

describe('cullDistancePc', () => {
  it('returns zero for a host with no reflectance proxy', () => {
    expect(cullDistancePc(4.83, 0, 6.5)).toBe(0);
  });

  it('reproduces Jupiter-from-Sol naked-eye threshold (~290 AU)', () => {
    // Jupiter: p=0.538, R=69911 km, a=5.203 AU. Sol M=4.83. Naked-eye
    // cutoff 6.5. 290 AU is comfortably sub-parsec (Sol's naked-eye
    // preset stays sub-pc) and within the Standard-mode focus zoom range.
    const aPc = 5.203 * AU_PC;
    const Rpc = 69911 * KM_PC;
    const refl = 0.538 * (Rpc / aPc) ** 2;
    const d = cullDistancePc(4.83, refl, 6.5);
    const dAu = d / AU_PC;
    expect(dAu).toBeGreaterThan(200);
    expect(dAu).toBeLessThan(400);
  });

  it('grows with the magnitude slider (more sensitivity → see further)', () => {
    const aPc = 5.203 * AU_PC;
    const Rpc = 69911 * KM_PC;
    const refl = 0.538 * (Rpc / aPc) ** 2;
    const naked = cullDistancePc(4.83, refl, 6.5);
    const all = cullDistancePc(4.83, refl, 15);
    // Each 5 mag of cutoff = 10× distance.
    const expectedRatio = 10 ** ((15 - 6.5) / 5);
    expect(all / naked).toBeCloseTo(expectedRatio, 3);
  });

  it('shrinks for a fainter host (negative offset on M)', () => {
    // Same planet around an absmag-7 host (much fainter than Sol)
    // gets a smaller cull distance because the host illumination is
    // weaker.
    const aPc = 5.203 * AU_PC;
    const Rpc = 69911 * KM_PC;
    const refl = 0.538 * (Rpc / aPc) ** 2;
    const sunCull = cullDistancePc(4.83, refl, 6.5);
    const fainterCull = cullDistancePc(7.0, refl, 6.5);
    expect(fainterCull).toBeLessThan(sunCull);
  });

  it('verifies the closed-form formula directly', () => {
    // d = 10 pc · sqrt(refl) · 10^((m_max - M_host)/5)
    const M = 4.83;
    const refl = 1e-9;
    const m = 6.5;
    const expected = 10 * Math.sqrt(refl) * 10 ** ((m - M) / 5);
    expect(cullDistancePc(M, refl, m)).toBeCloseTo(expected, 12);
  });
});

describe('PlanetBodyField lifecycle', () => {
  function makePlanetSystem(hostStarIdx = 0, n = 3): PlanetSystem {
    return {
      hostStarIdx,
      planets: Array.from({ length: n }, (_, i) =>
        makePlanet({
          name: `P${i}`,
          semiMajorAxisAu: 1 + i,
          radiusKm: 6000,
        })),
    };
  }

  it('starts empty and stays hidden', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    expect(f.group.visible).toBe(false);
    f.dispose();
  });

  it('attaches a host and grows the geometry instance count', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    f.attachHost(0, makePlanetSystem(0, 3), 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    // group becomes visible; positions buffer holds 3 entries.
    expect(f.group.visible).toBe(true);
    const positions = f.getHostLocalPositions(0);
    expect(positions).not.toBeNull();
    expect(positions!.length).toBe(9); // 3 planets × xyz
    f.dispose();
  });

  it('detachHost clears the host slot and hides the group when empty', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    f.attachHost(0, makePlanetSystem(0, 3), 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    f.detachHost(0);
    expect(f.getHostLocalPositions(0)).toBeNull();
    expect(f.group.visible).toBe(false);
    f.dispose();
  });

  it('recenter shifts hostLocalPos by the new world offset', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    const hostAbs = new THREE.Vector3(1.5, 0, 2.0);
    f.attachHost(0, makePlanetSystem(0, 1), 4.83, R_SUN_PC, hostAbs, 0, 0);
    // Pre-recenter: hostLocalPos = hostAbsPos - (0,0,0) = (1.5, 0, 2.0).
    // Apply recenter to (1.5, 0, 2.0) — host should land at origin.
    f.recenter(new THREE.Vector3(1.5, 0, 2.0));
    // Internal hostLocalPos isn't directly exposed, but we can verify
    // through attachHost behaviour after recenter — re-attach the
    // same host with the same absPos and confirm idempotence.
    f.attachHost(0, makePlanetSystem(0, 1), 4.83, R_SUN_PC, hostAbs, 0, 0);
    // Visible (re-attached fresh).
    expect(f.group.visible).toBe(true);
    f.dispose();
  });

  it('getHostLocalPositionInto returns hostAbs − worldOffset and tracks recenter', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    const hostAbs = new THREE.Vector3(1.5, 0, 2.0);
    f.attachHost(0, makePlanetSystem(0, 1), 4.83, R_SUN_PC, hostAbs, 0, 0);
    const out = new THREE.Vector3();
    expect(f.getHostLocalPositionInto(0, out)).toBe(true);
    expect(out.x).toBeCloseTo(1.5, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(2.0, 12);
    // Recenter onto a planet-like offset: host local pos shifts by it.
    f.recenter(new THREE.Vector3(1.0, 0, 2.0));
    expect(f.getHostLocalPositionInto(0, out)).toBe(true);
    expect(out.x).toBeCloseTo(0.5, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(0, 12);
    expect(f.getHostLocalPositionInto(9, out)).toBe(false);
    f.dispose();
  });

  it('handles multiple hosts in one field', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    f.attachHost(0, makePlanetSystem(0, 2), 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    f.attachHost(1, makePlanetSystem(1, 4), 4.83, R_SUN_PC, new THREE.Vector3(0.5, 0, 0), 0, 0);
    expect(f.getHostLocalPositions(0)!.length).toBe(6);
    expect(f.getHostLocalPositions(1)!.length).toBe(12);
    f.dispose();
  });

  it('detaching the first host compacts the buffer; the second still resolves', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    f.attachHost(0, makePlanetSystem(0, 2), 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    f.attachHost(1, makePlanetSystem(1, 3), 4.83, R_SUN_PC, new THREE.Vector3(0.5, 0, 0), 0, 0);
    f.detachHost(0);
    const stillThere = f.getHostLocalPositions(1);
    expect(stillThere).not.toBeNull();
    expect(stillThere!.length).toBe(9);
    expect(f.group.visible).toBe(true);
    f.dispose();
  });

  it('attachHost is idempotent — re-attach replaces in place', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    f.attachHost(0, makePlanetSystem(0, 3), 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    f.attachHost(0, makePlanetSystem(0, 5), 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    expect(f.getHostLocalPositions(0)!.length).toBe(15);
    f.dispose();
  });

  it('setMaxAppMag is a no-op smoke (cull distances refresh internally)', () => {
    const f = new PlanetBodyField(makeSharedUniforms(6.5));
    f.attachHost(0, makePlanetSystem(0, 1), 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    f.setMaxAppMag(15);
    f.setMaxAppMag(6.5);
    expect(f.group.visible).toBe(true);
    f.dispose();
  });

  it('exposes the single glare mesh + its local-pass mirror, orders pinned', () => {
    // Planets = spheroid mesh + one additive glare pass (no opaque disc
    // / core-mask — the mesh writes depth for occlusion, an unresolved
    // point-glare needs none). Main-pass glare at 4; local-pass mirror
    // at 4 too, so a transiting body's glare adds over a parent mesh
    // behind it. Pin by name → renderOrder so a regression fails CI.
    // See src/client/local-depth/README.md.
    const f = new PlanetBodyField(makeSharedUniforms());
    const orderByName = new Map(
      f.group.children.map((m) => [m.name, m.renderOrder]),
    );
    expect(orderByName.get('glow')).toBe(4);
    expect(f.group.children).toHaveLength(1);
    const localByName = new Map(
      f.localGroup.children.map((m) => [m.name, m.renderOrder]),
    );
    expect(localByName.get('glow-local')).toBe(4);
    expect(f.localGroup.children).toHaveLength(1);
    f.dispose();
  });

  it('getHostLocalPositions returns a copy that survives capacity grow', () => {
    // Pin the value-semantics contract structurally. If a future
    // refactor swaps `.slice()` back to `.subarray()` to save the
    // allocation, this test fails because the cached reference would
    // become a view into the orphaned old buffer and read [0,0,0]
    // (the original allocation is GC'd / overwritten depending on
    // how growCapacity is implemented).
    const f = new PlanetBodyField(makeSharedUniforms());
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({ radiusKm: 6000, semiMajorAxisAu: 1 })],
        positionsAt: (_t, out) => { out[0] = 0.42; out[1] = -1.5; out[2] = 7; },
      },
      4.83,
      R_SUN_PC,
      new THREE.Vector3(),
      0,
      0,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hosts = (f as any).hosts as Map<number, { orientation: THREE.Quaternion }>;
    hosts.get(0)!.orientation.identity();
    const camera = new THREE.PerspectiveCamera();
    f.update(camera, 0, 0);

    const cached = f.getHostLocalPositions(0)!;
    expect(cached[0]).toBeCloseTo(0.42, 6);
    expect(cached[1]).toBeCloseTo(-1.5, 6);
    expect(cached[2]).toBeCloseTo(7,    6);

    // Force growCapacity by overflowing the initial allocation.
    // INITIAL_CAPACITY = 32 instances, so 40 single-planet hosts (40
    // instances) force at least one grow past the first host's slot.
    for (let i = 1; i < 40; i++) {
      f.attachHost(i, makePlanetSystem(i, 1), 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    }
    // Cached reference must still read the original values — the
    // backing buffer has been reallocated, but `.slice()` decoupled
    // us from it.
    expect(cached[0]).toBeCloseTo(0.42, 6);
    expect(cached[1]).toBeCloseTo(-1.5, 6);
    expect(cached[2]).toBeCloseTo(7,    6);
    f.dispose();
  });

  it('grows capacity when many hosts attach beyond the initial budget', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    // INITIAL_CAPACITY = 32 instances; attach 40 single-planet hosts so
    // growCapacity fires and every slot survives the reallocation.
    for (let i = 0; i < 40; i++) {
      f.attachHost(i, makePlanetSystem(i, 1), 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    }
    for (let i = 0; i < 40; i++) {
      const slice = f.getHostLocalPositions(i);
      expect(slice).not.toBeNull();
      expect(slice!.length).toBe(3);
    }
    f.dispose();
  });

  it('writes the Mallama coefficients into iPhaseCoefsA/B/C for the right slot', () => {
    // iPhaseCoefsA = (c0,c1,c2,c3), iPhaseCoefsB = (c4,c5,c6,alphaMaxDeg),
    // iPhaseCoefsC = (c7,_,_,_) per-instance buffers plumbed through
    // allocate / grow / write-static / flush / shift-down. The
    // lifecycle tests above exercise the mechanics; this read-back
    // pins the buffer *contents* so a swapped index, miscopied stride
    // in growCapacity, or wrong shift in detachHost can't slip past.
    const f = new PlanetBodyField(makeSharedUniforms());
    // Four planets: bare (no coefs) | bare | Saturn | Mercury (the
    // only c7 carrier). Slots 2 and 3 are the ones we read back.
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [
        makePlanet({ name: 'P0' }),
        makePlanet({ name: 'P1' }),
        makePlanet({ name: 'P2-Saturn', phaseCoefficients: SATURN_PHASE }),
        makePlanet({ name: 'P3-Mercury', phaseCoefficients: MERCURY_PHASE }),
      ],
    };
    f.attachHost(0, ps, 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    // Reach into the geometry. The cast is narrow and stable: the
    // class always exposes these as InstancedBufferAttribute.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geom = (f as any).geometry as THREE.InstancedBufferGeometry;
    const phaseA = (geom.attributes.iPhaseCoefsA as THREE.InstancedBufferAttribute)
      .array as Float32Array;
    const phaseB = (geom.attributes.iPhaseCoefsB as THREE.InstancedBufferAttribute)
      .array as Float32Array;
    const phaseC = (geom.attributes.iPhaseCoefsC as THREE.InstancedBufferAttribute)
      .array as Float32Array;
    const off = 2 * 4; // slot 2, vec4 stride
    expect(phaseA[off + 0]).toBeCloseTo(SATURN_PHASE.c0, 6);
    expect(phaseA[off + 1]).toBeCloseTo(SATURN_PHASE.c1, 6);
    expect(phaseA[off + 2]).toBeCloseTo(SATURN_PHASE.c2, 6);
    expect(phaseA[off + 3]).toBeCloseTo(SATURN_PHASE.c3, 6);
    expect(phaseB[off + 0]).toBeCloseTo(SATURN_PHASE.c4, 6);
    expect(phaseB[off + 1]).toBeCloseTo(SATURN_PHASE.c5, 6);
    expect(phaseB[off + 2]).toBeCloseTo(SATURN_PHASE.c6, 6);
    expect(phaseB[off + 3]).toBeCloseTo(SATURN_PHASE.alphaMaxDeg, 6);
    expect(phaseC[off + 0]).toBe(0); // Saturn carries no c7
    // Mercury's c7 lands in slot 3's iPhaseCoefsC.x. Float32 compare —
    // 6.592e-15 survives the narrowing with ~7 significant digits.
    const offC = 3 * 4;
    expect(phaseC[offC + 0]).toBeCloseTo(MERCURY_PHASE.c7, 20);
    expect(phaseC[offC + 1]).toBe(0);
    expect(phaseC[offC + 2]).toBe(0);
    expect(phaseC[offC + 3]).toBe(0);
    expect(phaseB[offC + 3]).toBeCloseTo(MERCURY_PHASE.alphaMaxDeg, 6);
    // Slots 0/1 carry the bare-coef sentinel: alphaMaxDeg = 0 (the
    // shader's "use Lambertian" signal).
    expect(phaseB[0 * 4 + 3]).toBe(0);
    expect(phaseB[1 * 4 + 3]).toBe(0);
    f.dispose();
  });

  it('alphaZeroPhaseFactor widens cullDistance for Saturn-style hosts', () => {
    // Saturn's c0 = -0.55 ⇒ alphaZeroPhaseFactor ≈ 1.66, ⇒ cull widens by
    // √1.66 ≈ 1.29×. A future refactor that drops the
    // alphaZeroPhaseFactor multiplication on the grounds that φ ≤ 1 would
    // silently re-narrow Saturn's cull and Mercury would vanish at
    // distances where it should still render — pin the widening.
    const baseR = 6000 * KM_PC;
    const aPc = 1 * AU_PC;
    const baseRefl = 0.5 * (baseR / aPc) ** 2;
    const f = new PlanetBodyField(makeSharedUniforms(6.5));
    // Bare planet → cull derived from base reflectance only.
    f.attachHost(
      0,
      { hostStarIdx: 0, planets: [makePlanet({ semiMajorAxisAu: 1, radiusKm: 6000 })] },
      4.83,
      R_SUN_PC,
      new THREE.Vector3(),
      0,
      0,
    );
    // Saturn-coefs planet (same albedo / R / a) → cull widened by
    // √alphaZeroPhaseFactor(SATURN_PHASE).
    f.attachHost(
      1,
      {
        hostStarIdx: 1,
        planets: [
          makePlanet({
            semiMajorAxisAu: 1,
            radiusKm: 6000,
            phaseCoefficients: SATURN_PHASE,
          }),
        ],
      },
      4.83,
      R_SUN_PC,
      new THREE.Vector3(),
      0,
      0,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hosts = (f as any).hosts as Map<number, { cullDistance: number }>;
    const dBare = hosts.get(0)!.cullDistance;
    const dSaturn = hosts.get(1)!.cullDistance;
    const expectedRatio = Math.sqrt(alphaZeroPhaseFactor(SATURN_PHASE));
    expect(dSaturn / dBare).toBeCloseTo(expectedRatio, 6);
    // Sanity bound — the widening is non-trivial (~1.29×).
    expect(expectedRatio).toBeGreaterThan(1.25);
    expect(expectedRatio).toBeLessThan(1.35);
    // And the cull derivation matches `cullDistancePc` directly.
    expect(dSaturn).toBeCloseTo(
      cullDistancePc(4.83, baseRefl * alphaZeroPhaseFactor(SATURN_PHASE), 6.5),
      6,
    );
    f.dispose();
  });

  it('update() per-host cull gate: skips positionsAt past cullDistance', () => {
    // The architectural promise of PlanetBodyField is the per-host cull
    // gate in update() — `if (dToHost > host.cullDistance) continue` —
    // is what makes the hundreds-of-hosts scaling tractable. The
    // gate has unit-test coverage on its derived inputs (cullDistance
    // formula above) but none on the gate behaviour itself. A stub
    // positionsAt with a counter pins it: inside cullDistance the
    // counter increments per update; past cullDistance it stays frozen.
    const f = new PlanetBodyField(makeSharedUniforms(6.5));
    let calls = 0;
    const positionsAt = (_t: number, out: Float32Array): void => {
      calls++;
      for (let i = 0; i < out.length; i++) out[i] = 0;
    };
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [makePlanet({ semiMajorAxisAu: 1, radiusKm: 6000 })],
      positionsAt,
    };
    f.attachHost(0, ps, 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    // attachHost calls writeHostPositions once for the initial fill, so
    // we expect 1 prior call before update() ticks fire.
    expect(calls).toBe(1);

    // Reach into the host's computed cullDistance — the test stays
    // agnostic to the exact value but lands the camera at known offsets
    // either side of it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hosts = (f as any).hosts as Map<number, { cullDistance: number }>;
    const cull = hosts.get(0)!.cullDistance;
    expect(cull).toBeGreaterThan(0);

    const camera = new THREE.PerspectiveCamera();
    // Camera at half cullDistance from the host → gate open, positionsAt fires.
    camera.position.set(cull * 0.5, 0, 0);
    f.update(camera, 0, 0);
    expect(calls).toBe(2);
    f.update(camera, 1, 0);
    expect(calls).toBe(3);

    // Camera past cullDistance → gate closes, positionsAt frozen.
    camera.position.set(cull * 2, 0, 0);
    f.update(camera, 2, 0);
    expect(calls).toBe(3);
    f.update(camera, 3, 0);
    expect(calls).toBe(3);

    // Back inside cullDistance → gate reopens.
    camera.position.set(cull * 0.5, 0, 0);
    f.update(camera, 4, 0);
    expect(calls).toBe(4);
    f.dispose();
  });

  it('update() keeps advancing the ephemeris under chart-mono / hidden (bodies not drawn, anchor still rides)', () => {
    // Chart mode is observe-only and can observe from a planet, so the
    // observe anchor / focal-frame ride read live positions off this walk
    // even though the bodies aren't drawn. Rendering gates on mono/hidden;
    // the ephemeris walk must not — freezing it strands the Earth-orbit
    // anchor (Sol + planets appear static while catalog stars still move).
    const f = new PlanetBodyField(makeSharedUniforms(6.5));
    let calls = 0;
    const positionsAt = (_t: number, out: Float32Array): void => {
      calls++;
      for (let i = 0; i < out.length; i++) out[i] = 0;
    };
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [makePlanet({ semiMajorAxisAu: 1, radiusKm: 6000 })],
      positionsAt,
    };
    f.attachHost(0, ps, 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0); // initial fill → calls === 1
    const camera = new THREE.PerspectiveCamera(); // parked at the host, gate open

    f.setMonochrome(true);
    f.update(camera, 0, 0);
    // Chart mode keeps the bodies drawn — as flat ink discs; only the
    // blending swaps, mirroring the star pipeline.
    expect(f.group.visible).toBe(true);
    expect(calls).toBe(2);

    f.setMonochrome(false);
    f.setHidden(true);
    f.update(camera, 1, 0);
    expect(f.group.visible).toBe(false);
    expect(calls).toBe(3);

    f.setHidden(false);
    f.update(camera, 2, 0);
    expect(f.group.visible).toBe(true);
    expect(calls).toBe(4);
    f.dispose();
  });

  it('update() writes positionsAt output into bufLocalRel after orientation rotation', () => {
    // positionsAt returns plane-frame triples; the field rotates them
    // through the host orientation quaternion before writing into the
    // local instance buffer. A non-identity orientation lets us pin
    // the rotation path: positionsAt writes [1, 0, 0] (planet on
    // +x in plane frame), orientation rotates +x → +y (90° about z),
    // expect bufLocalRel slot to read [0, 1, 0].
    const f = new PlanetBodyField(makeSharedUniforms(20));
    const positionsAt = (_t: number, out: Float32Array): void => {
      out[0] = 1; out[1] = 0; out[2] = 0;
    };
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [makePlanet({ semiMajorAxisAu: 1, radiusKm: 6000 })],
      positionsAt,
    };
    // Pre-rotate the host orientation manually: 90° about +z so
    // (1,0,0) → (0,1,0). orbitalPlaneNormalFor picks the plane normal
    // for non-Sol hosts as +galactic-z; we override by stashing the
    // orientation directly through the host map after attach.
    f.attachHost(0, ps, 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hosts = (f as any).hosts as Map<number, { orientation: THREE.Quaternion }>;
    hosts.get(0)!.orientation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    // Force one update() tick well inside the cull distance.
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    f.update(camera, 0, 0);

    const slice = f.getHostLocalPositions(0)!;
    expect(slice[0]).toBeCloseTo(0, 6);
    expect(slice[1]).toBeCloseTo(1, 6);
    expect(slice[2]).toBeCloseTo(0, 6);
    f.dispose();
  });

  it('update() placeholder branch fills bufLocalRel when positionsAt is absent', () => {
    // Without positionsAt the field falls back to a static placeholder
    // eccentric-anomaly layout. Per `placeholderEccentricAnomaly`, n=1
    // lands the only planet at the perihelion +x along the host plane,
    // which the (identity-for-Sol-index) orientation leaves on +x. The
    // magnitude equals semi-major axis × (1 − e) for e = 0 → 1 AU.
    const f = new PlanetBodyField(makeSharedUniforms(20));
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({ semiMajorAxisAu: 1, radiusKm: 6000, eccentricity: 0 })],
      },
      4.83,
      R_SUN_PC,
      new THREE.Vector3(),
      0,    // solIndex — drives orientation choice
      0,
    );
    const slice = f.getHostLocalPositions(0)!;
    const r = Math.sqrt(slice[0] ** 2 + slice[1] ** 2 + slice[2] ** 2);
    expect(r).toBeCloseTo(1 * AU_PC, 9);
    f.dispose();
  });

  it('recenter writes the new hostLocalPos into bufHostLocalPos', () => {
    // Attaches at hostAbsPos = (1.5, 0, 2.0). Pre-recenter the slot
    // reads the same values (worldOffset = 0). After recenter to
    // (0.5, 0, 1.0) the slot must read (1.0, 0, 1.0).
    const f = new PlanetBodyField(makeSharedUniforms(20));
    const hostAbs = new THREE.Vector3(1.5, 0, 2.0);
    f.attachHost(0, makePlanetSystem(0, 1), 4.83, R_SUN_PC, hostAbs, 0, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = (f as any).bufs.hostLocalPos as Float32Array;
    expect(buf[0]).toBeCloseTo(1.5, 6);
    expect(buf[1]).toBeCloseTo(0,   6);
    expect(buf[2]).toBeCloseTo(2.0, 6);
    f.recenter(new THREE.Vector3(0.5, 0, 1.0));
    expect(buf[0]).toBeCloseTo(1.0, 6);
    expect(buf[1]).toBeCloseTo(0,   6);
    expect(buf[2]).toBeCloseTo(1.0, 6);
    f.dispose();
  });

  it('update() flushes only iLocalRel — the static attributes stay clean per frame', () => {
    // At hundreds-of-hosts scale, per-frame re-uploads of the static
    // attributes (iRadiusPc, iColour, iSolidity, iAlbedoP, iHostAbsmag,
    // iPhaseCoefsA/B/C, iHostLocalPos) would be measurable wasted bus
    // bandwidth. Pin the dynamic-only flush: after attach (which
    // legitimately touches every attribute) a single update() tick
    // only flips iLocalRel (the planet positions tick).
    const f = new PlanetBodyField(makeSharedUniforms(20));
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({ radiusKm: 6000 })],
        positionsAt: (_t, out) => { out[0] = 0; out[1] = 0; out[2] = 0; },
      },
      4.83,
      R_SUN_PC,
      new THREE.Vector3(),
      0,
      0,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geom = (f as any).geometry as THREE.InstancedBufferGeometry;
    // Replace each attribute's needsUpdate setter with a flag tracker.
    const flagged = new Set<string>();
    for (const [name, attr] of Object.entries(geom.attributes)) {
      Object.defineProperty(attr, 'needsUpdate', {
        configurable: true,
        get(): boolean { return false; },
        set(_v: boolean): void { flagged.add(name); },
      });
    }
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    f.update(camera, 1, 0);
    // Only iLocalRel should have been touched. iHostLocalPos / iRadiusPc /
    // iColour / iSolidity / iAlbedoP / iHostAbsmag / iPhaseCoefsA/B/C stay
    // quiescent.
    expect(flagged.has('iLocalRel')).toBe(true);
    expect(flagged.size).toBe(1);
    f.dispose();
  });

  it('recenter flushes only iHostLocalPos — iLocalRel and statics stay clean', () => {
    // Recenter writes per-host hostLocalPos into its iHostLocalPos
    // slot but doesn't touch iLocalRel (planet positions in the host
    // plane frame are recenter-invariant). The narrow flush keeps the
    // floating-origin pivot cheap at hundreds-of-hosts scale.
    const f = new PlanetBodyField(makeSharedUniforms(20));
    f.attachHost(0, makePlanetSystem(0, 1), 4.83, R_SUN_PC, new THREE.Vector3(1, 0, 0), 0, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geom = (f as any).geometry as THREE.InstancedBufferGeometry;
    const flagged = new Set<string>();
    for (const [name, attr] of Object.entries(geom.attributes)) {
      Object.defineProperty(attr, 'needsUpdate', {
        configurable: true,
        get(): boolean { return false; },
        set(_v: boolean): void { flagged.add(name); },
      });
    }
    f.recenter(new THREE.Vector3(0.5, 0, 0));
    expect(flagged.has('iHostLocalPos')).toBe(true);
    expect(flagged.size).toBe(1);
    f.dispose();
  });
});

describe('PlanetBodyField.appMagFor', () => {
  it('returns null when the host is not attached', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    expect(f.appMagFor(99, 0, new THREE.Vector3())).toBeNull();
    f.dispose();
  });

  it('returns null for an out-of-range planet index', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({ radiusKm: 6000, semiMajorAxisAu: 1 })],
      },
      4.83,
      R_SUN_PC,
      new THREE.Vector3(),
      0,
      0,
    );
    expect(f.appMagFor(0, -1, new THREE.Vector3())).toBeNull();
    expect(f.appMagFor(0, 1, new THREE.Vector3())).toBeNull();
    expect(f.appMagFor(0, 0, new THREE.Vector3())).not.toBeNull();
    f.dispose();
  });

  it('camera parked exactly at the host (observe mode): planets stay finite and visible', () => {
    // Regression for observe-on-Sol: the camera sits at the host's
    // exact local position, so the viewer->host distance is 0. The
    // old formula killed the quad / returned NaN there; the cancelled
    // form must yield a finite magnitude under the naked-eye cutoff
    // for a Jupiter-like planet.
    const f = new PlanetBodyField(makeSharedUniforms(6.5));
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({
          radiusKm: 69911,
          semiMajorAxisAu: 5.2,
          eccentricity: 0,
          albedo: 0.538,
        })],
        positionsAt: (_t, out) => { out[0] = 5.2 * AU_PC; out[1] = 0; out[2] = 0; },
      },
      4.83,
      R_SUN_PC,
      new THREE.Vector3(0, 0, 0),
      0,
      0,
    );
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0); // exactly on the host
    f.update(camera, 0, 0);
    const m = f.appMagFor(0, 0, camera.position);
    expect(m).not.toBeNull();
    expect(Number.isFinite(m!)).toBe(true);
    // Jupiter from Sol at full phase: bright, well under naked-eye 6.5.
    expect(m!).toBeLessThan(0);
    f.dispose();
  });

  it('happy path matches planetApparentMagnitude with explicit phase factor', () => {
    // Build a known geometry. Host at (0,0,0). Use positionsAt to
    // plant the planet at (1 AU, 0, 0) in plane frame, then override
    // the host orientation to identity (the default Sol orientation
    // tilts plane → ecliptic, but for this hand-checkable test we
    // want renderer-local = plane-frame). Place viewer at (-0.1, 0, 0)
    // so planet→viewer and planet→host both point along −x ⇒ α = 0
    // ⇒ φ = 1 for the Lambertian fallback.
    const f = new PlanetBodyField(makeSharedUniforms(20));
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({
          radiusKm: 6000,
          semiMajorAxisAu: 1,
          eccentricity: 0,
          albedo: 0.5,
        })],
        positionsAt: (_t, out) => { out[0] = 1 * AU_PC; out[1] = 0; out[2] = 0; },
      },
      4.83,
      R_SUN_PC,
      new THREE.Vector3(0, 0, 0),
      0,
      0,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hosts = (f as any).hosts as Map<number, { orientation: THREE.Quaternion }>;
    hosts.get(0)!.orientation.identity();
    // Re-tick update() so writeHostPositions re-runs under the new
    // identity orientation and rewrites bufLocalRel.
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(-0.1, 0, 0);
    f.update(camera, 0, 0);

    const got = f.appMagFor(0, 0, camera.position)!;
    // Hand-built expectation. Planet at +1 AU, host at origin, viewer
    // at −0.1 pc on the same axis.
    const dVp = 1 * AU_PC + 0.1;
    const dHp = 1 * AU_PC;
    const radiusPc = 6000 * KM_PC;
    // No Mallama coefs → Lambertian; α = 0 → φ = 1.
    const expected = planetApparentMagnitude(4.83, dVp, dHp, 0.5, radiusPc, 1);
    expect(got).toBeCloseTo(expected, 5);
    f.dispose();
  });

  it('passes the Mallama phase factor through evalPlanetView for coef-bearing planets', () => {
    // Same idiom as the happy-path test but with VENUS_PHASE coefs
    // and a non-zero α so the Mallama branch fires through
    // phaseFactorFor. Plane-frame plant at +x (positionsAt) with
    // identity orientation → renderer-local plant at +x. Viewer
    // off-axis along +y so α ≠ 0.
    const f = new PlanetBodyField(makeSharedUniforms(20));
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({
          radiusKm: 6052,
          semiMajorAxisAu: 0.723,
          eccentricity: 0,
          albedo: 0.689,
          phaseCoefficients: VENUS_PHASE,
        })],
        positionsAt: (_t, out) => { out[0] = 0.723 * AU_PC; out[1] = 0; out[2] = 0; },
      },
      4.83,
      R_SUN_PC,
      new THREE.Vector3(0, 0, 0),
      0,
      0,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hosts = (f as any).hosts as Map<number, { orientation: THREE.Quaternion }>;
    hosts.get(0)!.orientation.identity();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0.5 * AU_PC, 0.1, 0);
    f.update(camera, 0, 0);

    const got = f.appMagFor(0, 0, camera.position)!;
    // Hand-built expectation, computed against the same phaseFactorFor
    // helper the field consumes — so this test pins that
    // evalPlanetView is wiring the (dv, dh, coefs) inputs through
    // correctly, not the math of phaseFactorFor itself (which is
    // covered in phase-function.test.ts).
    const planetPos = new THREE.Vector3(0.723 * AU_PC, 0, 0);
    const hostPos = new THREE.Vector3(0, 0, 0);
    const dv = planetPos.clone().sub(camera.position);
    const dh = hostPos.clone().sub(camera.position);
    const phi = phaseFactorFor(dv.x, dv.y, dv.z, dh.x, dh.y, dh.z, VENUS_PHASE);
    const dVp = dv.length();
    const dHp = planetPos.length();
    const radiusPc = 6052 * KM_PC;
    const expected = planetApparentMagnitude(4.83, dVp, dHp, 0.689, radiusPc, phi);
    expect(got).toBeCloseTo(expected, 5);
    // Sanity: α is meaningfully non-zero (so Lambert(0) wouldn't
    // accidentally pass).
    expect(phi).not.toBeCloseTo(alphaZeroPhaseFactor(VENUS_PHASE), 3);
    f.dispose();
  });
});

describe('PlanetBodyField.pick', () => {
  function rectFor(w: number, h: number): DOMRect {
    return {
      left: 0, top: 0, width: w, height: h,
      right: w, bottom: h, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }

  it('returns null when no hosts are attached', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1e-10, 1e5);
    camera.position.set(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    expect(f.pick(camera, rectFor(800, 600), 400, 300, 8)).toBeNull();
    f.dispose();
  });

  it('prime hit: cursor inside the projected disc returns tier "prime"', () => {
    // Camera at origin looking down -Z. Planet at (0, 0, -1 AU) in
    // plane-frame; orientation forced to identity post-attach so the
    // renderer-local planet position matches. Cursor at viewport
    // centre → pxDist = 0, hitRadius = 0.5 · pxSize → prime.
    const f = new PlanetBodyField(makeSharedUniforms(20));
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({
          radiusKm: 6000,
          semiMajorAxisAu: 1,
          eccentricity: 0,
          albedo: 0.9,
        })],
        positionsAt: (_t, out) => { out[0] = 0; out[1] = 0; out[2] = -1 * AU_PC; },
      },
      4.83,
      R_SUN_PC,
      new THREE.Vector3(0, 0, 0),
      0,
      0,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hosts = (f as any).hosts as Map<number, { orientation: THREE.Quaternion }>;
    hosts.get(0)!.orientation.identity();
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1e-10, 1e5);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    f.update(camera, 0, 0);
    const hit = f.pick(camera, rectFor(800, 600), 400, 300, 8);
    expect(hit).not.toBeNull();
    expect(hit!.tier).toBe('prime');
    expect(hit!.idx).toBe(0);
    expect(hit!.hostStarIdx).toBe(0);
    f.dispose();
  });

  it('tracks render visibility: pickable in chart mode (ink discs), unpickable when hidden', () => {
    // Click-pick must equal render. Chart mode now DRAWS the bodies as
    // flat ink discs, so they stay pickable there; setHidden still takes
    // them out of both render and pick.
    const f = new PlanetBodyField(makeSharedUniforms(20));
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({ radiusKm: 6000, semiMajorAxisAu: 1, eccentricity: 0, albedo: 0.9 })],
        positionsAt: (_t, out) => { out[0] = 0; out[1] = 0; out[2] = -1 * AU_PC; },
      },
      4.83, R_SUN_PC, new THREE.Vector3(0, 0, 0), 0, 0,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f as any).hosts.get(0)!.orientation.identity();
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1e-10, 1e5);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    f.update(camera, 0, 0);
    expect(f.pick(camera, rectFor(800, 600), 400, 300, 8)).not.toBeNull(); // drawn → pickable

    f.setMonochrome(true); // chart mode: ink discs, still pickable
    expect(f.pick(camera, rectFor(800, 600), 400, 300, 8)).not.toBeNull();

    f.setMonochrome(false);
    f.setHidden(true);
    expect(f.pick(camera, rectFor(800, 600), 400, 300, 8)).toBeNull();

    f.setHidden(false);
    expect(f.pick(camera, rectFor(800, 600), 400, 300, 8)).not.toBeNull();
    f.dispose();
  });

  it('chart mode: hard mag clip (no soft taper) and chart-px hit radius', () => {
    const shared = makeSharedUniforms(20);
    const f = new PlanetBodyField(shared);
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({ radiusKm: 6000, semiMajorAxisAu: 1, eccentricity: 0, albedo: 0.9 })],
        positionsAt: (_t, out) => { out[0] = 0; out[1] = 0; out[2] = -1 * AU_PC; },
      },
      4.83, R_SUN_PC, new THREE.Vector3(0, 0, 0), 0, 0,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f as any).hosts.get(0)!.orientation.identity();
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1e-10, 1e5);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    f.update(camera, 0, 0);
    f.setMonochrome(true);

    const appMag = f.appMagForInstance(0, camera.position)!;
    // In chart mode the rendered size is the flat magnitude-driven disc
    // (CPU mirror of the vertex shader's chart branch), not the
    // physical/perceptual max.
    const expected = chartDiscPxForAppMag(
      appMag,
      { maxPx: 28, minPx: 1.5, magBright: -2 },
      shared.uMaxAppMag.value,
    );
    expect(f.renderedPlanetSizePx(0, camera.position)).toBeCloseTo(expected, 10);

    // Hard clip: a limit just below appMag drops the pick immediately —
    // the navigate-mode soft-taper margin must not apply in chart.
    shared.uMaxAppMag.value = appMag - 0.01;
    expect(f.pick(camera, rectFor(800, 600), 400, 300, 8)).toBeNull();
    f.setMonochrome(false);
    expect(f.pick(camera, rectFor(800, 600), 400, 300, 8)).not.toBeNull();
    f.dispose();
  });

  it('kill condition: appMag > maxAppMag + 0.5 drops the candidate', () => {
    // Same setup as prime but with the planet shoved far enough away
    // that its appMag exceeds the slider cutoff by > 0.5 mag. The
    // soft-taper kill in pick() must drop it; result null.
    const f = new PlanetBodyField(makeSharedUniforms(6.5));
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({ radiusKm: 1000, semiMajorAxisAu: 0, albedo: 0.1 })],
        positionsAt: (_t, out) => { out[0] = 0; out[1] = 0; out[2] = -5e5 * AU_PC; },
      },
      4.83,
      R_SUN_PC,
      new THREE.Vector3(0, 0, 0),
      0,
      0,
    );
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1e-10, 1e10);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    f.update(camera, 0, 0);
    const hit = f.pick(camera, rectFor(800, 600), 400, 300, 8);
    expect(hit).toBeNull();
    f.dispose();
  });

  it('cross-host: both attached hosts contribute candidates', () => {
    // Two single-planet hosts, identity orientation. Aim cursor at
    // the second; the picker must walk both hosts and return the
    // second's hostStarIdx.
    const f = new PlanetBodyField(makeSharedUniforms(20));
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({ radiusKm: 6000, semiMajorAxisAu: 1, albedo: 0.9 })],
        positionsAt: (_t, out) => { out[0] = -1 * AU_PC; out[1] = 0; out[2] = -1 * AU_PC; },
      },
      4.83,
      R_SUN_PC,
      new THREE.Vector3(0, 0, 0),
      0,
      0,
    );
    f.attachHost(
      1,
      {
        hostStarIdx: 1,
        planets: [makePlanet({ radiusKm: 6000, semiMajorAxisAu: 1, albedo: 0.9 })],
        positionsAt: (_t, out) => { out[0] = 1 * AU_PC; out[1] = 0; out[2] = -1 * AU_PC; },
      },
      4.83,
      R_SUN_PC,
      new THREE.Vector3(0, 0, 0),
      0,
      0,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hosts = (f as any).hosts as Map<number, { orientation: THREE.Quaternion }>;
    hosts.get(0)!.orientation.identity();
    hosts.get(1)!.orientation.identity();
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1e-10, 1e5);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    f.update(camera, 0, 0);

    // Project host 1's planet to find its projected screen location
    // under the now-identity orientation, then aim the cursor there.
    const v = new THREE.Vector3(1 * AU_PC, 0, -1 * AU_PC).project(camera);
    const screenX = (v.x + 1) * 0.5 * 800;
    const screenY = (1 - v.y) * 0.5 * 600;
    const hit = f.pick(camera, rectFor(800, 600), screenX, screenY, 8);
    expect(hit).not.toBeNull();
    expect(hit!.hostStarIdx).toBe(1);
    f.dispose();
  });
});

describe('mesh-fade driver: physicalPlanetSizePx through meshFadeFromPhysPx', () => {
  it('mesh absent at planet-system range, fully on at close approach', () => {
    const f = new PlanetBodyField(makeSharedUniforms(20));
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({ radiusKm: 6000, semiMajorAxisAu: 1, eccentricity: 0, albedo: 0.9 })],
        positionsAt: (_t, out) => { out[0] = 0; out[1] = 0; out[2] = -1 * AU_PC; },
      },
      4.83, R_SUN_PC, new THREE.Vector3(0, 0, 0), 0, 0,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f as any).hosts.get(0)!.orientation.identity();
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1e-10, 1e5);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    f.update(camera, 0, 0);

    // From the host (1 AU away): a 6000 km body is far sub-pixel, so
    // the mesh stays fully faded even though the perceptual disc is
    // several px — the crescent has nothing to show at that scale.
    camera.position.set(0, 0, 0);
    const farPx = f.physicalPlanetSizePx(0, camera.position);
    expect(farPx).toBeLessThan(MESH_FADE_MIN_PX);
    expect(meshFadeFromPhysPx(farPx)).toBe(0);

    // Surface-grazing: physical size dominates by orders of magnitude.
    const KM_PC_LOCAL = 1 / 3.0857e13;
    camera.position.set(0, 0, -1 * AU_PC + 20 * 6000 * KM_PC_LOCAL);
    const nearPx = f.physicalPlanetSizePx(0, camera.position);
    expect(nearPx).toBeGreaterThan(MESH_FADE_FULL_PX);
    expect(meshFadeFromPhysPx(nearPx)).toBe(1);

    expect(f.physicalPlanetSizePx(99, camera.position)).toBe(0); // unattached
    f.dispose();
  });
});

describe('PlanetBodyField flat-instance identity + geometry accessors', () => {
  function makeField(): PlanetBodyField {
    return new PlanetBodyField(makeSharedUniforms(20));
  }
  function attach(f: PlanetBodyField, hostIdx: number, n: number, hostAbs = new THREE.Vector3()): void {
    const ps: PlanetSystem = {
      hostStarIdx: hostIdx,
      planets: Array.from({ length: n }, (_, i) =>
        makePlanet({ name: `H${hostIdx}P${i}`, semiMajorAxisAu: 1 + i, radiusKm: 6000 })),
      positionsAt: (_t, out) => {
        for (let i = 0; i < n; i++) {
          out[i * 3 + 0] = (1 + i) * AU_PC;
          out[i * 3 + 1] = 0;
          out[i * 3 + 2] = 0;
        }
      },
    };
    f.attachHost(hostIdx, ps, 4.83, R_SUN_PC, hostAbs, hostIdx === 0 ? 0 : -1, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hosts = (f as any).hosts as Map<number, { orientation: THREE.Quaternion }>;
    hosts.get(hostIdx)!.orientation.identity();
    // Re-run the fill under the identity orientation; camera parked on
    // the host so the per-host cull gate stays open.
    const cam = new THREE.PerspectiveCamera();
    cam.position.copy(hostAbs);
    f.update(cam, 0, 0);
  }

  it('setHiddenInstance drives one shared uHideIdx uniform across both glare passes', () => {
    const f = makeField();
    attach(f, 0, 2);
    expect(f.hiddenInstance()).toBe(-1);
    f.setHiddenInstance(1);
    expect(f.hiddenInstance()).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyF = f as any;
    for (const mat of [anyF.matGlow, anyF.matGlowLocal]) {
      expect(mat.uniforms.uHideIdx.value).toBe(1);
    }
    f.setHiddenInstance(-1);
    expect(f.hiddenInstance()).toBe(-1);
  });

  it('hostPlanetOf / instanceIndexOf are inverses across multiple hosts', () => {
    const f = makeField();
    attach(f, 0, 2);
    attach(f, 5, 3, new THREE.Vector3(1, 0, 0));
    expect(f.hostPlanetOf(0)).toEqual({ hostStarIdx: 0, planetIdx: 0 });
    expect(f.hostPlanetOf(1)).toEqual({ hostStarIdx: 0, planetIdx: 1 });
    expect(f.hostPlanetOf(2)).toEqual({ hostStarIdx: 5, planetIdx: 0 });
    expect(f.hostPlanetOf(4)).toEqual({ hostStarIdx: 5, planetIdx: 2 });
    expect(f.hostPlanetOf(5)).toBeNull();
    expect(f.instanceIndexOf(5, 2)).toBe(4);
    expect(f.instanceIndexOf(5, 3)).toBeNull();
    expect(f.instanceIndexOf(9, 0)).toBeNull();
    expect(f.planetAt(3)!.name).toBe('H5P1');
    expect(f.planetAt(99)).toBeNull();
    f.dispose();
  });

  it('flat indices re-resolve after a detach compaction', () => {
    const f = makeField();
    attach(f, 0, 2);
    attach(f, 5, 1, new THREE.Vector3(1, 0, 0));
    f.detachHost(0);
    // Host 5's single planet compacted to flat slot 0.
    expect(f.hostPlanetOf(0)).toEqual({ hostStarIdx: 5, planetIdx: 0 });
    expect(f.instanceIndexOf(5, 0)).toBe(0);
    expect(f.hostPlanetOf(1)).toBeNull();
    f.dispose();
  });

  it('planetLocalPositionInto / planetAbsolutePositionInto compose host + orbital offset', () => {
    const f = makeField();
    const hostAbs = new THREE.Vector3(2, 0, 0);
    attach(f, 5, 1, hostAbs);
    const local = new THREE.Vector3();
    const abs = new THREE.Vector3();
    expect(f.planetLocalPositionInto(0, local)).toBe(true);
    expect(f.planetAbsolutePositionInto(0, abs)).toBe(true);
    // worldOffset is (0,0,0) so local == abs == hostAbs + (1 AU, 0, 0).
    expect(abs.x).toBeCloseTo(2 + AU_PC, 10);
    expect(local.x).toBeCloseTo(2 + AU_PC, 10);
    // After a recenter onto the host, the local reading shifts but the
    // absolute anchor doesn't.
    f.recenter(hostAbs);
    expect(f.planetLocalPositionInto(0, local)).toBe(true);
    expect(f.planetAbsolutePositionInto(0, abs)).toBe(true);
    expect(local.x).toBeCloseTo(AU_PC, 10);
    expect(abs.x).toBeCloseTo(2 + AU_PC, 10);
    expect(f.planetLocalPositionInto(9, local)).toBe(false);
    f.dispose();
  });

  it('appMagForInstance matches the (host, planetIdx)-keyed appMagFor', () => {
    const f = makeField();
    attach(f, 5, 2, new THREE.Vector3(1, 0, 0));
    const cam = new THREE.Vector3(0.5, 0.2, 0);
    expect(f.appMagForInstance(1, cam)).toBeCloseTo(f.appMagFor(5, 1, cam)!, 12);
    expect(f.appMagForInstance(9, cam)).toBeNull();
    f.dispose();
  });

  it('renderedPlanetSizePx mirrors the true disc when resolved (physSize ≫ appSize)', () => {
    const f = makeField();
    attach(f, 0, 1);
    // Camera close to the planet at (1 AU, 0, 0): physical term visible.
    const near = new THREE.Vector3(AU_PC - 10 * 6000 * KM_PC, 0, 0);
    const px = f.renderedPlanetSizePx(0, near);
    expect(px).toBeGreaterThan(0);
    // At 10 body radii the true angular diameter is 2·atan(1/10) rad;
    // uViewport.y = 600, uFovYRad = 60°. physSize ≈ 114 px ≫ appSize, so
    // the footprint is the mesh's true disc (max(physSize, appSize) =
    // physSize). bufLocalRel stores the planet position in float32, so the
    // camera→planet distance carries a ~1e-4 relative quantum at 1 AU
    // magnitudes — compare at that tolerance.
    const expectedPhys = 2 * Math.atan(1 / 10) * (600 / ((60 * Math.PI) / 180));
    expect(Math.abs(px - expectedPhys) / expectedPhys).toBeLessThan(1e-3);
    // Unattached instance → 0.
    expect(f.renderedPlanetSizePx(9, near)).toBe(0);
    f.dispose();
  });

  it('renderedPlanetSizePx is the star-perceptual point when unresolved', () => {
    const f = makeField();
    attach(f, 0, 1);
    // Camera ~0.1 AU from the planet at 1 AU: the true disc is sub-pixel,
    // so the footprint is the star-perceptual appSize (≫ physSize) — the
    // planet reads as a star of its magnitude, visible per its appMag.
    const far = new THREE.Vector3(0.9 * AU_PC, 0, 0);
    const px = f.renderedPlanetSizePx(0, far);
    // uSizeMin = 2: a visible unresolved body is at least the perceptual
    // floor, far above its sub-pixel true disc.
    expect(px).toBeGreaterThanOrEqual(2);
    f.dispose();
  });

  it('planetHostRelPositionInto returns the raw iLocalRel offset', () => {
    const f = makeField();
    attach(f, 0, 1);
    const rel = new THREE.Vector3();
    expect(f.planetHostRelPositionInto(0, rel)).toBe(true);
    const local = new THREE.Vector3();
    const host = new THREE.Vector3();
    f.planetLocalPositionInto(0, local);
    f.getHostLocalPositionInto(0, host);
    expect(rel.x).toBeCloseTo(local.x - host.x, 12);
    expect(rel.y).toBeCloseTo(local.y - host.y, 12);
    expect(rel.z).toBeCloseTo(local.z - host.z, 12);
    // Unattached instance → false.
    expect(f.planetHostRelPositionInto(9, rel)).toBe(false);
    f.dispose();
  });
});

describe('PlanetBodyField true-eclipse dim', () => {
  const HOST_R = R_SUN_PC;

  function makeEclipseField(): {
    f: PlanetBodyField;
    planetDir: THREE.Vector3;
    planetDist: number;
  } {
    const f = new PlanetBodyField(makeSharedUniforms());
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [makePlanet({ semiMajorAxisAu: 1, radiusKm: 6000 })],
    };
    f.attachHost(0, ps, 4.83, HOST_R, new THREE.Vector3(), 0, 0);
    const p = new THREE.Vector3();
    f.planetLocalPositionInto(0, p);
    const planetDist = p.length();
    return { f, planetDir: p.normalize(), planetDist };
  }

  it('superior conjunction inside the host disc dims to exactly 0', () => {
    const { f, planetDir } = makeEclipseField();
    const camera = new THREE.PerspectiveCamera();
    // Camera on the far side of the host from the planet, dead on the
    // host–planet line: the planet sits concentric behind the host's
    // disc. First update has no previous frame, so blend = 1 and the
    // dim snaps straight to the geometric target.
    camera.position.copy(planetDir).multiplyScalar(-5 * AU_PC);
    f.update(camera, 0, 0);
    expect(f.eclipseDimForInstance(0)).toBe(0);
    f.dispose();
  });

  it('behind the halo but outside the physical disc stays undimmed', () => {
    const { f, planetDir } = makeEclipseField();
    const camera = new THREE.PerspectiveCamera();
    // Perpendicular offset puts the planet ~0.01 rad off the host
    // centre — far outside the host's ~1e-3 rad angular radius, i.e.
    // "behind the perceptual halo" territory. Glow adds through.
    const perp = new THREE.Vector3(0, 0, 1).cross(planetDir).normalize();
    camera.position
      .copy(planetDir).multiplyScalar(-5 * AU_PC)
      .addScaledVector(perp, 0.05 * AU_PC);
    f.update(camera, 0, 0);
    expect(f.eclipseDimForInstance(0)).toBe(1);
    f.dispose();
  });

  it('inferior conjunction (planet in front) never dims the planet', () => {
    const { f, planetDir } = makeEclipseField();
    const camera = new THREE.PerspectiveCamera();
    // Camera on the planet's side: planet transits the host. The back
    // body is the host (a star-pipeline instance), not the planet.
    camera.position.copy(planetDir).multiplyScalar(5 * AU_PC);
    f.update(camera, 0, 0);
    expect(f.eclipseDimForInstance(0)).toBe(1);
    f.dispose();
  });

  it('decays back to exactly 1 after the occlusion ends', () => {
    const { f, planetDir } = makeEclipseField();
    const camera = new THREE.PerspectiveCamera();
    camera.position.copy(planetDir).multiplyScalar(-5 * AU_PC);
    f.update(camera, 0, 0);
    expect(f.eclipseDimForInstance(0)).toBe(0);
    // Move off-axis: no occlusion. The dim decays through the
    // anti-strobe filter (dt clamps at 0.25 s per frame) and snaps to
    // exactly 1 at the settle threshold.
    const perp = new THREE.Vector3(0, 0, 1).cross(planetDir).normalize();
    camera.position.addScaledVector(perp, 0.05 * AU_PC);
    let nowMs = 0;
    let firstDecayed: number | null = null;
    for (let i = 0; i < 10; i++) {
      nowMs += 1000;
      f.update(camera, 0, nowMs);
      if (firstDecayed === null) firstDecayed = f.eclipseDimForInstance(0);
    }
    // Partial after one frame (smoothed, not a hard snap)...
    expect(firstDecayed).toBeGreaterThan(DIM_FLOOR);
    expect(firstDecayed).toBeLessThan(1);
    // ...settled exactly at 1 after the filter converges.
    expect(f.eclipseDimForInstance(0)).toBe(1);
    f.dispose();
  });
});

describe('PlanetBodyField moon-in-parent-shadow dim', () => {
  const PARENT_R_KM = 70000;
  const MOON_ORBIT_KM = 400000;

  // Parent at 1 AU on local +x, moon offset (dxKm, yKm) from the
  // parent. The attach orientation rotates everything rigidly, so
  // sun–parent–moon geometry survives; the camera parks perpendicular
  // to the sun–moon line so the camera-occlusion dim stays silent.
  function makeMoonField(dxKm: number, yKm: number): {
    f: PlanetBodyField;
    camera: THREE.PerspectiveCamera;
  } {
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [
        makePlanet({ name: 'P', semiMajorAxisAu: 1, radiusKm: PARENT_R_KM }),
        makePlanet({
          name: 'M',
          parentName: 'P',
          semiMajorAxisAu: (MOON_ORBIT_KM * KM_PC) / AU_PC,
          radiusKm: 1737,
        }),
      ],
      positionsAt: (_t, out) => {
        out[0] = AU_PC;
        out[1] = 0;
        out[2] = 0;
        out[3] = AU_PC + dxKm * KM_PC;
        out[4] = yKm * KM_PC;
        out[5] = 0;
      },
    };
    const f = new PlanetBodyField(makeSharedUniforms());
    f.attachHost(0, ps, 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    const moonPos = new THREE.Vector3();
    f.planetLocalPositionInto(1, moonPos);
    const camera = new THREE.PerspectiveCamera();
    camera.position
      .crossVectors(moonPos, new THREE.Vector3(0, 0, 1))
      .normalize()
      .multiplyScalar(5 * AU_PC);
    return { f, camera };
  }

  it('a moon dead in the parent umbra dims to exactly 0', () => {
    // Anti-sun side, on the sun–parent line: the parent (0.175 rad from
    // the moon) swallows the whole solar disc (0.005 rad).
    const { f, camera } = makeMoonField(MOON_ORBIT_KM, 0);
    f.update(camera, 0, 0);
    expect(f.eclipseDimForInstance(1)).toBe(0);
    // The parent itself is not shadow-dimmed.
    expect(f.eclipseDimForInstance(0)).toBe(1);
    f.dispose();
  });

  it('a grazing geometry dims partially (penumbra)', () => {
    // Moon placed so the parent's limb crosses the solar disc's centre:
    // about half the sun is covered.
    const angle = PARENT_R_KM / MOON_ORBIT_KM;
    const { f, camera } = makeMoonField(
      MOON_ORBIT_KM * Math.cos(angle),
      MOON_ORBIT_KM * Math.sin(angle),
    );
    f.update(camera, 0, 0);
    const dim = f.eclipseDimForInstance(1);
    expect(dim).toBeGreaterThan(0.2);
    expect(dim).toBeLessThan(0.8);
    f.dispose();
  });

  it('a moon on the sunward side of its parent stays undimmed', () => {
    const { f, camera } = makeMoonField(-MOON_ORBIT_KM, 0);
    f.update(camera, 0, 0);
    expect(f.eclipseDimForInstance(1)).toBe(1);
    f.dispose();
  });
});

describe('PlanetBodyField.isCollapsedOntoParent', () => {
  // Positions ride positionsAt so the geometry is exact: rel offsets on
  // the +x axis are invariant under the host orientation quaternion
  // (a rotation about x for Sol's ecliptic plane).
  function fieldWith(planets: Planet[], positionsAu: number[][]): PlanetBodyField {
    const f = new PlanetBodyField(makeSharedUniforms());
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets,
      positionsAt: (_t, out) => {
        positionsAu.forEach((p, i) => {
          out[i * 3 + 0] = p[0] * AU_PC;
          out[i * 3 + 1] = p[1] * AU_PC;
          out[i * 3 + 2] = p[2] * AU_PC;
        });
      },
    };
    f.attachHost(0, ps, 4.83, R_SUN_PC, new THREE.Vector3(), 0, 0);
    return f;
  }

  function cameraAtAu(x: number, y: number, z: number): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(x * AU_PC, y * AU_PC, z * AU_PC);
    return camera;
  }

  const JUPITER_LIKE = makePlanet({ name: 'J', radiusKm: 70000, semiMajorAxisAu: 1 });

  it('true for a rendered planet sub-pixel from its host', () => {
    // 1 AU host offset seen from 500 AU ≈ 2e-3 rad ≈ 1.15 px on the
    // 600-px / 60° shared-uniform viewport — under the collapse gate.
    const f = fieldWith([JUPITER_LIKE], [[1, 0, 0]]);
    expect(f.isCollapsedOntoParent(0, cameraAtAu(0, 500, 0))).toBe(true);
    f.dispose();
  });

  it('false once the camera is close enough to resolve the separation', () => {
    // Same geometry from 50 AU ≈ 11.5 px — past the collapse gate.
    const f = fieldWith([JUPITER_LIKE], [[1, 0, 0]]);
    expect(f.isCollapsedOntoParent(0, cameraAtAu(0, 50, 0))).toBe(false);
    f.dispose();
  });

  it('false for a body below the magnitude cutoff (not drawn ⇒ not part of the point)', () => {
    const dim = makePlanet({ name: 'D', radiusKm: 1000, albedo: 0.01, semiMajorAxisAu: 1 });
    const f = fieldWith([dim], [[1, 0, 0]]);
    expect(f.isCollapsedOntoParent(0, cameraAtAu(0, 500, 0))).toBe(false);
    f.dispose();
  });

  it('a moon collapses onto its parent planet, not the host', () => {
    const moon = makePlanet({
      name: 'M',
      parentName: 'J',
      radiusKm: 3000,
      semiMajorAxisAu: 0.003,
    });
    // Moon 0.003 AU from its planet, seen from 2 AU above the planet:
    // ~0.86 px from the planet (collapsed) while the planet sits ~0.46
    // rad from the host (resolved).
    const f = fieldWith([JUPITER_LIKE, moon], [[1, 0, 0], [1.003, 0, 0]]);
    const camera = cameraAtAu(1, 2, 0);
    expect(f.isCollapsedOntoParent(1, camera)).toBe(true);
    expect(f.isCollapsedOntoParent(0, camera)).toBe(false);
    f.dispose();
  });

  it('false for an out-of-range instance', () => {
    const f = fieldWith([JUPITER_LIKE], [[1, 0, 0]]);
    expect(f.isCollapsedOntoParent(5, cameraAtAu(0, 500, 0))).toBe(false);
    f.dispose();
  });
});
