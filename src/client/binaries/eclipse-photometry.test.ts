import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EclipsePhotometryField } from './eclipse-photometry';
import {
  FLAG_HAS_ORBIT,
  FLAG_HAS_INCLINATION,
  NO_PARENT,
  type BinariesData,
  type BinaryRelation,
} from './binaries-loader';
import { J2000_JD } from '../util/astronomy-constants';

// Minimal fixture: 3 stars (primary, secondary, control), one pair with
// orbital elements.
function makeFixture(positions: Float32Array) {
  const absoluteMags = new Float32Array([2.0, 5.0, 6.0]);
  const physicalRadiusSolar = new Float32Array([10, 5, 1]);
  const localPositions = new Float32Array(positions);
  // Caller-init contract: integration shell sets the buffer to 1.0 on
  // allocation + re-attach; the field reads/writes but doesn't own that
  // lifecycle. See stellata.ts attachBinaries.
  const eclipseDimBuffer = new Float32Array(3).fill(1);
  const iEclipseDimAttr = new THREE.InstancedBufferAttribute(eclipseDimBuffer, 1);

  const rel: BinaryRelation = {
    primaryIdx: 0,
    secondaryIdx: 1,
    flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
    parentRelation: NO_PARENT,
    pDays: 2.87,
    tJd: J2000_JD,
    e: 0,
    aAU: 0.06,
    iRad: Math.PI / 2,
    omegaRad: 0,
    OmegaRad: 0,
    q: 0.4,
    sepArcsec: 1,
    paDeg: 0,
    sepPaEpochJd: J2000_JD,
  };
  const binaries: BinariesData = {
    version: 1,
    relations: [rel],
    primaryIdxToRelations: new Map([[0, [0]]]),
    secondaryIdxToRelation: new Map([[1, 0]]),
  };

  return {
    binaries,
    absoluteMags,
    physicalRadiusSolar,
    localPositions,
    eclipseDimBuffer,
    iEclipseDimAttr,
  };
}

describe('EclipsePhotometryField construction', () => {
  it('caches one entry per has_orbit relation', () => {
    const positions = new Float32Array([10, 0, 0, 10, 0, 0, 100, 0, 0]);
    const fx = makeFixture(positions);
    const field = new EclipsePhotometryField(fx);
    expect(field.cachedRelations).toHaveLength(1);
  });
});

describe('EclipsePhotometryField.update — no overlap', () => {
  it('leaves dim at 1.0 when the pair is widely separated on the sky', () => {
    const positions = new Float32Array([10, 0, 0, 10, 0.5, 0, 100, 0, 0]);
    const fx = makeFixture(positions);
    const field = new EclipsePhotometryField(fx);
    field.update(new THREE.Vector3(0, 0, 0), 6);
    expect(fx.eclipseDimBuffer[0]).toBe(1);
    expect(fx.eclipseDimBuffer[1]).toBe(1);
  });
});

describe('EclipsePhotometryField.update — geometric eclipse', () => {
  it('writes dim < 1 onto the back star when discs overlap', () => {
    // Primary at 10 pc, secondary 1e-6 pc closer to the camera but at
    // the same sky position → secondary is in front; primary is back
    // and gets a fractional dim from the small front disc on the
    // larger back disc.
    const dPri = 10;
    const dSec = dPri - 1e-6;
    const positions = new Float32Array([
      dPri, 0, 0,
      dSec, 0, 0,
      100, 0, 0,
    ]);
    const fx = makeFixture(positions);
    const field = new EclipsePhotometryField(fx);
    field.update(new THREE.Vector3(0, 0, 0), 6);
    // Primary is back (further from camera), secondary is front.
    expect(fx.eclipseDimBuffer[0]).toBeLessThan(1);
    expect(fx.eclipseDimBuffer[0]).toBeGreaterThan(0);
    expect(fx.eclipseDimBuffer[1]).toBe(1);
  });

  it('resets last-frame dim when this frame has no overlap', () => {
    // Frame 1: collinear → dim < 1 on the primary.
    const positions = new Float32Array([
      10, 0, 0,
      9.999999, 0, 0,
      100, 0, 0,
    ]);
    const fx = makeFixture(positions);
    const field = new EclipsePhotometryField(fx);
    field.update(new THREE.Vector3(0, 0, 0), 6);
    expect(fx.eclipseDimBuffer[0]).toBeLessThan(1);
    // Frame 2: move the secondary far off the sky → no overlap → dim
    // should clear back to 1.0 on the primary.
    fx.localPositions[3] = 9.999999;
    fx.localPositions[4] = 1.0;
    field.update(new THREE.Vector3(0, 0, 0), 6);
    expect(fx.eclipseDimBuffer[0]).toBe(1);
  });
});

describe('EclipsePhotometryField.update — visibility prefilter', () => {
  it('skips relations whose primary is below the magnitude limit', () => {
    // Set a tight magnitude cutoff so the primary fails the prefilter
    // even at close range. Even if a geometric eclipse would occur, the
    // dim isn't written because the pair would be off-screen anyway.
    const dPri = 10;
    const dSec = dPri - 1e-6;
    const positions = new Float32Array([
      dPri, 0, 0,
      dSec, 0, 0,
      100, 0, 0,
    ]);
    const fx = makeFixture(positions);
    const field = new EclipsePhotometryField(fx);
    // appMag for primary at d=10pc with absmag=2 equals 2 (5·log10(10/10)=0).
    // Set maxAppMag to 0 → prefilter rejects (0.5 < 2).
    field.update(new THREE.Vector3(0, 0, 0), 0);
    expect(fx.eclipseDimBuffer[0]).toBe(1);
  });
});
