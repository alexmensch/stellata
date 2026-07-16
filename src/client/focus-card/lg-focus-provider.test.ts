import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';
import type { LgObject } from '../local-group/local-group-loader';
import { setUnit } from '../ui/distance-util';
import {
  createLgFocusProvider,
  lgAbsoluteMag,
  lgApparentMagFrom,
} from './lg-focus-provider';

const M31: LgObject = {
  name: 'M31',
  id: 'm31',
  type: 'Spiral galaxy',
  aliases: ['Andromeda Galaxy', 'NGC 224'],
  sid: 1,
  centerAbs: new THREE.Vector3(776_000, 0, 0),
  kind: 'disc',
  axes: [15000, 15000, 500],
  quat: new THREE.Quaternion(),
  source: 'OVERRIDE',
  distanceFromSol: 776_000,
  emission: {
    family: 'disc',
    mV: 3.44,
    rdPc: 5300,
    zdPc: 500 / 3,
    rEnvPc: 21200,
    zEnvPc: 2000 / 3,
    density0: 0.34273291,
  },
};

describe('lg magnitude helpers', () => {
  it('apparent mag reproduces the catalog value at the catalog distance', () => {
    expect(lgApparentMagFrom(3.44, 776_000, 776_000)).toBeCloseTo(3.44, 12);
  });
  it('apparent mag brightens 5 mag per 10× approach', () => {
    expect(lgApparentMagFrom(3.44, 776_000, 77_600)).toBeCloseTo(-1.56, 10);
  });
  it('absolute mag pins M31 at the RC3-derived value', () => {
    expect(lgAbsoluteMag(3.44, 776_000)).toBeCloseTo(-21.01, 2);
  });
});

describe('createLgFocusProvider', () => {
  beforeEach(() => setUnit('pc'));

  it('formats the identity + rows off the loaded object', () => {
    let camDist = 776_000;
    const provider = createLgFocusProvider({
      objects: [M31],
      cameraDistancePc: () => camDist,
    });
    const card = provider.format(0);
    expect(card.name).toBe('M31');
    expect(card.identityLines).toEqual(['Spiral galaxy', 'Andromeda Galaxy · NGC 224']);
    const byLabel = new Map(card.rows.map((r) => [r.label, r.value]));
    expect((byLabel.get('Apparent mag') as () => string)()).toBe('3.4');
    camDist = 77_600;
    expect((byLabel.get('Apparent mag') as () => string)()).toBe('-1.6');
    expect(byLabel.get('Absolute mag')).toBe('-21.0');
    expect(byLabel.get('Known from')).toBe('Curated (SCIENCE.md)');
    expect(typeof byLabel.get('Distance')).toBe('function');
  });

  it('returns an empty card when the layer is absent', () => {
    const provider = createLgFocusProvider({ objects: null, cameraDistancePc: () => 0 });
    expect(provider.format(0)).toEqual({ name: '', identityLines: [], rows: [], lines: [] });
  });
});
