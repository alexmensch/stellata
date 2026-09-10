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
} from './label-merge/label-merge-pure';

const ADDITIONS_PATH = resolve(REPO_ROOT, 'data/membership/additions-ledger.tsv');
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

    // A removed key the primaries then ADMIT is not an orphan needing a
    // bridge — it is the merge handing a mis-attributed designation back to
    // the star that owns it, which the manifest admits as its own record.
    // Bridging one would declare two distinct stars the same object. HD 164668
    // is the shape: the spine printed it on HIP 88267 (Bodu), the overlay
    // flipped that record to 164669, and the primaries admit 164668 itself.
    const admittedHd = new Set(
      [...dataRows(
        readFileSync(ADDITIONS_PATH, 'utf-8'),
        ['hd', 'reason'],
        'additions-ledger.tsv',
        'Re-run `pnpm run build:membership`.',
      )]
        .filter(({ cells, idx }) => cells[idx.reason].startsWith('admitted:'))
        .map(({ cells, idx }) => nonEmpty(cells[idx.hd]))
        .filter((hd): hd is string => hd !== null)
        .map((hd) => `hd:${hd}`),
    );
    const reOwned = removedCanonical.filter((d) => admittedHd.has(d));
    const orphaned = removedCanonical.filter((d) => !admittedHd.has(d));

    expect(orphaned.filter((d) => !bridgeEndpoints.has(d))).toEqual([]);
    expect(orphaned.sort()).toEqual([
      'gl:GJ_3196A',
      'gl:GJ_4378A',
      'gl:Gl_157.1',
      'gl:Gl_181.1',
      'gl:Gl_223.2',
      'gl:Gl_226.1',
      'gl:Gl_231.3',
    ]);
    // Pinned, not merely allowed: every one of these is a designation two
    // records could answer to, so the set growing is a collision-guard
    // question, not routine drift.
    //
    // 21 → 25 with the manifest-scoped SIMBAD value cohort: hd:42126,
    // hd:99103, hd:126128 and hd:155885 are `admitted:` additions that used
    // to park for want of a parallax, so no ledger row carried their key and
    // `canonical.has` filtered them out. They reach one now and mint. The
    // collision-guard half is the assertion below and the `orphaned` set
    // above, and neither moves.
    //
    // 25 → 26 with the curated HD corrections: hd:138917 leaves δ Ser A's
    // record — its own Gaia source is SIMBAD's δ Ser A, which is HD 138918 —
    // and the primaries admit 138917 as δ Ser B's own row on its own source.
    // That is the paragraph above happening again, deliberately.
    expect(reOwned.length).toBe(26);
    expect(reOwned.filter((d) => bridgeEndpoints.has(d))).toEqual([]);
  });
});

const MANIFEST_PATH = resolve(REPO_ROOT, 'data/membership/membership-manifest.tsv');
const PARKED_PATH = resolve(REPO_ROOT, 'data/membership/parked-ledger.tsv');

describe.skipIf(!lfsContentReadable(MANIFEST_PATH))('withheld sibling HD numbers', () => {
  // label-merge/README.md § A withheld number attaches to no record. Six of
  // the withheld numbers are the display cell of an admitted manifest row of
  // their own, and every one of those rows parks — which is what says the
  // numbers are unreachable for want of a distance rather than a label rule.
  // One of them shipping is the signal to revisit that section, so it fails
  // here rather than ageing the prose.
  const WITHHELD_ON_THEIR_OWN_ROW = [25008, 33884, 124588, 136416, 186204, 198811];

  let withheld: Set<number>;
  let carriedBy: Map<number, string>;

  beforeAll(() => {
    withheld = new Set(
      parseLabelFlipsTsv(readFileSync(resolve(REPO_ROOT, LABEL_FLIPS_FILE), 'utf-8'))
        .filter((f) => f.disposition === 'extra-sibling-rendered' && f.field === 'hd')
        .map((f) => Number(f.applied)),
    );
    carriedBy = new Map();
    for (const { cells, idx } of dataRows(
      readFileSync(MANIFEST_PATH, 'utf-8'),
      ['tyc', 'hd'],
      'membership-manifest.tsv',
      'Re-run `pnpm run build:membership`.',
    )) {
      const hd = Number(cells[idx.hd]);
      if (withheld.has(hd)) carriedBy.set(hd, cells[idx.tyc]);
    }
  });

  it('withholds 34 HD numbers, six of which a manifest row of its own carries', () => {
    expect(withheld.size).toBe(34);
    expect([...carriedBy.keys()].sort((a, b) => a - b)).toEqual(WITHHELD_ON_THEIR_OWN_ROW);
  });

  it('parks every one of those six for want of a published parallax', () => {
    const parked = new Map(
      [...dataRows(
        readFileSync(PARKED_PATH, 'utf-8'),
        ['tyc', 'reason'],
        'parked-ledger.tsv',
        'Re-run `pnpm run build:catalog`.',
      )].map(({ cells, idx }) => [cells[idx.tyc], cells[idx.reason]]),
    );
    expect([...carriedBy.values()].map((tyc) => parked.get(tyc))).toEqual(
      WITHHELD_ON_THEIR_OWN_ROW.map(() => 'no_parallax_published'),
    );
  });
});

describe.skipIf(!lfsContentReadable(MANIFEST_PATH))('override-freed HD numbers', () => {
  // label-merge/README.md § What a freed number costs. A curated correction
  // hands the neighbour's number back, and where the row that takes it does
  // not build, the number resolves NOWHERE — worse reach than before the
  // correction, which is the price the section states. The suite above keys on
  // `extra-sibling-rendered` and so cannot see these; the two shapes end in
  // the same place and both are stellata-hooj.13.
  const FREED = ['24071', '68255', '138917', '200496', '213051', '330122'];
  const SHIPS: Record<string, string> = {
    '24071': '7570-1586-1',    // f Eri B, on its own source
    '138917': '933-1239-1',    // δ Ser B, on its own source
    '200496': '5204-1584-2',   // 12 Aqr B, on its own source
  };
  const PARKS: Record<string, string> = {
    '68255': '1381-1641-1',    // ζ¹ Cnc B, no bound source
    '213051': '5226-1605-2',   // ζ¹ Aqr, no bound source
  };
  // No second Tycho entry names it, so no primary admits it.
  const NO_ROW = ['330122'];

  let freed: string[];
  let rowsByHd: Map<string, { tyc: string; sourceId: string }>;
  let parkedReason: Map<string, string>;

  beforeAll(() => {
    const flips = parseLabelFlipsTsv(
      readFileSync(resolve(REPO_ROOT, LABEL_FLIPS_FILE), 'utf-8'),
    ).filter((f) => f.disposition === 'override-value' && f.field === 'hd');
    // A mutual swap frees nothing: the partner's override takes the value the
    // other vacates, so only a spine value no override applies is freed.
    const taken = new Set(flips.map((f) => f.applied));
    freed = flips
      .map((f) => f.spine)
      .filter((v): v is string => v !== null && v !== '' && !taken.has(v))
      .sort((a, b) => Number(a) - Number(b));

    rowsByHd = new Map();
    for (const { cells, idx } of dataRows(
      readFileSync(MANIFEST_PATH, 'utf-8'),
      ['tyc', 'hd', 'gaia_source_id'],
      'membership-manifest.tsv',
      'Re-run `pnpm run build:membership`.',
    )) {
      const hd = cells[idx.hd];
      if (freed.includes(hd)) {
        rowsByHd.set(hd, { tyc: cells[idx.tyc], sourceId: cells[idx.gaia_source_id] });
      }
    }

    parkedReason = new Map(
      [...dataRows(
        readFileSync(PARKED_PATH, 'utf-8'),
        ['tyc', 'reason'],
        'parked-ledger.tsv',
        'Re-run `pnpm run build:catalog`.',
      )].map(({ cells, idx }) => [cells[idx.tyc], cells[idx.reason]]),
    );
  });

  it('frees six numbers, the four mutual-swap cells freeing none', () => {
    expect(freed).toEqual(FREED);
  });

  it('gives three of them a row that builds a record', () => {
    for (const [hd, tyc] of Object.entries(SHIPS)) {
      expect(rowsByHd.get(hd)?.tyc, `HD ${hd}`).toBe(tyc);
      expect(rowsByHd.get(hd)?.sourceId, `HD ${hd} binds a source`).not.toBe('');
      expect(parkedReason.get(tyc), `HD ${hd} ships`).toBeUndefined();
    }
  });

  // The ratchet: each of these is a designation that resolved before the
  // correction and resolves nowhere after it. One more is a finding, not
  // drift — say why here and move the number, or fix the distance
  // (stellata-hooj.13).
  it('leaves three resolving nowhere — two parked, one on no row at all', () => {
    for (const [hd, tyc] of Object.entries(PARKS)) {
      expect(rowsByHd.get(hd)?.tyc, `HD ${hd}`).toBe(tyc);
      expect(rowsByHd.get(hd)?.sourceId, `HD ${hd} binds no source`).toBe('');
      expect(parkedReason.get(tyc), `HD ${hd}`).toBe('no_parallax_published');
    }
    for (const hd of NO_ROW) expect(rowsByHd.has(hd), `HD ${hd}`).toBe(false);
    expect(Object.keys(SHIPS).length + Object.keys(PARKS).length + NO_ROW.length)
      .toBe(FREED.length);
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
