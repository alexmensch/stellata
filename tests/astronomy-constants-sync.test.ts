// Pins the Python mirror at scripts/util/astronomy_constants.py to the
// TS canonical at src/client/util/astronomy-constants.ts. Value drift
// between the two files is what this test catches; the README and
// import statements give no compile-time guarantee.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

function parsePyConstants(): Record<string, number> {
  const text = readFileSync(
    resolve(ROOT, 'scripts/util/astronomy_constants.py'),
    'utf8',
  );
  const out: Record<string, number> = {};
  for (const line of text.split('\n')) {
    // Top-level `NAME = NUMBER` lines (no leading indent so we skip
    // any in-function locals).
    const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*([-+]?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?)\s*$/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

describe('astronomy_constants.py mirrors astronomy-constants.ts', () => {
  it('every Python constant matches the TS canonical value', async () => {
    const py = parsePyConstants();
    const ts = await import('../src/client/util/astronomy-constants');
    for (const [name, pyValue] of Object.entries(py)) {
      expect(name in ts, `TS canonical missing constant ${name}`).toBe(true);
      const tsValue = (ts as unknown as Record<string, number>)[name];
      expect(
        pyValue,
        `${name}: Python (${pyValue}) ≠ TS (${tsValue})`,
      ).toBe(tsValue);
    }
  });

  it('has at least the two constants the binaries pipeline relies on', () => {
    const py = parsePyConstants();
    expect(py).toHaveProperty('J2000_JD');
    expect(py).toHaveProperty('DAYS_PER_JULIAN_YEAR');
  });
});
