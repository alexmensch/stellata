import { describe, expect, it } from 'vitest';

import { SPINE_COLUMNS, type SpineRow } from './inherited-spine-pure';
import {
  auditAssociations, formatAssociationReport, partitionRow, type LinkTables,
} from './association-audit-pure';
import type { SimbadXids } from './primaries-audit-pure';

function row(cells: Partial<SpineRow>): SpineRow {
  const out = {} as SpineRow;
  for (const c of SPINE_COLUMNS) out[c] = cells[c] ?? '';
  return out;
}

function links(overrides: Partial<LinkTables> = {}): LinkTables {
  return {
    tycHd: new Map([['1-1-1', new Set([100])]]),
    tycHip: new Map([['1-1-1', 10]]),
    hipHd: new Map([[20, new Set([200])]]),
    hrHd: new Map([[5, 100]]),
    glHip: (gl) => (gl === 'Gl 1' ? 10 : null),
    glHd: (gl) => (gl === 'Gl 2' ? 200 : null),
    sourceOf: {
      tyc: (tyc) => (tyc === '3-3-3' ? 'S3' : null),
      hip: (hip) => (hip === 30 ? 'S3' : hip === 40 ? 'S4' : null),
      gl: () => null,
    },
    simbad: (id): SimbadXids | undefined => (id === 'S4' ? { hip: 40, tyc: null, gj: 'GJ 4' } : undefined),
    ...overrides,
  };
}

describe('partitionRow', () => {
  it('skips a row carrying fewer than two key cells', () => {
    expect(partitionRow(row({ hip: '10' }), links())).toBeNull();
    expect(partitionRow(row({ proper: 'Sol' }), links())).toBeNull();
  });

  it('connects a row whose every association a primary publishes', () => {
    const p = partitionRow(row({ tyc: '1-1-1', hip: '10', hd: '100', hr: '5', gl: 'Gl 1' }), links())!;
    expect(p.partition).toEqual({ published: 'tyc+hip+hd+hr+gl', witnessed: 'tyc+hip+hd+hr+gl' });
    expect(p.minority).toEqual({ published: [], witnessed: [] });
  });

  it('links a GJ cell to its HD through V/70A', () => {
    const p = partitionRow(row({ hip: '20', hd: '200', gl: 'Gl 2' }), links())!;
    expect(p.minority.published).toEqual([]);
  });

  it('reports the cell no primary links, under both classes', () => {
    const p = partitionRow(row({ tyc: '1-1-1', hip: '10', hd: '999' }), links())!;
    expect(p.partition.published).toBe('tyc+hip | hd');
    expect(p.minority).toEqual({ published: ['hd'], witnessed: ['hd'] });
  });

  it('accepts the Gaia walks naming one source as a witnessed link only', () => {
    const p = partitionRow(row({ tyc: '3-3-3', hip: '30' }), links())!;
    expect(p.partition).toEqual({ published: 'hip | tyc', witnessed: 'tyc+hip' });
    expect(p.minority).toEqual({ published: ['tyc'], witnessed: [] });
  });

  it('accepts SIMBAD carrying the GJ under the HIP walk\'s source as a witnessed link only', () => {
    const p = partitionRow(row({ hip: '40', gl: 'GJ 4' }), links())!;
    expect(p.partition).toEqual({ published: 'gl | hip', witnessed: 'hip+gl' });
  });
});

describe('auditAssociations', () => {
  it('tallies the disconnected rows, their patterns and minority cells per class', () => {
    const spine = [
      row({ proper: 'Sol' }),
      row({ tyc: '1-1-1', hip: '10', hd: '100' }),
      row({ tyc: '1-1-1', hip: '10', hd: '999' }),
      row({ tyc: '3-3-3', hip: '30' }),
      row({ hip: '40', gl: 'GJ 4' }),
      row({ hip: '50', gl: 'GJ 5' }),
    ];
    const audit = auditAssociations(spine, links());
    expect(audit.summary).toEqual({
      rows: 6,
      multiRows: 5,
      disconnected: { published: 4, witnessed: 2 },
      minorityCells: { published: { hd: 1, tyc: 1, hip: 2 }, witnessed: { hd: 1, hip: 1 } },
      patterns: {
        published: { 'tyc+hip | hd': 1, 'hip | tyc': 1, 'gl | hip': 2 },
        witnessed: { 'tyc+hip | hd': 1, 'gl | hip': 1 },
      },
    });
    expect(audit.disconnected.map((d) => d.row.hip)).toEqual(['10', '50']);
    expect(formatAssociationReport(audit.summary)).toContain('disconnected under witnessed links: 2');
  });
});
