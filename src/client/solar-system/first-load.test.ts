import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FIRST_LOAD_VIEW } from './first-load';
import { encodeBlob, decodeBlob } from '../util/url-state';
import { captureOrbitFrame, poseOutOfFrame } from '../attitude/attitude-pure';
import { focusedOrbitInto } from '../attitude/orbit-frame/orbit-plane';
import { PlanetBodyField } from './planets/planet-body-field';
import { makePlanetFieldUniforms } from './planets/planet-field-uniforms-fixture';
import { SOL_BODIES, getPlanetSystem } from './planet-system';
import type { Stellata } from '../stellata';
import { SOL_OBJECT_SIDS } from './sol-object-sids';
import { AU_PC, KM_PC, R_SUN_PC, SUN_ABSMAG_V } from '../util/astronomy-constants';
import { CHOSEN_FIRST_LOAD_AT, CHOSEN_FIRST_LOAD_LINK } from '../util/url-state/golden-links-fixture';

const DEG = Math.PI / 180;


/** Earth's ORB at `t`, through the field and dispatch the receiver runs. */
async function earthOrbitFrame(t: number) {
  const field = new PlanetBodyField(makePlanetFieldUniforms());
  const camera = new THREE.PerspectiveCamera();
  field.attachHost(0, (await getPlanetSystem(0, 0))!, SUN_ABSMAG_V, R_SUN_PC, new THREE.Vector3(), 0, t);
  field.update(camera, t, 0);
  const shell = { kinds: { planet: { field } }, getT: () => t } as unknown as Stellata;
  const orbit = { normal: new THREE.Vector3(), toCentre: new THREE.Vector3() };
  const earth = SOL_BODIES.findIndex((b) => b.name === 'Earth');
  expect(focusedOrbitInto(orbit, shell, { kind: 'planet', idx: earth })).toBe(true);
  field.dispose();
  return captureOrbitFrame(camera, orbit.normal, orbit.toCentre);
}

describe('first-load', () => {
  describe('FIRST_LOAD_VIEW', () => {
    it('focuses Earth', () => {
      expect(FIRST_LOAD_VIEW.focus).toEqual({ kind: 'sid', id: SOL_OBJECT_SIDS.earth });
    });

    it('arms ORB with the lock and holds the pose against the orbit', () => {
      expect(FIRST_LOAD_VIEW).toMatchObject({ orb: true, orbLock: true, orbitPose: true });
    });

    it('sits 8.82 million km out, 127 deg round from the Sun and 15.7 deg above the plane', () => {
      const [x, y, z] = FIRST_LOAD_VIEW.cam!;
      const r = Math.hypot(x, y, z);
      expect(Math.round(r / KM_PC / 1e4) / 100).toBe(8.82);
      expect(Math.atan2(y, x) / DEG).toBeCloseTo(-126.99, 2);
      expect(Math.asin(z / r) / DEG).toBeCloseTo(15.7, 2);
    });

    // ORB puts the Sun on +x a Sun–Earth distance out, so both follow from the
    // components alone, on any date.
    it('keeps the Sun 52 deg off the view axis and Earth 21% lit', () => {
      const cam = new THREE.Vector3(...FIRST_LOAD_VIEW.cam!);
      const sun = new THREE.Vector3(AU_PC, 0, 0);
      const viewAxis = cam.clone().negate();
      const sunOffAxis = viewAxis.angleTo(sun.clone().sub(cam)) / DEG;
      const phase = cam.angleTo(sun);
      expect(Math.round(sunOffAxis)).toBe(52);
      expect(Math.round(((1 + Math.cos(phase)) / 2) * 100)).toBe(21);
    });

    it('keeps the full declutter level and the HUD, with no constellation', () => {
      expect(FIRST_LOAD_VIEW.detailLevel).toBeUndefined();
      expect(FIRST_LOAD_VIEW.showHud).toBe(true);
      expect(FIRST_LOAD_VIEW.con).toBeUndefined();
    });

    it('round-trips through the wire format', () => {
      const view = decodeBlob(encodeBlob(FIRST_LOAD_VIEW));
      expect(view).toMatchObject({
        focus: FIRST_LOAD_VIEW.focus, showHud: true, orb: true, orbLock: true, orbitPose: true,
      });
      for (let i = 0; i < 3; i++) {
        expect(view.cam![i]).toBeCloseTo(FIRST_LOAD_VIEW.cam![i], 13);
        expect(view.up![i]).toBeCloseTo(FIRST_LOAD_VIEW.up![i], 6);
      }
    });

    // see README.md#first-load-default-and-mindistance-relaxation
    it('reproduces the chosen link at the instant it was shared', async () => {
      const frame = await earthOrbitFrame(CHOSEN_FIRST_LOAD_AT);
      const cam = new THREE.Vector3(...FIRST_LOAD_VIEW.cam!);
      const up = new THREE.Vector3(...FIRST_LOAD_VIEW.up!);
      poseOutOfFrame(cam, { x: 0, y: 0, z: 0 }, up, frame);

      const chosen = decodeBlob(CHOSEN_FIRST_LOAD_LINK);
      const chosenCam = new THREE.Vector3(...chosen.cam!);
      const chosenUp = new THREE.Vector3(...chosen.up!);
      expect(cam.angleTo(chosenCam) / DEG).toBeLessThan(0.01);
      expect(cam.length() / chosenCam.length()).toBeCloseTo(1, 5);
      // `up` is re-projected against the view axis on seating, so it is the
      // roll about that axis that has to agree.
      const axis = chosenCam.clone().normalize();
      const roll = up.clone().projectOnPlane(axis)
        .angleTo(chosenUp.clone().projectOnPlane(axis));
      expect(roll / DEG).toBeLessThan(0.01);
    });
  });
});
