import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanDocFigures } from '../scripts/doc-figures/doc-figures';

describe('doc figures agree with the count snapshots', () => {
  const scans = scanDocFigures(resolve(__dirname, '..'));

  it('every marker parses and resolves to a snapshot number', () => {
    expect(scans.flatMap(({ file, report }) => report.problems.map((p) => `${file}: ${p}`))).toEqual([]);
  });

  it('every marked figure matches its snapshot — run pnpm run docs:figures', () => {
    expect(scans.flatMap(({ file, report }) => report.stale.map((s) => `${file}: ${s}`))).toEqual([]);
  });
});
