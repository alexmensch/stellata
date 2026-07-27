import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { setBuiltinChromeColour, setRawChromeColour } from './chrome-colour';
import { srgbDecode, tonemap, tonemapWhitePoint, type Rgb } from './tonemap-pure';

const LW = tonemapWhitePoint();
const HEXES = [0x5a7a9c, 0xc8d6ff, 0x223344, 0xffffff, 0x000000];

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
