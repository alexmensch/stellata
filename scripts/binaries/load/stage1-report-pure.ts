// Stage 1's build-log lines, read off the ReferenceCatalogs it returned.

import { GAIA_BINDING_G_MINUS_V_REJECT_MAG } from '../../catalog/membership/binding/binding-gate-pure';
import { fold } from '../../util/counts/tally-pure';
import { count, countsListed } from '../build-log-pure';
import { BLANK_RESCUE_OUTCOMES } from './blank-rescue-pure';
import type { ReferenceCatalogs } from './reference-catalogs';
import { ASTROMETRY_EXCLUSION_OUTCOMES } from './gaia-pure';
import { MSC_SYNTHESIS_OUTCOMES, ORB6_OVERRIDE_OUTCOMES } from './subdivide-pure';
import { ORB6_GRADE_OUTCOMES, WDS_DEDUP_OUTCOMES } from '../../wds/wds-pure';

/** AT-HYG documents ~98% Gaia coverage; outside this band its input drifted. */
export const ATHYG_GAIA_COVERAGE_BAND = { min: 0.90, max: 1.00 } as const;

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

export function stage1Report(c: ReferenceCatalogs): string[] {
  const { indices } = c;
  const wdsRows = c.pairs.length - c.synthesizedOrb6Pairs.length - c.synthesizedMscPairs.length;
  const athygGaia = c.athyg.filter((r) => r.gaia !== null).length + indices.athygGaiaMagRejected.length;
  const coverage = c.athyg.length > 0 ? athygGaia / c.athyg.length : 0;
  const dedup = fold(WDS_DEDUP_OUTCOMES, c.wdsDedup, (o) => o);
  const grades = fold(ORB6_GRADE_OUTCOMES, c.orb6Grades, (o) => o);
  const overrides = fold(ORB6_OVERRIDE_OUTCOMES, c.orb6Overrides, (o) => o);
  const exclusion = fold(ASTROMETRY_EXCLUSION_OUTCOMES, c.astrometryExclusion, (o) => o);
  const rescue = fold(BLANK_RESCUE_OUTCOMES, c.blankRescue, (o) => o);
  const { synthesized, ...mscSkips } = fold(MSC_SYNTHESIS_OUTCOMES, c.mscSynthesis, (o) => o);
  const lines = [
    `loaded ${count(wdsRows)} WDS pair rows (dropped ${count(dedup.dropped)} duplicates, kept most-observed)`,
    `loaded ${count(c.orb6.length)} ORB6 orbit rows; ${count(overrides.applied)} curated component overrides applied`
      + (grades.fallback > 0 ? `; ${count(grades.fallback)} non-numeric grades read as 5` : ''),
    `synthesized ${count(c.synthesizedOrb6Pairs.length)} sub-pairs for ORB6 orbits with no WDS pair row`,
    `${count(athygGaia)} / ${count(c.athyg.length)} AT-HYG rows carry gaia (${pct(coverage)})`,
    `dropped ${count(exclusion.excluded)} curated-excluded source_ids from the astrometry map`,
    `rejected magnitude-inconsistent Gaia bindings (G - V > ${GAIA_BINDING_G_MINUS_V_REJECT_MAG}): `
      + `${count(indices.xwalkMagRejected.length)} HIP-xwalk, ${count(indices.athygGaiaMagRejected.length)} AT-HYG gaia cells`,
    `indices: hip -> gaia ${count(indices.hipToGaia.size)}, tyc -> gaia ${count(indices.tycToGaia.size)}, `
      + `gaia -> nss ${count(indices.srcToNss.size)}, gaia -> astrometry ${count(indices.srcToAstrometry.size)}, `
      + `hip -> hip2 ${count(indices.hipToHip2.size)}, ccdm systems ${count(indices.ccdmToHips.size)}`,
    `MSC: ${count(indices.msc.orbitsByPair.size)} WDS-mapped orbit pairs (${count(indices.msc.nOrbitsUnmapped)} unmappable)`,
    `rescued ${count(rescue.rescued)} blank-components WDS pairs as implied A,B; ${count(rescue.deferred)} deferred`,
    `synthesized ${count(synthesized)} MSC inner pairs (skipped: ${countsListed(mscSkips)})`,
  ];
  if (coverage < ATHYG_GAIA_COVERAGE_BAND.min || coverage > ATHYG_GAIA_COVERAGE_BAND.max) {
    lines.push(`WARNING: AT-HYG gaia coverage ${pct(coverage)} outside [${pct(ATHYG_GAIA_COVERAGE_BAND.min)}, `
      + `${pct(ATHYG_GAIA_COVERAGE_BAND.max)}] — input drift suspected`);
  }
  return lines;
}
