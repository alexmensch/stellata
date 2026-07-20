import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AU_PC } from '../util/astronomy-constants';
import { ShellRegistry, type ShellInstance } from './shell-registry';

function makeShell(extentPc: number): ShellInstance {
  return {
    label: 'Test Shell',
    sid: 1,
    card: { typeLine: 't', size: 's', knownFrom: 'k' },
    centerAbsInto: (out) => {
      out.set(0, 0, 0);
      return true;
    },
    extentPc: () => extentPc,
    pick: { labelElementId: 'x', visible: () => true, sampleCount: () => 0, sampleLocalInto: () => {} },
  };
}

describe('ShellRegistry', () => {
  it('at / keyOf map the Target idx to the SHELL_KEYS slot', () => {
    const r = new ShellRegistry();
    r.register('heliopause', makeShell(1));
    expect(r.count).toBe(2);
    expect(r.keyOf(0)).toBe('local_bubble');
    expect(r.keyOf(1)).toBe('heliopause');
    expect(r.at(0)).toBeNull(); // local_bubble slot unregistered
    expect(r.at(1)?.label).toBe('Test Shell');
    expect(r.at(9)).toBeNull();
  });

  it('frames an AU-scale shell without the 5 pc floor (heliopause regression)', () => {
    // ~200 AU heliopause: viewing distance must be ~2.4 × extent (a few
    // hundred AU), NOT the shared 5 pc default floor (~1e6 AU away, where
    // the shell is invisibly small).
    const r = new ShellRegistry();
    const extent = 200 * AU_PC;
    r.register('heliopause', makeShell(extent));
    expect(r.viewingDistancePc(1)).toBeCloseTo(extent * 2.4, 10);
    expect(r.viewingDistancePc(1)).toBeLessThan(0.01); // nowhere near the 5 pc floor
  });

  it('frames a pc-scale shell at 2.4 × extent (Local Bubble)', () => {
    const r = new ShellRegistry();
    r.register('local_bubble', makeShell(300));
    expect(r.viewingDistancePc(0)).toBeCloseTo(720, 6);
    expect(r.focusParkDistancePc(0)).toBeCloseTo(720, 6);
  });

  it('reports zero distances for an unregistered slot', () => {
    const r = new ShellRegistry();
    expect(r.viewingDistancePc(0)).toBe(0);
    expect(r.focusParkDistancePc(0)).toBe(0);
    expect(r.cameraDistancePc(0, new THREE.Vector3(), new THREE.Vector3())).toBe(0);
  });
});
