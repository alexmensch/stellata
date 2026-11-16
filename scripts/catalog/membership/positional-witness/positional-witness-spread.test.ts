import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../../src/catalog-format/pipeline-outputs/data-files';
import { REPO_ROOT, lfsContentReadable } from '../../../util/paths';
import { lookupGliese } from '../../gliese-parse-pure';
import { GLIESE } from '../../gliese-source';
import { HIP2 } from '../../sources/hip2-source';
import type { Tycho2Row } from '../../tycho2-parse';
import { TYCHO2 } from '../../tycho2-source';
import { MERGE_DIVERGENCE } from '../merge-divergence-tsv';
import { PAIR_REVIEW } from '../pair-review-tsv';
import {
  hipparcosAstrometry, witnessHipparcos, witnessV70a, type WitnessVerdict,
} from './positional-witness-pure';

const readable = [
  DATA_FILES.tycho2Main, DATA_FILES.tycho2Suppl1, DATA_FILES.gliese, DATA_FILES.hip2,
].every((f) => lfsContentReadable(resolve(REPO_ROOT, f)));

function tallyKinds(verdicts: readonly WitnessVerdict[]): Record<WitnessVerdict['kind'], number> {
  const out = { match: 0, none: 0, several: 0 };
  for (const v of verdicts) out[v.kind]++;
  return out;
}

describe.skipIf(!readable)('the witness over the committed queues (README.md#the-tolerances)', () => {
  const tycho2 = TYCHO2.read();
  const candidates = (tycs: readonly string[]): Tycho2Row[] => tycs.map((tyc) => {
    const entry = tycho2.get(tyc);
    if (entry === undefined) throw new Error(`${tyc}: no Tycho-2 row`);
    return entry;
  });

  it("settles the pair queue's no_hip_source HIPs on HIP2's position", () => {
    const hip2 = HIP2.read().astrometry;
    const rows = PAIR_REVIEW.parse(readFileSync(resolve(REPO_ROOT, PAIR_REVIEW.file), 'utf-8'))
      .filter((r) => r.reason === 'no_hip_source');
    const verdicts = rows.map((r) => {
      const row = hip2.get(r.hip!);
      const hip = row === undefined ? null : hipparcosAstrometry(row);
      if (hip === null) throw new Error(`HIP ${r.hip}: no HIP2 position and proper motion`);
      return witnessHipparcos(hip, candidates(r.entries));
    });
    expect(rows.length).toBe(1046);
    expect(tallyKinds(verdicts)).toEqual({ match: 1034, none: 2, several: 10 });
  });

  it("tests each unlinked GJ cell's V/70A position against the row's own TYC", () => {
    const gliese = GLIESE.read();
    const rows = MERGE_DIVERGENCE.parse(readFileSync(resolve(REPO_ROOT, MERGE_DIVERGENCE.file), 'utf-8'))
      .filter((r) => r.divergence === 'unlinked' && r.gl !== null && r.tyc !== null);
    const astrometry = rows.map((r) => ({ r, a: lookupGliese(gliese, r.gl)?.astrometryB1950 ?? null }));
    const witnessed = astrometry.flatMap(({ r, a }) => (a === null ? [] : [witnessV70a(a, candidates([r.tyc!]))]));
    expect(rows.length).toBe(132);
    expect(astrometry.length - witnessed.length).toBe(23);
    expect(tallyKinds(witnessed)).toEqual({ match: 84, none: 25, several: 0 });
  });
});
