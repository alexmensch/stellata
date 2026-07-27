import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  clearChromeBindings,
  setBuiltinChromeColour,
  setChromeOperatorActive,
  setRawChromeColour,
} from './chrome-colour';
import { srgbDecode, tonemap, tonemapWhitePoint, type Rgb } from '../tonemap-pure';

const LW = tonemapWhitePoint();
const HEXES = [0x5a7a9c, 0xc8d6ff, 0x223344, 0xffffff, 0x000000];

afterEach(clearChromeBindings);

/** What the resolve pass puts on the canvas for an emission the layer
 *  wrote into the target. */
function resolved(colour: THREE.Color): Rgb {
  return tonemap([colour.r, colour.g, colour.b], LW);
}

function bytes(rgb: Rgb): [number, number, number] {
  return [
    Math.round(rgb[0] * 255),
    Math.round(rgb[1] * 255),
    Math.round(rgb[2] * 255),
  ];
}

describe('setBuiltinChromeColour', () => {
  it('resolves to the authored hex — three has already stopped encoding', () => {
    for (const hex of HEXES) {
      const colour = setBuiltinChromeColour(new THREE.Color(), hex);
      expect(bytes(resolved(colour))).toEqual([
        (hex >> 16) & 255,
        (hex >> 8) & 255,
        hex & 255,
      ]);
    }
  });
});

describe('setRawChromeColour', () => {
  it('resolves to what the custom shader wrote before the HDR target', () => {
    for (const hex of HEXES) {
      const legacy = new THREE.Color(hex);
      const colour = setRawChromeColour(new THREE.Color(), hex);
      expect(bytes(resolved(colour))).toEqual(bytes([legacy.r, legacy.g, legacy.b]));
    }
  });

  it('is darker than the built-in mapping — the same ColorManagement quirk', () => {
    const builtin = setBuiltinChromeColour(new THREE.Color(), 0x5a7a9c);
    const raw = setRawChromeColour(new THREE.Color(), 0x5a7a9c);
    expect(raw.g).toBeLessThan(builtin.g);
    expect(srgbDecode(resolved(raw)[1])).toBeLessThan(srgbDecode(resolved(builtin)[1]));
  });
});

// The mapping is only correct paired with the operator it inverts. Left in
// place with the operator off — the no-float-target fallback, and either
// dev switch — a rim shell renders at a tenth of its authored brightness.
describe('setChromeOperatorActive(false)', () => {
  it('restores the pre-HDR Color state for both variants', () => {
    for (const hex of HEXES) {
      const builtin = setBuiltinChromeColour(new THREE.Color(), hex);
      const raw = setRawChromeColour(new THREE.Color(), hex);
      setChromeOperatorActive(false);
      const legacy = new THREE.Color(hex);
      for (const c of [builtin, raw]) {
        expect(c.r).toBeCloseTo(legacy.r, 12);
        expect(c.g).toBeCloseTo(legacy.g, 12);
        expect(c.b).toBeCloseTo(legacy.b, 12);
      }
      setChromeOperatorActive(true);
      clearChromeBindings();
    }
  });

  it('re-maps colours registered while it was off', () => {
    setChromeOperatorActive(false);
    const colour = setRawChromeColour(new THREE.Color(), 0x5a7a9c);
    expect(colour.getHex()).toBe(new THREE.Color(0x5a7a9c).getHex());
    setChromeOperatorActive(true);
    expect(bytes(resolved(colour))).toEqual(bytes([
      new THREE.Color(0x5a7a9c).r,
      new THREE.Color(0x5a7a9c).g,
      new THREE.Color(0x5a7a9c).b,
    ]));
  });

  it('leaves chart-mode colours alone in either state', () => {
    const colour = setBuiltinChromeColour(new THREE.Color(), 0x14161e, true);
    const chartHex = colour.getHex();
    setChromeOperatorActive(false);
    expect(colour.getHex()).toBe(chartHex);
    setChromeOperatorActive(true);
    expect(colour.getHex()).toBe(chartHex);
  });
});
