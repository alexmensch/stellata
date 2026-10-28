import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../util/paths';
import { MULTIPLES_COLUMNS, MULTIPLES_TSV } from './multiples-tsv';

const PATH = resolve(REPO_ROOT, MULTIPLES_TSV.file);

describe.skipIf(!lfsContentReadable(PATH))('multiples.tsv codec over the committed file', () => {
  const text = readFileSync(PATH, 'utf8');

  it('round-trips byte for byte', () => {
    expect(MULTIPLES_TSV.serialize(MULTIPLES_TSV.parse(text)) === text).toBe(true);
  });
});

describe('multiples.tsv codec', () => {
  const header = MULTIPLES_COLUMNS.join('\t');
  const cells = (over: Record<string, string>) => MULTIPLES_COLUMNS.map((c) => over[c] ?? ({
    source: 'wds', regime: '0', resolve_via: 'unresolved', astrometry_via: 'gaia_5p', orbit_via: 'none',
    spect_via: 'none', photometry_via: 'none', a_via: 'none', orbit_role: 'primary',
  } as Record<string, string>)[c] ?? '').join('\t');

  it('keeps a negative zero the writer printed', () => {
    const text = `${header}\n${cells({ x_pc: '-0.000000' })}\n`;
    expect(MULTIPLES_TSV.serialize(MULTIPLES_TSV.parse(text))).toBe(text);
  });

  it('rejects a value outside a closed column', () => {
    expect(() => MULTIPLES_TSV.parse(`${header}\n${cells({ photometry_via: 'athyg' })}\n`))
      .toThrow(/photometry_via: "athyg" is not one of/);
  });

  it('rejects a source_id that is not digits', () => {
    expect(() => MULTIPLES_TSV.parse(`${header}\n${cells({ gaia_source_id: '12a' })}\n`))
      .toThrow(/gaia_source_id "12a" is not a source_id/);
  });
});
