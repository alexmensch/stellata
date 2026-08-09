// The swap parity ledger's committed gates: the route-disagreement review
// join, the canonical-key audit over the label delta, and the V/50 HD-less
// out-of-scope pin. See ../spine/README.md § The swap parity ledger.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { dataRows, nonEmpty } from '../parse/corpus-tsv';
import { REPO_ROOT, isLfsPointerFile } from '../../util/paths';
import { LEDGER_PATH, OVERRIDES_PATH } from '../../sid/registry-io';
import { parseLedgerTsv, parseSameasTsv } from '../../sid/sid-pure';
import { parseBsc5Tsv } from './classic-ids-parse';
import {
  LABEL_FLIPS_FILE,
  designationFor,
  parseLabelFlipsTsv,
} from './label-merge-pure';

const QUEUE_PATH = resolve(REPO_ROOT, 'data/classic-ids/hd_hip_route_disagreements.tsv');
const REVIEW_PATH = resolve(REPO_ROOT, 'data/classic-ids/hd_hip_route_disagreements_review.tsv');
const BSC5_PATH = resolve(REPO_ROOT, 'data/classic-ids/bsc5.tsv');

const REVIEW_HINT = 'Dispose the row in hd_hip_route_disagreements_review.tsv.';
const IDENTITY_VERDICTS = new Set(['no-identity-event', 'merge', 'split']);

describe('HD/HIP route-disagreement review', () => {
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

  it('disposes every queue row, and nothing else', () => {
    expect(review.map((r) => r.key).sort()).toEqual([...queueKeys].sort());
    expect(queueKeys).toHaveLength(21);
  });

  it('uses closed verdicts, with identity events carrying a ledger action', () => {
    for (const r of review) {
      expect(IDENTITY_VERDICTS.has(r.verdict), `verdict "${r.verdict}"`).toBe(true);
      if (r.verdict !== 'no-identity-event') expect(r.note).not.toBeNull();
    }
  });
});

const ledgerReadable = existsSync(LEDGER_PATH) && !isLfsPointerFile(LEDGER_PATH);

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
    const removedCanonical = flips
      .filter((f) =>
        (f.disposition === 'added'
          || f.disposition === 'overlay-wins'
          || f.disposition === 'override-value')
        && f.spine !== '')
      .map((f) => designationFor(f.field, f.spine))
      .filter((d): d is string => d !== null && canonical.has(d));

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

const bsc5Readable = existsSync(BSC5_PATH) && !isLfsPointerFile(BSC5_PATH);

describe.skipIf(!bsc5Readable)('V/50 HD-less entries', () => {
  // Not stars: novae/supernovae, four clusters (47 Tuc, NGC 2281, M 67,
  // NGC 2808) and M 31. Out of scope by class, never catalogue records.
  it('pins the out-of-scope set', () => {
    const hdless = parseBsc5Tsv(readFileSync(BSC5_PATH, 'utf-8'))
      .filter((r) => r.hd === null)
      .map((r) => r.hr);
    expect(hdless).toEqual([
      92, 95, 182, 1057, 1841, 2472, 2496, 3515, 3671, 6309, 6515, 7189, 7539, 8296,
    ]);
  });
});
