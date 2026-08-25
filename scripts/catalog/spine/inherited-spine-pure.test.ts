import { describe, expect, it } from 'vitest';

import {
  SPINE_COLUMNS,
  SPINE_PRINTED_COLUMNS,
  buildSpineRow,
  iterSpineTsv,
  parseSpineTsv,
  serializeSpine,
  spineCounts,
  spineDesignations,
  type SpinePrintedCells,
  type SpineRow,
} from './inherited-spine-pure';
import { makeStar } from '../parse/star-fixture';

function printed(overrides: Partial<SpinePrintedCells> = {}): SpinePrintedCells {
  const cells = {} as SpinePrintedCells;
  for (const column of SPINE_PRINTED_COLUMNS) cells[column] = '';
  return { ...cells, ...overrides };
}

function row(overrides: Partial<SpineRow> = {}): SpineRow {
  return { ...buildSpineRow(makeStar(), printed()), ...overrides };
}

describe('spine column layout', () => {
  it('carries every column docs/catalog-driver.md § 3 specifies', () => {
    expect(SPINE_COLUMNS).toEqual([
      'tyc', 'hip', 'hd', 'hr', 'gl', 'flam', 'bayer', 'proper',
      'gaia_source_id', 'ra', 'dec', 'dist', 'mag', 'ci', 'spect', 'rv',
      'pm_ra', 'pm_dec',
      'pos_src', 'dist_src', 'mag_src', 'rv_src', 'pm_src', 'spect_src',
    ]);
  });

  it('sources identifiers from the record and everything else from the CSV', () => {
    expect(SPINE_PRINTED_COLUMNS).not.toContain('hip');
    expect(SPINE_PRINTED_COLUMNS).toContain('tyc');
  });
});

describe('buildSpineRow', () => {
  it('takes identifiers from the resolved record, printed cells verbatim', () => {
    const built = buildSpineRow(
      makeStar({ hip: 32349, hd: 48915, gaiaSourceId: '2947050466531873024' }),
      printed({ tyc: '5949-2777-1', mag: '-1.44', spect: 'A0m...' }),
    );
    expect(built.hip).toBe('32349');
    expect(built.hd).toBe('48915');
    expect(built.gaia_source_id).toBe('2947050466531873024');
    expect(built.tyc).toBe('5949-2777-1');
    expect(built.spect).toBe('A0m...');
  });

  it('writes an absent identifier as an empty cell', () => {
    const built = buildSpineRow(makeStar(), printed());
    expect(built.hip).toBe('');
    expect(built.gaia_source_id).toBe('');
  });
});

describe('serializeSpine / parseSpineTsv', () => {
  it('round-trips rows through the header-checked codec', () => {
    const rows = [
      row({ hip: '1', proper: 'Alpha' }),
      row({ hd: '2', spect: 'G2 V' }),
    ];
    expect(parseSpineTsv(serializeSpine(rows))).toEqual(rows);
  });

  it('rejects a cell holding a TSV delimiter', () => {
    expect(() => serializeSpine([row({ proper: 'a\tb' })])).toThrow(/delimiter/);
  });

  it('rejects a header that is not the current column list', () => {
    expect(() => parseSpineTsv('hip\thd\n1\t2\n')).toThrow(/header mismatch/);
  });

  it('rejects a row whose cell count disagrees with the header', () => {
    const text = `${SPINE_COLUMNS.join('\t')}\n1\t2\n`;
    expect(() => parseSpineTsv(text))
      .toThrow(new RegExp(`expected ${SPINE_COLUMNS.length}`));
  });

  // The header has exactly as many cells as a data row, so a walk that reads
  // it twice yields a row of column names — 'hip' parsing as a designation.
  it('yields nothing from a header with no data rows, terminated or not', () => {
    expect(parseSpineTsv(`${SPINE_COLUMNS.join('\t')}\n`)).toEqual([]);
    expect(parseSpineTsv(SPINE_COLUMNS.join('\t'))).toEqual([]);
  });

  it('walks lazily — readStars must not hold all 313,257 rows at once', () => {
    const text = serializeSpine([row({ hip: '1' }), row({ hip: '2' })]);
    const walk = iterSpineTsv(text);
    expect(walk.next().value?.hip).toBe('1');
    expect(walk.next().value?.hip).toBe('2');
    expect(walk.next().done).toBe(true);
  });
});

describe('spineCounts', () => {
  it('counts rows carrying a value per column', () => {
    const counts = spineCounts([row({ hip: '1' }), row({ hip: '', hd: '2' })]);
    expect(counts.rows).toBe(2);
    expect(counts.nonEmpty.hip).toBe(1);
    expect(counts.nonEmpty.hd).toBe(1);
    expect(counts.nonEmpty.hr).toBe(0);
  });
});

describe('spineDesignations', () => {
  it('recovers the ladder-ordered set starDesignations builds', () => {
    expect(spineDesignations(row({
      hip: '32349', hd: '48915', hr: '2491', gaia_source_id: '2947050466531873024',
    }))).toEqual([
      'hip:32349', 'hd:48915', 'hr:2491', 'gaia_dr3:2947050466531873024',
    ]);
  });

  it('keys Sol off its proper name — its only designation', () => {
    expect(spineDesignations(row({ proper: 'Sol' }))).toEqual(['sol:sun']);
  });

  it('collapses whitespace in a Gliese key', () => {
    expect(spineDesignations(row({ gl: 'Gl 559A' }))).toEqual(['gl:Gl_559A']);
  });

  it('rejects an integer cell that would not round-trip', () => {
    expect(() => spineDesignations(row({ hd: '48915.0' }))).toThrow(/round-trippable/);
  });
});
