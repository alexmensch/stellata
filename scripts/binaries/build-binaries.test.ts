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
import { flattenStages } from '../util/counts/count-stages-pure';
import { isReadable } from '../util/sources/source';
import { componentKey } from './component-tokens-pure';
import { BINARIES_ASTROMETRY } from './load/binaries-astrometry-source';
import { ASTROMETRY_EXCLUSIONS, COMPONENT_SPTYPE_OVERRIDES, ORB6_COMPONENT_OVERRIDES } from './load/curated-source';
import { mscPairKey } from './load/msc-pure';
import { MSC_COMPONENTS, MSC_ORBITS, MSC_SYSTEMS } from './load/msc-source';
import { runStages } from './build-binaries';
import { stage1Counts, type ReferenceCatalogs } from './load/reference-catalogs';
import { SIMBAD_WDS_SPTYPE } from './load/simbad-wds-sptype-source';
import { ORB6, WDS_SUMM } from './load/wds-source';

const INPUTS = [
  WDS_SUMM, ORB6, ORB6_COMPONENT_OVERRIDES, COMPONENT_SPTYPE_OVERRIDES, ASTROMETRY_EXCLUSIONS,
  MSC_SYSTEMS, MSC_ORBITS, MSC_COMPONENTS, BINARIES_ASTROMETRY, SIMBAD_WDS_SPTYPE, SIMBAD_WDS_XIDS,
  ATHYG_CLASSIC_IDS, HIP_CCDM, HIP2, GAIA_HIP_XMATCH, GAIA_TYC_XMATCH, GAIA_NSS,
];

const committed = flattenStages(
  JSON.parse(readFileSync(resolve(__dirname, 'build-binaries-expected.json'), 'utf8')),
) as Record<string, number>;

describe.skipIf(!INPUTS.every(isReadable))('Stages 1..1 through the shell, over the committed inputs', () => {
  let c: ReferenceCatalogs;
  const log: string[] = [];
  beforeAll(async () => {
    c = (await runStages((line) => log.push(line))).reference;
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
});
