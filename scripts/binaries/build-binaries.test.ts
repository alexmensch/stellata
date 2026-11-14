import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { GAIA_HIP_XMATCH } from '../catalog/parse/gaia-hip-xmatch-source';
import { GAIA_TYC_XMATCH } from '../catalog/parse/gaia-tyc-xmatch-source';
import { GAIA_NSS } from '../catalog/sources/gaia-nss-source';
import { HIP2 } from '../catalog/sources/hip2-source';
import { HIP_CCDM } from '../catalog/multiplicity/hip-ccdm-source';
import { ATHYG_CLASSIC_IDS } from '../catalog/spine/athyg-classic-ids-source';
import { SIMBAD_WDS_XIDS } from '../catalog/membership/binding/simbad-wds-xids-source';
import { isReadable } from '../util/sources/source';
import { columnTable } from '../util/tsv/table-pure';
import { componentKey } from './component-tokens-pure';
import { GAIA_ASTROMETRY } from '../catalog/sources/gaia-astrometry-source';
import { ASTROMETRY_REQUEST } from '../refresh/gaia-request/astrometry-request-source';
import { ASTROMETRY_EXCLUSIONS, COMPONENT_SPTYPE_OVERRIDES, ORB6_COMPONENT_OVERRIDES } from './load/curated-source';
import { mscPairKey } from './load/msc-pure';
import { MSC_COMPONENTS, MSC_ORBITS, MSC_SYSTEMS } from './load/msc-source';
import { runStages, type StageResults } from './build-binaries';
import type { Stage3Result } from './astrometry/attach-astrometry';
import { binariesCounts } from './counts/binaries-counts';
import type { ReferenceCatalogs } from './load/reference-catalogs';
import type { Stage4Result } from './orbits/attach-orbits';
import type { Stage5Result } from './optical/attach-optical';
import type { Stage6Result } from './multiples/attach-multiples';
import { MULTIPLES_TSV, MULTIPLES_TSV_PATH } from './multiples-tsv';
import { astrometryRequestIds, type Stage2Result } from './resolve/resolve-pairs';
import { spotCheckProblems, strongestComponents } from './resolve/spot-check-pure';
import { SPOT_CHECK_GROUND_TRUTH } from './resolve/spot-check-source';
import { SIMBAD_WDS_SPTYPE } from './load/simbad-wds-sptype-source';
import { ORB6, WDS_SUMM } from '../wds/wds-source';

const INPUTS = [
  WDS_SUMM, ORB6, ORB6_COMPONENT_OVERRIDES, COMPONENT_SPTYPE_OVERRIDES, ASTROMETRY_EXCLUSIONS,
  MSC_SYSTEMS, MSC_ORBITS, MSC_COMPONENTS, GAIA_ASTROMETRY, SIMBAD_WDS_SPTYPE, SIMBAD_WDS_XIDS,
  ATHYG_CLASSIC_IDS, HIP_CCDM, HIP2, GAIA_HIP_XMATCH, GAIA_TYC_XMATCH, GAIA_NSS,
];

const readRepoFile = (file: string): string => readFileSync(resolve(__dirname, '../..', file), 'utf8');

const snapshotText = (file: string): string => readFileSync(resolve(__dirname, file), 'utf8');
const asWritten = (snapshot: unknown): string => `${JSON.stringify(snapshot, null, 2)}\n`;

describe.skipIf(![...INPUTS, ASTROMETRY_REQUEST, SPOT_CHECK_GROUND_TRUTH].every(isReadable))('Stages 1..6 through the shell, over the committed inputs', () => {
  let c: ReferenceCatalogs;
  let r: Stage2Result;
  let s3: Stage3Result;
  let s4: Stage4Result;
  let s5: Stage5Result;
  let s6: Stage6Result;
  let results: StageResults;
  const log: string[] = [];
  beforeAll(async () => {
    results = await runStages((line) => log.push(line));
    ({ reference: c, resolved: r, astrometry: s3, orbits: s4, optical: s5, multiples: s6 } = results);
  }, 120_000);

  it('logs Stage 1 with no input-drift warning', () => {
    expect(log.length).toBeGreaterThan(0);
    expect(log.filter((line) => line.startsWith('WARNING'))).toEqual([]);
  });

  it('passes every row-band check', () => {
    expect(c.checks.filter((check) => check.kind === 'fail')).toEqual([]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.pairs)).toBe(true);
    expect(Object.isFrozen(c.pairs[0])).toBe(true);
    expect(Object.isFrozen(c.athyg)).toBe(true);
    expect(Object.isFrozen(c.indices)).toBe(true);
  });

  it('carries the curated showcases: Algol Aa2\'s type, Sirius B\'s exclusion, AR Cas\'s MSC orbit', () => {
    expect(c.indices.componentSptypeOverrides.get(componentKey('03082+4057', '2'))).toBe('K0IV');
    expect(c.astrometryExclusion.filter((o) => o === 'excluded')).toHaveLength(1);
    expect(c.indices.srcToAstrometry.has('2947050466531873024')).toBe(false);
    expect(c.indices.msc.orbitsByPair.get(mscPairKey('23300+5833', 'Aa', 'Ab'))?.rows.map((r) => r.per)).toEqual([6.0663]);
  });

  it('finds every id it would weigh in the committed astrometry request', () => {
    const requested = new Set(ASTROMETRY_REQUEST.read().map(String));
    expect([...astrometryRequestIds(r, c.indices)].filter((id) => !requested.has(id))).toEqual([]);
  });

  it('meets every row of the spot-check ground truth', () => {
    const truth = SPOT_CHECK_GROUND_TRUTH.read();
    const best = strongestComponents(r.pairs);
    const misses = truth.flatMap((row) => spotCheckProblems(row, best).map((p) => `[${row.category}] ${row.name}: ${p} ${row.note}`));
    expect(truth.length).toBeGreaterThan(0);
    expect(misses).toEqual([]);
  });

  it('hands Stage 3 frozen decomposed pairs', () => {
    expect(Object.isFrozen(r.pairs)).toBe(true);
    expect(Object.isFrozen(r.pairs[0])).toBe(true);
    expect(Object.isFrozen(r.pairs[0].primary)).toBe(true);
  });

  it('routes every side of every pair, and hands Stage 4 frozen pairs', () => {
    expect(s3.pairs.every((p) => s3.astrometry.has(p))).toBe(true);
    expect(s3.astrometry.size).toBe(s3.pairs.length);
    expect(Object.isFrozen(s3.pairs)).toBe(true);
    expect(Object.isFrozen(s3.pairs.at(-1)!.secondary)).toBe(true);
    const inner = s3.astrometry.get(s3.pairs.at(-1)!)!;
    expect(Object.isFrozen(inner)).toBe(true);
    expect([inner.primary.astrometryVia, Object.isFrozen(inner.primary)]).toEqual([expect.not.stringMatching(/^unresolved$/), true]);
  });

  it('selects one frozen orbit for every Stage 3 pair', () => {
    expect([...s4.orbits.keys()]).toEqual(s3.pairs);
    const withElements = [...s4.orbits.values()].flatMap((o) => (o.orbitVia === 'none' ? [] : [o]))[0];
    expect([Object.isFrozen(withElements), Object.isFrozen(withElements.elements)]).toEqual([true, true]);
  });

  it('classifies every Stage 3 pair, and logs the Stage 5 lines', () => {
    expect([...s5.optical.keys()]).toEqual(s3.pairs);
    expect(Object.isFrozen(s5)).toBe(true);
    expect(log.filter((line) => line.startsWith('optical-pair cascade: ') || line.startsWith('separation-limit rejections: '))).toHaveLength(2);
  });

  it('encodes Stage 6\'s records to the committed multiples.tsv, byte for byte', () => {
    expect(MULTIPLES_TSV.serialize(s6.rows) === readFileSync(MULTIPLES_TSV_PATH, 'utf8')).toBe(true);
  });

  it('hands main frozen rows, and logs the Stage 6 lines', () => {
    expect([Object.isFrozen(s6), Object.isFrozen(s6.rows), Object.isFrozen(s6.rows[0])]).toEqual([true, true, true]);
    expect(log.filter((line) => line.startsWith('multiples.tsv: ') || line.startsWith('spect provenance: '))).toHaveLength(2);
  });

  it('counts the committed count snapshot, byte for byte as a refresh writes it', () => {
    expect(asWritten(binariesCounts(results)) === snapshotText('build-binaries-expected.json')).toBe(true);
  });
});

/** The NSS file with each source's rows reversed in the slots they hold. */
function reverseNssTieOrder(text: string): { text: string; reordered: number } {
  const [header, ...rows] = text.split('\n');
  const sourceIdColumn = header.split('\t').indexOf('source_id');
  if (sourceIdColumn < 0) throw new Error('NSS header has no source_id column');
  const slots = new Map<string, number[]>();
  rows.forEach((row, i) => {
    if (row === '') return;
    const sourceId = row.split('\t')[sourceIdColumn];
    slots.set(sourceId, [...(slots.get(sourceId) ?? []), i]);
  });
  const out = [...rows];
  let reordered = 0;
  for (const at of slots.values()) {
    if (at.length < 2) continue;
    reordered++;
    at.forEach((slot, k) => { out[slot] = rows[at[at.length - 1 - k]]; });
  }
  return { text: [header, ...out].join('\n'), reordered };
}

describe.skipIf(![...INPUTS, SPOT_CHECK_GROUND_TRUTH].every(isReadable))('the NSS file\'s tie order', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('leaves multiples.tsv byte for byte when each source\'s solutions are reversed', async () => {
    const shuffled = reverseNssTieOrder(readRepoFile(GAIA_NSS.file));
    expect(shuffled.reordered).toBeGreaterThan(0);
    vi.spyOn(GAIA_NSS, 'read').mockReturnValue(columnTable(GAIA_NSS, shuffled.text));
    const { multiples } = await runStages(() => {});
    expect(MULTIPLES_TSV.serialize(multiples.rows) === readFileSync(MULTIPLES_TSV_PATH, 'utf8')).toBe(true);
  }, 120_000);
});
