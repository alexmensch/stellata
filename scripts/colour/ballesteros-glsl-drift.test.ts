import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// star.vert.glsl mirrors ballesterosBvFromTeff (and the upstream
// ballesterosTeff coefficients) by hand — a silent drift on either side
// would change observed star chromaticity for ~85% of stars at runtime
// without breaking any current test.
//
// This file pins the GLSL function body byte-for-byte against the TS
// impl's literals. Intentional edits update both sides AND this assertion.

const GLSL_PATH = join(import.meta.dirname, '..', '..', 'src', 'client', 'star-pipeline', 'star.vert.glsl');
const GLSL = readFileSync(GLSL_PATH, 'utf8');

function extractBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`signature not found in star.vert.glsl: ${signature}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(braceStart + 1, i).trim();
    }
  }
  throw new Error(`unterminated function body for ${signature}`);
}

describe('ballesteros GLSL ↔ TS drift check', () => {
  it('ballesterosBvFromTeff GLSL body matches the canonical literals', () => {
    const body = extractBody(GLSL, 'float ballesterosBvFromTeff(float teff)');
    // Each coefficient appears exactly where the TS impl uses it.
    // Drift on any of these changes the chromaticity routing path.
    expect(body).toContain('4600.0');
    expect(body).toContain('1.1664');
    expect(body).toContain('2.32');
    expect(body).toContain('0.92');
    // Pin the full body so a coefficient reshuffle or sign flip fails the
    // test even if all four literals stay present.
    expect(body).toMatchInlineSnapshot(`
      "float k = teff / 4600.0;
          float disc = sqrt(4.0 + 1.1664 * k * k);
          float u = (2.0 - 2.32 * k + disc) / (2.0 * k);
          return u / 0.92;"
    `);
  });
});
