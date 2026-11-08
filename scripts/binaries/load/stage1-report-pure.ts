// Stage 1's build-log lines, read off the ReferenceCatalogs it returned.

import { GAIA_BINDING_G_MINUS_V_REJECT_MAG } from '../../catalog/membership/binding/binding-gate-pure';
import { fold } from '../../util/counts/tally-pure';
import { BLANK_RESCUE_OUTCOMES } from './blank-rescue-pure';
import type { ReferenceCatalogs } from './reference-catalogs';
import { MSC_SYNTHESIS_OUTCOMES } from './subdivide-pure';

/** AT-HYG documents ~98% Gaia coverage; outside this band its input drifted. */
export const ATHYG_GAIA_COVERAGE_BAND = { min: 0.90, max: 1.00 } as const;

const n = (v: number): string => v.toLocaleString('en-US');
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

export function stage1Report(c: ReferenceCatalogs): string[] {
  const { indices } = c;
  const wdsRows = c.pairs.length - c.synthesizedOrb6Pairs.length - c.synthesizedMscPairs.length;
  const athygGaia = c.athyg.filter((r) => r.gaia !== null).length + indices.athygGaiaMagRejected.length;
  const coverage = c.athyg.length > 0 ? athygGaia / c.athyg.length : 0;
  const rescue = fold(BLANK_RESCUE_OUTCOMES, c.blankRescue, (o) => o);
  const { synthesized, ...mscSkips } = fold(MSC_SYNTHESIS_OUTCOMES, c.mscSynthesis, (o) => o);
  const lines = [
    `loaded ${n(wdsRows)} WDS pair rows (dropped ${n(c.wdsDuplicatePairRowsDropped)} duplicates, kept most-observed)`,
    `loaded ${n(c.orb6.length)} ORB6 orbit rows; ${n(c.orb6OverridesApplied)} curated component overrides applied`
      + (c.orb6GradeFallbacks > 0 ? `; ${n(c.orb6GradeFallbacks)} non-numeric grades read as 5` : ''),
    `synthesized ${n(c.synthesizedOrb6Pairs.length)} sub-pairs for ORB6 orbits with no WDS pair row`,
    `${n(athygGaia)} / ${n(c.athyg.length)} AT-HYG rows carry gaia (${pct(coverage)})`,
    `dropped ${n(c.astrometryExcluded)} curated-excluded source_ids from the astrometry map`,
    `rejected magnitude-inconsistent Gaia bindings (G - V > ${GAIA_BINDING_G_MINUS_V_REJECT_MAG}): `
      + `${n(indices.xwalkMagRejected.length)} HIP-xwalk, ${n(indices.athygGaiaMagRejected.length)} AT-HYG gaia cells`,
    `indices: hip -> gaia ${n(indices.hipToGaia.size)}, tyc -> gaia ${n(indices.tycToGaia.size)}, `
      + `gaia -> nss ${n(indices.srcToNss.size)}, gaia -> astrometry ${n(indices.srcToAstrometry.size)}, `
      + `hip -> hip2 ${n(indices.hipToHip2.size)}, ccdm systems ${n(indices.ccdmToHips.size)}`,
    `MSC: ${n(indices.msc.orbitsByPair.size)} WDS-mapped orbit pairs (${n(indices.msc.nOrbitsUnmapped)} unmappable)`,
    `rescued ${n(rescue.rescued)} blank-components WDS pairs as implied A,B; ${n(rescue.deferred)} deferred`,
    `synthesized ${n(synthesized)} MSC inner pairs (skipped: `
      + Object.entries(mscSkips).map(([k, v]) => `${k}=${n(v)}`).join(', ') + ')',
  ];
  if (coverage < ATHYG_GAIA_COVERAGE_BAND.min || coverage > ATHYG_GAIA_COVERAGE_BAND.max) {
    lines.push(`WARNING: AT-HYG gaia coverage ${pct(coverage)} outside [${pct(ATHYG_GAIA_COVERAGE_BAND.min)}, `
      + `${pct(ATHYG_GAIA_COVERAGE_BAND.max)}] — input drift suspected`);
  }
  return lines;
}
