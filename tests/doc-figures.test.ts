import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanCatalogueSize, scanDocFigures, SIZE_EXEMPTIONS_FILE } from '../scripts/doc-figures/doc-figures';

const ROOT = resolve(__dirname, '..');

describe('doc figures agree with the count snapshots', () => {
  const scans = scanDocFigures(ROOT);

  it('every marker parses and resolves to a snapshot number', () => {
    expect(scans.flatMap(({ file, report }) => report.problems.map((p) => `${file}: ${p}`))).toEqual([]);
  });

  it('every marked figure matches its snapshot — run pnpm run docs:figures', () => {
    expect(scans.flatMap(({ file, report }) => report.stale.map((s) => `${file}: ${s}`))).toEqual([]);
  });
});

describe('the catalogue states its own size', () => {
  const { offenders, unusedExemptions } = scanCatalogueSize(ROOT);

  it('quotes it only through a marker, or as the current rounding where no marker fits', () => {
    expect(offenders).toEqual([]);
  });

  it(`${SIZE_EXEMPTIONS_FILE} only shrinks: every entry still matches a figure`, () => {
    expect(unusedExemptions).toEqual([]);
  });
});
