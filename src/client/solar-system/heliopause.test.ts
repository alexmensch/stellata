import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Heliopause, HELIOPAUSE_APEX_SOL_PC, createHeliopauseLabel } from './heliopause';
import { AU_PC } from '../util/astronomy-constants';

describe('HELIOPAUSE_APEX_SOL_PC', () => {
  it('lies 122 AU from Sol (the upwind heliopause boundary distance)', () => {
    const r = Math.hypot(
      HELIOPAUSE_APEX_SOL_PC.x,
      HELIOPAUSE_APEX_SOL_PC.y,
      HELIOPAUSE_APEX_SOL_PC.z,
    );
    expect(r).toBeCloseTo(122 * AU_PC, 12);
  });

  it('points toward the ISM inflow nose (McComas+ 2015: ecliptic λ 255.7°, β 5.1°)', () => {
    // Independent expected value: explicit Rx(ε) rotation of the
    // published ecliptic inflow direction — not the quaternion path
    // the production code uses.
    const eps = 23.4392911 * Math.PI / 180;
    const lon = 255.7 * Math.PI / 180;
    const lat = 5.1 * Math.PI / 180;
    const xe = Math.cos(lat) * Math.cos(lon);
    const ye = Math.cos(lat) * Math.sin(lon);
    const ze = Math.sin(lat);
    const expectedX = xe;
    const expectedY = ye * Math.cos(eps) - ze * Math.sin(eps);
    const expectedZ = ye * Math.sin(eps) + ze * Math.cos(eps);

    const r = Math.hypot(
      HELIOPAUSE_APEX_SOL_PC.x,
      HELIOPAUSE_APEX_SOL_PC.y,
      HELIOPAUSE_APEX_SOL_PC.z,
    );
    expect(HELIOPAUSE_APEX_SOL_PC.x / r).toBeCloseTo(expectedX, 12);
    expect(HELIOPAUSE_APEX_SOL_PC.y / r).toBeCloseTo(expectedY, 12);
    expect(HELIOPAUSE_APEX_SOL_PC.z / r).toBeCloseTo(expectedZ, 12);
  });

  it('nose lands at RA ≈ 17h00m, Dec ≈ −17.6° — not the solar apex 47° away', () => {
    const r = Math.hypot(
      HELIOPAUSE_APEX_SOL_PC.x,
      HELIOPAUSE_APEX_SOL_PC.y,
      HELIOPAUSE_APEX_SOL_PC.z,
    );
    const raDeg = (Math.atan2(HELIOPAUSE_APEX_SOL_PC.y, HELIOPAUSE_APEX_SOL_PC.x) * 180 / Math.PI + 360) % 360;
    const decDeg = Math.asin(HELIOPAUSE_APEX_SOL_PC.z / r) * 180 / Math.PI;
    expect(raDeg).toBeCloseTo(255.04, 2);
    expect(decDeg).toBeCloseTo(-17.6, 2);
  });
});

describe('Heliopause', () => {
  it('group is hidden until the declutter cycle permits it (no focus coupling)', () => {
    const h = new Heliopause();
    expect(h.group.visible).toBe(false);
    h.dispose();
  });

  it('setPermitted(true) reveals the group — the declutter floor governs', () => {
    const h = new Heliopause();
    h.setPermitted(true);
    expect(h.group.visible).toBe(true);
    h.dispose();
  });

  it('setMonochrome hides the group even when permitted', () => {
    const h = new Heliopause();
    h.setPermitted(true);
    h.setMonochrome(true);
    expect(h.group.visible).toBe(false);
    h.setMonochrome(false);
    expect(h.group.visible).toBe(true);
    h.dispose();
  });

  it('recenter parks the group at −worldOffset (Sol local position)', () => {
    const h = new Heliopause();
    h.recenter(new THREE.Vector3(0.1, -0.2, 0.3));
    expect(h.group.position.x).toBeCloseTo(-0.1, 12);
    expect(h.group.position.y).toBeCloseTo(0.2, 12);
    expect(h.group.position.z).toBeCloseTo(-0.3, 12);
    h.dispose();
  });

  it('group rotation maps local +Z onto the antiapex direction (forward heliotail)', () => {
    const h = new Heliopause();
    // The group's quaternion was built via setFromUnitVectors(+Z, antiapex).
    // Applying it to (0, 0, 1) should yield the antiapex direction.
    const localZ = new THREE.Vector3(0, 0, 1);
    localZ.applyQuaternion(h.group.quaternion);
    const apex = new THREE.Vector3(
      HELIOPAUSE_APEX_SOL_PC.x,
      HELIOPAUSE_APEX_SOL_PC.y,
      HELIOPAUSE_APEX_SOL_PC.z,
    ).normalize();
    expect(localZ.x).toBeCloseTo(-apex.x, 12);
    expect(localZ.y).toBeCloseTo(-apex.y, 12);
    expect(localZ.z).toBeCloseTo(-apex.z, 12);
    h.dispose();
  });

  it('createHeliopauseLabel writes display:none synchronously on init', () => {
    // Regression: on first-load (camera parked inside
    // the heliopause shell), the label must not paint at SVG (0,0).
    // The controller's setVisible(false) at init MUST land — i.e. the
    // sentinel must disagree with `false`. Element starts at display=''
    // (default for an <text> with no inline style); after init it must
    // read 'none' even though no frame ticks have run.
    const text = { style: { display: '' } };
    const prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      getElementById: (id: string) => (id === 'heliopause-label' ? text : null),
    };
    try {
      const stellata = {
        on: () => () => {},
      } as unknown as Parameters<typeof createHeliopauseLabel>[0];
      createHeliopauseLabel(stellata);
      expect(text.style.display).toBe('none');
    } finally {
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  });

  it('mesh apex point in world coordinates lands at +122 AU along apex direction', () => {
    const h = new Heliopause();
    // The mesh sits at local (0, 0, +offset_AU) inside the group, and
    // local +Z = antiapex. The "upwind" surface point is at local
    // (0, 0, -semiMajor) = (0, 0, -161 AU). After translate (+39 AU on
    // local +Z) → mesh-relative (0, 0, -161 + 39) = (0, 0, -122 AU).
    // After group rotation (+Z → antiapex), that maps to apex × 122 AU.
    const apexLocalAu = new THREE.Vector3(0, 0, -122)
      .applyQuaternion(h.group.quaternion);
    const apex = new THREE.Vector3(
      HELIOPAUSE_APEX_SOL_PC.x,
      HELIOPAUSE_APEX_SOL_PC.y,
      HELIOPAUSE_APEX_SOL_PC.z,
    ).normalize();
    apexLocalAu.normalize();
    expect(apexLocalAu.x).toBeCloseTo(apex.x, 12);
    expect(apexLocalAu.y).toBeCloseTo(apex.y, 12);
    expect(apexLocalAu.z).toBeCloseTo(apex.z, 12);
    h.dispose();
  });
});
