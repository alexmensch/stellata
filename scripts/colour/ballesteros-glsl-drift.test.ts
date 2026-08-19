import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BALLESTEROS_BV_SCALE, BALLESTEROS_DISC_K2, BALLESTEROS_QUAD_LINEAR, BALLESTEROS_T0,
} from './blackbody-lut-pure';

// Pin the GLSL ballesterosBvFromTeff body against the exported
// coefficients — GLSL cannot import them, so this scan is what ties its
// literals to the definition the TS and TSL mirrors share. Intentional
// edits update the constants AND the inline snapshot.

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
    // Each coefficient appears exactly where the exported constant is used.
    // Drift on any of these changes the chromaticity routing path.
    expect(body).toContain(`/ ${BALLESTEROS_T0.toFixed(1)};`);
    expect(body).toContain(`${BALLESTEROS_DISC_K2} * k * k`);
    expect(body).toContain(`${BALLESTEROS_QUAD_LINEAR} * k`);
    expect(body).toContain(`/ ${BALLESTEROS_BV_SCALE};`);
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
