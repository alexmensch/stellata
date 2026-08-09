// The swap parity ledger's committed gates: the route-disagreement review
// join, the canonical-key audit over the label delta, and the V/50 HD-less
// out-of-scope pin. See ../spine/README.md § The swap parity ledger.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { dataRows, nonEmpty } from '../parse/corpus-tsv';
import { REPO_ROOT, lfsContentReadable } from '../../util/paths';
import { LEDGER_PATH, OVERRIDES_PATH } from '../../sid/registry-io';
import { parseLedgerTsv, parseSameasTsv } from '../../sid/sid-pure';
import { INHERITED_SPINE_FILE, iterSpineTsv } from '../spine/inherited-spine-pure';
import { parseBsc5Tsv } from './classic-ids-parse';
import {
  LABEL_FLIPS_FILE,
  parseLabelFlipsTsv,
  spineDesignationsRemovedBy,
} from './label-merge-pure';

const QUEUE_PATH = resolve(REPO_ROOT, 'data/classic-ids/hd_hip_route_disagreements.tsv');
const REVIEW_PATH = resolve(REPO_ROOT, 'data/classic-ids/hd_hip_route_disagreements_review.tsv');
const BSC5_PATH = resolve(REPO_ROOT, 'data/classic-ids/bsc5.tsv');
const SPINE_PATH = resolve(REPO_ROOT, INHERITED_SPINE_FILE);

const REVIEW_HINT = 'Dispose the row in hd_hip_route_disagreements_review.tsv.';
const IDENTITY_VERDICTS = new Set(['no-identity-event', 'merge', 'split']);

/** V/50's HD-less entries — novae/supernovae, four clusters (47 Tuc,
 *  NGC 2281, M 67, NGC 2808) and M 31. Out of scope by class, so the pin is
 *  both that V/50 still carries exactly these and that none is a record. */
const HD_LESS_HR = [
  92, 95, 182, 1057, 1841, 2472, 2496, 3515, 3671, 6309, 6515, 7189, 7539, 8296,
];

const queueKeys = [...dataRows(
  readFileSync(QUEUE_PATH, 'utf-8'),
  ['hd', 'hip'],
  'hd_hip_route_disagreements.tsv',
  'Re-run `pnpm run build:classic-ids`.',
)].map(({ cells, idx }) => `${cells[idx.hd]}\t${cells[idx.hip]}`);

const review = [...dataRows(
  readFileSync(REVIEW_PATH, 'utf-8'),
  ['hd', 'hip', 'verdict', 'note'],
  'hd_hip_route_disagreements_review.tsv',
  REVIEW_HINT,
)].map(({ cells, idx }) => ({
  key: `${cells[idx.hd]}\t${cells[idx.hip]}`,
  verdict: cells[idx.verdict],
  note: nonEmpty(cells[idx.note]),
}));

describe('HD/HIP route-disagreement review', () => {
  it('disposes every queue row, and nothing else', () => {
    expect(review.map((r) => r.key).sort()).toEqual([...queueKeys].sort());
    expect(queueKeys).toHaveLength(21);
  });

  it('uses closed verdicts, and notes every identity event', () => {
    for (const r of review) {
      expect(IDENTITY_VERDICTS.has(r.verdict), `verdict "${r.verdict}"`).toBe(true);
      if (r.verdict !== 'no-identity-event') expect(r.note).not.toBeNull();
    }
  });
});

// The three inputs below ride LFS, so the bare CI `test` job sees pointer
// stubs and these suites self-skip there. They run smudged in the
// sid-ledger-guard job, which names this file, and locally.
const ledgerReadable = lfsContentReadable(LEDGER_PATH);
const bsc5Readable = lfsContentReadable(BSC5_PATH);
const spineReadable = lfsContentReadable(SPINE_PATH);

describe.skipIf(!ledgerReadable)('label delta vs the SID ledger', () => {
  // A spine designation the merge moves off its record stops feeding that
  // record's same-as class. Where it is also a ledger canonical key, the row
  // resolves only through a sameas-overrides bridge — the Gliese renumberings
  // are the shipped shape (docs/catalog-driver.md § 4).
  it('bridges every canonical key the merge removes from its record', () => {
    const canonical = new Set(
      parseLedgerTsv(readFileSync(LEDGER_PATH, 'utf-8')).map((r) => r.canonicalKey),
    );
    const bridgeEndpoints = new Set(
      parseSameasTsv(readFileSync(OVERRIDES_PATH, 'utf-8'), 'sameas-overrides.tsv')
        .flatMap((e) => [e.a, e.b]),
    );
    const flips = parseLabelFlipsTsv(
      readFileSync(resolve(REPO_ROOT, LABEL_FLIPS_FILE), 'utf-8'),
    );
    const removedCanonical = spineDesignationsRemovedBy(flips)
      .filter((d) => canonical.has(d));

    expect(removedCanonical.filter((d) => !bridgeEndpoints.has(d))).toEqual([]);
    expect(removedCanonical.sort()).toEqual([
      'gl:Gl_157.1',
      'gl:Gl_181.1',
      'gl:Gl_223.2',
      'gl:Gl_226.1',
      'gl:Gl_231.3',
    ]);
  });
});

describe.skipIf(!bsc5Readable)('V/50 HD-less entries', () => {
  it('pins the out-of-scope set', () => {
    const hdless = parseBsc5Tsv(readFileSync(BSC5_PATH, 'utf-8'))
      .filter((r) => r.hd === null)
      .map((r) => r.hr);
    expect(hdless).toEqual(HD_LESS_HR);
  });
});

describe.skipIf(!spineReadable)('the dispositions, against the spine', () => {
  // Streamed in beforeAll, not in the describe body: a skipped suite still
  // runs its body to collect tests, and the spine is 42 MB.
  let pairHolders: Map<string, number>;
  let hrHolders: string[];

  beforeAll(() => {
    const noIdentityEvent = review.filter((r) => r.verdict === 'no-identity-event');
    pairHolders = new Map(noIdentityEvent.map((r) => [r.key, 0]));
    const outOfScope = new Set(HD_LESS_HR.map(String));
    hrHolders = [];
    for (const row of iterSpineTsv(readFileSync(SPINE_PATH, 'utf-8'))) {
      const pair = `${row.hd}\t${row.hip}`;
      const held = pairHolders.get(pair);
      if (held !== undefined) pairHolders.set(pair, held + 1);
      if (outOfScope.has(row.hr)) hrHolders.push(row.hr);
    }
  });

  it('backs no-identity-event: one record holds both of a disagreement\'s designations', () => {
    expect([...pairHolders].filter(([, holders]) => holders !== 1)).toEqual([]);
    expect(pairHolders.size).toBe(21);
  });

  it('backs out-of-scope: no record carries an HD-less V/50 HR number', () => {
    expect(hrHolders).toEqual([]);
  });
});
