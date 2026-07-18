import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOL_PLANETS } from '../../src/client/solar-system/planet-system';

// build-textures.py can't import the TS SOL_PLANETS table, so it
// carries its own REPRESENTATIVE_COLOURS copies for the Mercury tint
// and gap fills. This pin keeps the two in lockstep — a colour
// retune in planet-system.ts fails here until the build script (and
// its artifacts) follow.

function pyColours(): Record<string, [number, number, number]> {
  const src = readFileSync(resolve(__dirname, 'build-textures.py'), 'utf-8');
  const block = src.match(/REPRESENTATIVE_COLOURS = \{([^}]*)\}/);
  expect(block).not.toBeNull();
  const out: Record<string, [number, number, number]> = {};
  for (const m of block![1].matchAll(
    /"([a-z-]+)": \(([\d.]+), ([\d.]+), ([\d.]+)\)/g,
  )) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

describe('build-textures.py representative colours', () => {
  it('match SOL_PLANETS for every body the script treats', () => {
    const colours = pyColours();
    expect(Object.keys(colours).length).toBeGreaterThan(0);
    for (const [name, rgb] of Object.entries(colours)) {
      const planet = SOL_PLANETS.find((p) => p.name.toLowerCase() === name);
      expect(planet, `unknown body "${name}" in build-textures.py`).toBeDefined();
      expect(rgb).toEqual([...planet!.colour]);
    }
  });
});
