// Loaders for every reference table readStars consumes. See README.md.

import type { BuildCounts } from '../build-counts';
import type { DirectionSources } from '../distance/direction-cascade';
import type { DustGrid } from '../distance/dust/dust-deextinction-pure';
import { DUST_GRID } from '../distance/dust/dust-grid-source';
import { BAILER_JONES } from '../distance/refinement/bailer-jones-source';
import { GAIA_ASTROMETRY } from '../distance/gaia-astrometry-source';
import { GAIA_NSS } from '../distance/gaia-nss-source';
import { HIP2 } from '../distance/hip2-source';
import { GAIA_APSIS } from '../record/gaia-apsis-source';
import { SIMBAD_SPTYPE } from '../spectral/simbad-sptype-source';
import { SIMBAD_VALUES } from '../simbad/simbad-values-source';
import { GAIA_GSPC } from '../photometry/gspc-source';
import { HIP_PHOTOMETRY } from '../photometry/hip-photometry-source';
import { TYCHO2 } from '../tycho2-source';
import { GLIESE } from '../gliese-source';
import { CNS5 } from '../classic-ids/cns5-source';
import { cns5AstrometryByGj } from '../classic-ids/classic-ids-parse';
import { createConstellationAssignment, iauEdgeRecords } from './constellations/constellations';
import { STELLARIUM } from './constellations/stellarium-source';
import { readMultiplesTsv } from '../companions/companion-promotion';
import { buildPairMemberParallaxIndex } from '../distance/parallax/pair-member-parallax';
import {
  readMagnitudeTermAstrometry,
  readMagnitudeTermSourceIds,
} from '../membership/magnitude-term/magnitude-term';
import { MAGNITUDE_FLOOR_V } from '../membership/magnitude-term/magnitude-term-pure';
import type { ReadStarsOptions } from './stars-parse';

/** Upstream table sizes — the `BuildCounts` fields this loader owns, so a
 *  consumer folds them in wholesale rather than field by field. */
export type ReadStarsInputSizes = Pick<
  BuildCounts,
  | 'bjEntries'
  | 'apsisEntries'
  | 'gspcEntries'
  | 'simbadSptypeEntries'
  | 'simbadValuesEntries'
  | 'gaiaAstrometryEntries'
  | 'hip2Entries'
  | 'hipVMagEntries'
  | 'hipBvEntries'
  | 'nssSourceIdEntries'
  | 'tycho2Entries'
  | 'cns5AstrometryEntries'
  | 'glieseEntries'
  | 'pairMemberParallaxEntries'
  | 'pairMemberSiblingNoAstrometryRow'
  | 'pairMemberSiblingNoParallax'
  | 'pairMemberSiblingNotAnchorGrade'
  | 'pairMemberSiblingBelowSnFloor'
>;

/** The loaded form of `ReadStarsOptions`: every table present, none optional,
 *  so passing this bundle to `readStars` cannot omit one. Extends the walk's
 *  own option shape rather than restating it — a new table added there is a
 *  compile error here until this loader supplies it. */
export interface ReadStarsInputs extends Required<ReadStarsOptions> {
  dustGrid: DustGrid;
  sizes: ReadStarsInputSizes;
}

function timer(label: string): (summary: string) => void {
  console.log(`${label}...`);
  const t = Date.now();
  return (summary) => console.log(`  ${summary} in ${Date.now() - t}ms`);
}

function timed<T>(label: string, read: () => T, size: (value: T) => string): T {
  const done = timer(label);
  const value = read();
  done(size(value));
  return value;
}

export async function loadReadStarsInputs(): Promise<ReadStarsInputs> {
  const entries = (m: { size: number }) => `${m.size} entries`;

  const bjMap = timed('Parsing Bailer-Jones DR3 distance posteriors', () => BAILER_JONES.read(), entries);
  const apsisMap = timed('Parsing Gaia DR3 Apsis astrophysical parameters', () => GAIA_APSIS.read(), entries);
  const gspcMap = timed('Parsing Gaia DR3 synthetic photometry', () => GAIA_GSPC.read(), entries);
  const simbadSpectral = timed(
    'Parsing SIMBAD sp_type catalogue', () => SIMBAD_SPTYPE.read().spectral, (i) => entries(i.bySourceId),
  );
  const simbadValues = timed(
    'Parsing SIMBAD bibcoded values', () => SIMBAD_VALUES.read(), (i) => `${i.rowCount} rows`,
  );

  const directions: DirectionSources = {
    gaiaAstrometry: timed(
      'Parsing Gaia DR3 5p astrometry (full catalog)', () => GAIA_ASTROMETRY.read(), entries,
    ),
    hip2: timed('Parsing HIP2 van Leeuwen astrometry', () => HIP2.read().astrometry, entries),
    nss: timed(
      'Parsing Gaia DR3 NSS two-body source_ids', () => GAIA_NSS.read(), (s) => `${s.size} source_ids`,
    ),
    tycho2: timed('Parsing Tycho-2 astrometry and BT/VT photometry', () => TYCHO2.read(), entries),
    cns5: timed('Parsing CNS5 astrometry', () => cns5AstrometryByGj(CNS5.read()), entries),
  };
  if (MAGNITUDE_FLOOR_V !== null) {
    const done = timer('Parsing Gaia DR3 5p astrometry (magnitude term)');
    const keep = await readMagnitudeTermSourceIds();
    let added = 0;
    for (const [sourceId, row] of await readMagnitudeTermAstrometry(keep)) {
      if (directions.gaiaAstrometry.has(sourceId)) continue;
      directions.gaiaAstrometry.set(sourceId, row);
      added++;
    }
    done(`${added} of ${keep.size} sources`);
  }

  const { vmag: hipVMag, bv: hipBv } = timed(
    'Parsing printed Hipparcos V magnitudes and colours',
    () => HIP_PHOTOMETRY.read(),
    (p) => `${p.vmag.size} V / ${p.bv.size} B−V entries`,
  );
  const gliese = timed('Parsing printed Gliese V/70A values', () => GLIESE.read(), (g) => `${g.rowCount} rows`);

  const pairMemberParallax = timed(
    'Indexing bound-pair sibling parallaxes',
    () => buildPairMemberParallaxIndex(readMultiplesTsv(), directions.gaiaAstrometry),
    ({ entryCount, refused }) => `${entryCount} anchor-grade siblings; refused `
      + `no-astrometry-row ${refused.noAstrometryRow}, `
      + `no-parallax ${refused.noParallax}, `
      + `not-anchor-grade ${refused.notAnchorGrade}, `
      + `below-sn-floor ${refused.belowSnFloor}`,
  );

  const dustGrid = timed(
    'Loading dust grid for build-time de-extinction',
    () => DUST_GRID.read(),
    (g) => `loaded ${g.gridSize}³ voxel grid`,
  );

  const conAssignment = timed(
    'Decomposing the IAU B1875 constellation boundaries',
    () => createConstellationAssignment(iauEdgeRecords(STELLARIUM.read())),
    () => 'built the region grid',
  );

  const sizes: ReadStarsInputSizes = {
    bjEntries: bjMap.size,
    apsisEntries: apsisMap.size,
    gspcEntries: gspcMap.size,
    simbadSptypeEntries: simbadSpectral.bySourceId.size,
    simbadValuesEntries: simbadValues.rowCount,
    gaiaAstrometryEntries: directions.gaiaAstrometry.size,
    hip2Entries: directions.hip2.size,
    hipVMagEntries: hipVMag.size,
    hipBvEntries: hipBv.size,
    nssSourceIdEntries: directions.nss.size,
    tycho2Entries: directions.tycho2.size,
    cns5AstrometryEntries: directions.cns5.size,
    glieseEntries: gliese.rowCount,
    pairMemberParallaxEntries: pairMemberParallax.entryCount,
    pairMemberSiblingNoAstrometryRow: pairMemberParallax.refused.noAstrometryRow,
    pairMemberSiblingNoParallax: pairMemberParallax.refused.noParallax,
    pairMemberSiblingNotAnchorGrade: pairMemberParallax.refused.notAnchorGrade,
    pairMemberSiblingBelowSnFloor: pairMemberParallax.refused.belowSnFloor,
  };

  return {
    bjMap, apsisMap, gspcMap, simbadSpectral, simbadValues, directions,
    hipVMag, hipBv, gliese, pairMemberParallax, dustGrid, conAssignment, sizes,
  };
}
