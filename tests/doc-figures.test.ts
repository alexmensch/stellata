import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docFiles, loadSnapshots } from '../scripts/doc-figures/doc-figures';
import { renderFigures } from '../scripts/doc-figures/doc-figures-pure';

const ROOT = resolve(__dirname, '..');

describe('doc figures agree with the count snapshots', () => {
  const snapshots = loadSnapshots(ROOT);
  const reports = docFiles(ROOT).map((f) => ({ f, report: renderFigures(readFileSync(join(ROOT, f), 'utf8'), snapshots) }));

  it('every marker parses and resolves to a snapshot number', () => {
    expect(reports.flatMap(({ f, report }) => report.problems.map((p) => `${f}: ${p}`))).toEqual([]);
  });

  it('every marked figure matches its snapshot — run pnpm run docs:figures', () => {
    expect(reports.flatMap(({ f, report }) => report.stale.map((s) => `${f}: ${s}`))).toEqual([]);
  });
});
