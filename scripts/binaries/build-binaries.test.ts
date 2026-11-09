import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { GAIA_HIP_XMATCH } from '../catalog/parse/gaia-hip-xmatch-source';
import { GAIA_TYC_XMATCH } from '../catalog/parse/gaia-tyc-xmatch-source';
import { GAIA_NSS } from '../catalog/sources/gaia-nss-source';
import { HIP2 } from '../catalog/sources/hip2-source';
import { HIP_CCDM } from '../catalog/multiplicity/hip-ccdm-source';
import { ATHYG_CLASSIC_IDS } from '../catalog/spine/athyg-classic-ids-source';
import { SIMBAD_WDS_XIDS } from '../catalog/membership/binding/simbad-wds-xids-source';
import { DATA_FILES } from '../../src/catalog-format/pipeline-outputs/data-files';
import { serialiseSourceIdRequest } from '../catalog/astrometry-request/export-astrometry-request-pure';
import { flattenStages } from '../util/counts/count-stages-pure';
import { isReadable } from '../util/sources/source';
import { componentKey } from './component-tokens-pure';
import { BINARIES_ASTROMETRY } from './load/binaries-astrometry-source';
import { ASTROMETRY_EXCLUSIONS, COMPONENT_SPTYPE_OVERRIDES, ORB6_COMPONENT_OVERRIDES } from './load/curated-source';
import { mscPairKey } from './load/msc-pure';
import { MSC_COMPONENTS, MSC_ORBITS, MSC_SYSTEMS } from './load/msc-source';
import { runStages } from './build-binaries';
import { stage1Counts, type ReferenceCatalogs } from './load/reference-catalogs';
import { astrometryRequestIds, stage2Counts, type Stage2Result } from './resolve/resolve-pairs';
import { spotCheckProblems, strongestComponents } from './resolve/spot-check-pure';
import { SPOT_CHECK_GROUND_TRUTH } from './resolve/spot-check-source';
import { SIMBAD_WDS_SPTYPE } from './load/simbad-wds-sptype-source';
import { ORB6, WDS_SUMM } from '../wds/wds-source';

const INPUTS = [
  WDS_SUMM, ORB6, ORB6_COMPONENT_OVERRIDES, COMPONENT_SPTYPE_OVERRIDES, ASTROMETRY_EXCLUSIONS,
  MSC_SYSTEMS, MSC_ORBITS, MSC_COMPONENTS, BINARIES_ASTROMETRY, SIMBAD_WDS_SPTYPE, SIMBAD_WDS_XIDS,
  ATHYG_CLASSIC_IDS, HIP_CCDM, HIP2, GAIA_HIP_XMATCH, GAIA_TYC_XMATCH, GAIA_NSS,
];

const REQUEST = { file: DATA_FILES.binariesAstrometryRequest, hint: 'Re-run `pnpm run build:binaries`.' };
const readRepoFile = (file: string): string => readFileSync(resolve(__dirname, '../..', file), 'utf8');

const committed = flattenStages(
  JSON.parse(readFileSync(resolve(__dirname, 'build-binaries-expected.json'), 'utf8')),
) as Record<string, number>;

describe.skipIf(![...INPUTS, REQUEST, SPOT_CHECK_GROUND_TRUTH].every(isReadable))('Stages 1..2 through the shell, over the committed inputs', () => {
  let c: ReferenceCatalogs;
  let r: Stage2Result;
  const log: string[] = [];
  beforeAll(async () => {
    ({ reference: c, resolved: r } = await runStages((line) => log.push(line)));
  }, 120_000);

  it('logs Stage 1 with no input-drift warning', () => {
    expect(log.length).toBeGreaterThan(0);
    expect(log.filter((line) => line.startsWith('WARNING'))).toEqual([]);
  });

  it('passes every row-band check', () => {
    expect(c.checks.filter((check) => check.kind === 'fail')).toEqual([]);
  });

  it('counts what the committed count snapshot pins for its keys', () => {
    for (const [key, value] of Object.entries(stage1Counts(c))) expect([key, value]).toEqual([key, committed[key]]);
  });

  it('hands Stage 2 the snapshot\'s pair total less the NSS inner pairs Stage 3 adds', () => {
    expect(c.pairs.length).toBe(committed.wds_pairs_total - committed.synthesized_nss_inner_pairs);
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

  it('counts what the committed count snapshot pins for Stage 2\'s keys', () => {
    for (const [key, value] of Object.entries(stage2Counts(r))) expect([key, value]).toEqual([key, committed[key]]);
  });

  it('decomposes the snapshot\'s pairs and components less the NSS inner pairs Stage 3 adds', () => {
    expect(r.pairs.length).toBe(committed.decomposing_pairs - committed.synthesized_nss_inner_pairs);
    expect(r.pairs.length * 2).toBe(committed.components_total - 2 * committed.synthesized_nss_inner_pairs);
  });

  it('requests exactly the committed Gaia astrometry request', () => {
    expect(serialiseSourceIdRequest(astrometryRequestIds(r, c.indices)) === readRepoFile(REQUEST.file)).toBe(true);
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
});
