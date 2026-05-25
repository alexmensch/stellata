import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  cullDistancePc,
  PlanetBodyField,
} from './planet-body-field';
import type { PerceptualDiscUniforms } from '../star-pipeline/perceptual-disc-uniforms';
import { AU_PC, KM_PC } from '../util/astronomy-constants';
import type { PlanetSystem, Planet } from './planet-system';
import {
  SATURN_PHASE,
  VENUS_PHASE,
  alphaZeroPhaseFactor,
  phaseFactorFor,
} from './phase-function';
import { planetApparentMagnitude } from './perceptual-magnitude';

function makeSharedUniforms(maxAppMag = 6.5): PerceptualDiscUniforms {
  return {
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
    // cutoff 6.5. The bead --design says "cullDistancePc for Sol with
    // naked-eye preset is sub-parsec" — 290 AU is comfortably sub-pc
    // and within the Standard-mode focus zoom range.
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
    f.attachHost(0, makePlanetSystem(0, 3), 4.83, new THREE.Vector3(), 0, 0);
    // group becomes visible; positions buffer holds 3 entries.
    expect(f.group.visible).toBe(true);
    const positions = f.getHostLocalPositions(0);
    expect(positions).not.toBeNull();
    expect(positions!.length).toBe(9); // 3 planets × xyz
    f.dispose();
  });

  it('detachHost clears the host slot and hides the group when empty', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    f.attachHost(0, makePlanetSystem(0, 3), 4.83, new THREE.Vector3(), 0, 0);
    f.detachHost(0);
    expect(f.getHostLocalPositions(0)).toBeNull();
    expect(f.group.visible).toBe(false);
    f.dispose();
  });

  it('recenter shifts hostLocalPos by the new world offset', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    const hostAbs = new THREE.Vector3(1.5, 0, 2.0);
    f.attachHost(0, makePlanetSystem(0, 1), 4.83, hostAbs, 0, 0);
    // Pre-recenter: hostLocalPos = hostAbsPos - (0,0,0) = (1.5, 0, 2.0).
    // Apply recenter to (1.5, 0, 2.0) — host should land at origin.
    f.recenter(new THREE.Vector3(1.5, 0, 2.0));
    // Internal hostLocalPos isn't directly exposed, but we can verify
    // through attachHost behaviour after recenter — re-attach the
    // same host with the same absPos and confirm idempotence.
    f.attachHost(0, makePlanetSystem(0, 1), 4.83, hostAbs, 0, 0);
    // Visible (re-attached fresh).
    expect(f.group.visible).toBe(true);
    f.dispose();
  });

  it('handles multiple hosts in one field', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    f.attachHost(0, makePlanetSystem(0, 2), 4.83, new THREE.Vector3(), 0, 0);
    f.attachHost(1, makePlanetSystem(1, 4), 4.83, new THREE.Vector3(0.5, 0, 0), 0, 0);
    expect(f.getHostLocalPositions(0)!.length).toBe(6);
    expect(f.getHostLocalPositions(1)!.length).toBe(12);
    f.dispose();
  });

  it('detaching the first host compacts the buffer; the second still resolves', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    f.attachHost(0, makePlanetSystem(0, 2), 4.83, new THREE.Vector3(), 0, 0);
    f.attachHost(1, makePlanetSystem(1, 3), 4.83, new THREE.Vector3(0.5, 0, 0), 0, 0);
    f.detachHost(0);
    const stillThere = f.getHostLocalPositions(1);
    expect(stillThere).not.toBeNull();
    expect(stillThere!.length).toBe(9);
    expect(f.group.visible).toBe(true);
    f.dispose();
  });

  it('attachHost is idempotent — re-attach replaces in place', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    f.attachHost(0, makePlanetSystem(0, 3), 4.83, new THREE.Vector3(), 0, 0);
    f.attachHost(0, makePlanetSystem(0, 5), 4.83, new THREE.Vector3(), 0, 0);
    expect(f.getHostLocalPositions(0)!.length).toBe(15);
    f.dispose();
  });

  it('setMaxAppMag is a no-op smoke (cull distances refresh internally)', () => {
    const f = new PlanetBodyField(makeSharedUniforms(6.5));
    f.attachHost(0, makePlanetSystem(0, 1), 4.83, new THREE.Vector3(), 0, 0);
    f.setMaxAppMag(15);
    f.setMaxAppMag(6.5);
    expect(f.group.visible).toBe(true);
    f.dispose();
  });

  it('exposes five render passes with the documented renderOrder layout', () => {
    // The contract is: orbit rings (2) sit BETWEEN the corrupt pass
    // (1.5, writes near-plane depth across the planet's core) and the
    // restore pass (2.5, writes the planet's actual depth back so the
    // disc/glow passes at 3/4 still depth-test correctly). If anyone
    // reorders these — e.g. moves restore before orbit rings — the
    // near-side ring will no longer be hidden by the planet body
    // (regressing the user-visible "planet looks solid" behaviour).
    // Pin each mesh by name → renderOrder so a swap fails CI.
    const f = new PlanetBodyField(makeSharedUniforms());
    const orderByName = new Map(
      f.group.children.map((m) => [m.name, m.renderOrder]),
    );
    expect(orderByName.get('core')).toBe(-4);
    expect(orderByName.get('corrupt')).toBe(1.5);
    expect(orderByName.get('restore')).toBe(2.5);
    expect(orderByName.get('disc')).toBe(3);
    expect(orderByName.get('glow')).toBe(4);
    expect(f.group.children).toHaveLength(5);
    f.dispose();
  });

  it('grows capacity when many hosts attach beyond the initial budget', () => {
    const f = new PlanetBodyField(makeSharedUniforms());
    // Initial capacity is 16; attach 20 single-planet hosts.
    for (let i = 0; i < 20; i++) {
      f.attachHost(i, makePlanetSystem(i, 1), 4.83, new THREE.Vector3(), 0, 0);
    }
    for (let i = 0; i < 20; i++) {
      const slice = f.getHostLocalPositions(i);
      expect(slice).not.toBeNull();
      expect(slice!.length).toBe(3);
    }
    f.dispose();
  });

  it('writes the Mallama coefficients into iPhaseCoefsA/B for the right slot', () => {
    // The PR adds iPhaseCoefsA = (c0,c1,c2,c3) and iPhaseCoefsB =
    // (c4,c5,c6,alphaMaxDeg) per-instance buffers plumbed through
    // allocate / grow / write-static / flush / shift-down. The
    // lifecycle tests above exercise the mechanics; this read-back
    // pins the buffer *contents* so a swapped index, miscopied stride
    // in growCapacity, or wrong shift in detachHost can't slip past.
    const f = new PlanetBodyField(makeSharedUniforms());
    // Three planets: bare (no coefs) | bare | Saturn (rich coefs).
    // Slot 2 is the one we read back.
    const ps: PlanetSystem = {
      hostStarIdx: 0,
      planets: [
        makePlanet({ name: 'P0' }),
        makePlanet({ name: 'P1' }),
        makePlanet({ name: 'P2-Saturn', phaseCoefficients: SATURN_PHASE }),
      ],
    };
    f.attachHost(0, ps, 4.83, new THREE.Vector3(), 0, 0);
    // Reach into the geometry. The cast is narrow and stable: the
    // class always exposes these as InstancedBufferAttribute.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geom = (f as any).geometry as THREE.InstancedBufferGeometry;
    const phaseA = (geom.attributes.iPhaseCoefsA as THREE.InstancedBufferAttribute)
      .array as Float32Array;
    const phaseB = (geom.attributes.iPhaseCoefsB as THREE.InstancedBufferAttribute)
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
    // gate at update():L353 — `if (dToHost > host.cullDistance) continue`
    // is what makes the bk5 "hundreds of hosts" scaling tractable. The
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
    f.attachHost(0, ps, 4.83, new THREE.Vector3(), 0, 0);
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
    f.update(camera, 0);
    expect(calls).toBe(2);
    f.update(camera, 1);
    expect(calls).toBe(3);

    // Camera past cullDistance → gate closes, positionsAt frozen.
    camera.position.set(cull * 2, 0, 0);
    f.update(camera, 2);
    expect(calls).toBe(3);
    f.update(camera, 3);
    expect(calls).toBe(3);

    // Back inside cullDistance → gate reopens.
    camera.position.set(cull * 0.5, 0, 0);
    f.update(camera, 4);
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
    f.attachHost(0, ps, 4.83, new THREE.Vector3(), 0, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hosts = (f as any).hosts as Map<number, { orientation: THREE.Quaternion }>;
    hosts.get(0)!.orientation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    // Force one update() tick well inside the cull distance.
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    f.update(camera, 0);

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
    f.attachHost(0, makePlanetSystem(0, 1), 4.83, hostAbs, 0, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = (f as any).bufHostLocalPos as Float32Array;
    expect(buf[0]).toBeCloseTo(1.5, 6);
    expect(buf[1]).toBeCloseTo(0,   6);
    expect(buf[2]).toBeCloseTo(2.0, 6);
    f.recenter(new THREE.Vector3(0.5, 0, 1.0));
    expect(buf[0]).toBeCloseTo(1.0, 6);
    expect(buf[1]).toBeCloseTo(0,   6);
    expect(buf[2]).toBeCloseTo(1.0, 6);
    f.dispose();
  });

  it('update() flushes only iLocalRel — the other 8 attributes stay clean per frame', () => {
    // bk5 scale (hundreds of hosts) makes per-frame re-uploads of
    // static attributes (iRadiusPc, iColour, iSolidity, iAlbedoP,
    // iHostAbsmag, iPhaseCoefsA/B, iHostLocalPos) measurable wasted
    // bus bandwidth. Pin the dynamic-only flush: after attach (which
    // legitimately touches every attribute) a single update() tick
    // only flips iLocalRel.
    const f = new PlanetBodyField(makeSharedUniforms(20));
    f.attachHost(
      0,
      {
        hostStarIdx: 0,
        planets: [makePlanet({ radiusKm: 6000 })],
        positionsAt: (_t, out) => { out[0] = 0; out[1] = 0; out[2] = 0; },
      },
      4.83,
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
    f.update(camera, 1);
    // Only iLocalRel should have been touched. iHostLocalPos /
    // iRadiusPc / iColour / iSolidity / iAlbedoP / iHostAbsmag /
    // iPhaseCoefsA / iPhaseCoefsB stay quiescent.
    expect(flagged.has('iLocalRel')).toBe(true);
    expect(flagged.size).toBe(1);
    f.dispose();
  });

  it('recenter flushes only iHostLocalPos — iLocalRel and statics stay clean', () => {
    // Recenter writes per-host hostLocalPos into its iHostLocalPos
    // slot but doesn't touch iLocalRel (planet positions in the host
    // plane frame are recenter-invariant). The narrow flush keeps the
    // floating-origin pivot cheap at bk5 scale.
    const f = new PlanetBodyField(makeSharedUniforms(20));
    f.attachHost(0, makePlanetSystem(0, 1), 4.83, new THREE.Vector3(1, 0, 0), 0, 0);
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
      new THREE.Vector3(),
      0,
      0,
    );
    expect(f.appMagFor(0, -1, new THREE.Vector3())).toBeNull();
    expect(f.appMagFor(0, 1, new THREE.Vector3())).toBeNull();
    expect(f.appMagFor(0, 0, new THREE.Vector3())).not.toBeNull();
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
    f.update(camera, 0);

    const got = f.appMagFor(0, 0, camera.position)!;
    // Hand-built expectation. Planet at +1 AU, host at origin, viewer
    // at −0.1 pc on the same axis.
    const dVp = 1 * AU_PC + 0.1;
    const dVh = 0.1;
    const dHp = 1 * AU_PC;
    const radiusPc = 6000 * KM_PC;
    // No Mallama coefs → Lambertian; α = 0 → φ = 1.
    const expected = planetApparentMagnitude(4.83, dVh, dVp, dHp, 0.5, radiusPc, 1);
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
      new THREE.Vector3(0, 0, 0),
      0,
      0,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hosts = (f as any).hosts as Map<number, { orientation: THREE.Quaternion }>;
    hosts.get(0)!.orientation.identity();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0.5 * AU_PC, 0.1, 0);
    f.update(camera, 0);

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
    const dVh = dh.length();
    const dHp = planetPos.length();
    const radiusPc = 6052 * KM_PC;
    const expected = planetApparentMagnitude(4.83, dVh, dVp, dHp, 0.689, radiusPc, phi);
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
    f.update(camera, 0);
    const hit = f.pick(camera, rectFor(800, 600), 400, 300, 8);
    expect(hit).not.toBeNull();
    expect(hit!.tier).toBe('prime');
    expect(hit!.idx).toBe(0);
    expect(hit!.hostStarIdx).toBe(0);
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
      new THREE.Vector3(0, 0, 0),
      0,
      0,
    );
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 1e-10, 1e10);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    f.update(camera, 0);
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
    f.update(camera, 0);

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

