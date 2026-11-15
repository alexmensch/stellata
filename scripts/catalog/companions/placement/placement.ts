// Where a promoted component sits: its own per-component fit, else a WDS (ρ, θ) projection off its anchor. See README.md#position.

import { hasRenderableOrbit } from '../../../../src/catalog-format/binaries/binaries-format';
import { ARCSEC_TO_RAD } from '../../../../src/astro-core/astronomy-constants';
import { equatorialTangentBasisAt, polarToTangent } from '../../../../src/astro-core/equatorial-basis';
import { OPTICAL_DOUBLE_MIN_SEP_PC } from '../../multiplicity/binary-flags-pure';
import type { MultiplesTsvRow } from '../multiples-row';
import { rebasedAnchorOffset } from './anchor-offset-pure';

const INDEPENDENT_FIT_ROUTES: ReadonlySet<string> = new Set([
  'gaia_5p',
  'hip2_long_baseline',
]);

export interface CompanionPlacement {
  x: number;
  y: number;
  z: number;
  distPc: number;
}

/** The catalogue record's xyz — README.md#position. */
export interface ProjectionAnchor {
  x: number;
  y: number;
  z: number;
}

// θ is WDS position angle, degrees east of north at the primary, on the ICRS
// tangent basis the runtime's sky→ICRS orbit projection also rides.
export function projectFromSepPa(
  primaryX: number,
  primaryY: number,
  primaryZ: number,
  sepArcsec: number,
  paDeg: number,
): CompanionPlacement | null {
  const at = equatorialTangentBasisAt(primaryX, primaryY, primaryZ);
  if (at === null) return null;
  const { basis: { east, north }, rPc: distPc } = at;
  const offset = polarToTangent(sepArcsec, paDeg);
  const offsetN = offset.northArcsec * ARCSEC_TO_RAD;
  const offsetE = offset.eastArcsec * ARCSEC_TO_RAD;
  // Small-angle: linear in parsecs at the primary's distance.
  const cx = primaryX + (offsetN * north.x + offsetE * east.x) * distPc;
  const cy = primaryY + (offsetN * north.y + offsetE * east.y) * distPc;
  const cz = primaryZ + (offsetN * north.z + offsetE * east.z) * distPc;
  return {
    x: cx,
    y: cy,
    z: cz,
    distPc: Math.sqrt(cx * cx + cy * cy + cz * cz),
  };
}

/** README.md#projected-separation-tidal-gate. */
export function projectionBeyondTidalLimit(
  anchorX: number,
  anchorY: number,
  anchorZ: number,
  sepArcsec: number,
): boolean {
  const distPc = Math.sqrt(
    anchorX * anchorX + anchorY * anchorY + anchorZ * anchorZ,
  );
  return sepArcsec * ARCSEC_TO_RAD * distPc > OPTICAL_DOUBLE_MIN_SEP_PC;
}

/** README.md#position. */
export function hasIndependentFitRoute(
  row: MultiplesTsvRow,
  primaryGaia: string | null,
  primaryHip: number | null,
): boolean {
  return INDEPENDENT_FIT_ROUTES.has(row.astrometryVia)
    && ((row.astrometryVia === 'gaia_5p'
         && row.gaiaSourceId !== null
         && row.gaiaSourceId !== primaryGaia)
      || (row.astrometryVia === 'hip2_long_baseline'
          && row.hip !== null && row.hip > 0
          && row.hip !== primaryHip));
}

// Separate from the route test: the refusal gate asks about the route, and a
// row on one with no xyz places nothing.
export function resolveIndependentAstrometry(
  row: MultiplesTsvRow,
  primaryGaia: string | null,
  primaryHip: number | null,
): CompanionPlacement | null {
  const placed = row.x_pc !== null && row.y_pc !== null && row.z_pc !== null
    && row.distPc !== null;
  if (!placed || !hasIndependentFitRoute(row, primaryGaia, primaryHip)) return null;
  return {
    x: row.x_pc as number, y: row.y_pc as number, z: row.z_pc as number,
    distPc: row.distPc as number,
  };
}

/** A secondary's placement off `anchor` (else the primary row's xyz), or
 *  `beyond-tidal`, or null where no static placement exists. */
export function resolvePosition(
  row: MultiplesTsvRow,
  primary: MultiplesTsvRow | null,
  anchor: ProjectionAnchor | null,
): CompanionPlacement | 'beyond-tidal' | null {
  const independent = resolveIndependentAstrometry(
    row, primary?.gaiaSourceId ?? null, primary?.hip ?? null,
  );
  if (independent !== null) return independent;
  let anchorX: number, anchorY: number, anchorZ: number;
  if (anchor !== null) {
    anchorX = anchor.x; anchorY = anchor.y; anchorZ = anchor.z;
  } else if (primary !== null
      && primary.x_pc !== null && primary.y_pc !== null && primary.z_pc !== null) {
    anchorX = primary.x_pc; anchorY = primary.y_pc; anchorZ = primary.z_pc;
  } else {
    return null;
  }
  const sepArcsec = row.sepArcsec;
  const paDeg = row.paDeg;
  if (sepArcsec === null || sepArcsec === 0) {
    if (!hasRenderableOrbit(row)) return null;
    return {
      x: anchorX, y: anchorY, z: anchorZ,
      distPc: Math.sqrt(anchorX * anchorX + anchorY * anchorY + anchorZ * anchorZ),
    };
  }
  if (paDeg === null) return null;
  if (projectionBeyondTidalLimit(anchorX, anchorY, anchorZ, sepArcsec)) {
    return 'beyond-tidal';
  }
  return projectFromSepPa(anchorX, anchorY, anchorZ, sepArcsec, paDeg);
}

/** README.md#position-for-pair-row-primaries. */
export function resolveEscapePosition(
  primary: MultiplesTsvRow,
  anchorRow: MultiplesTsvRow,
  anchor: ProjectionAnchor,
): CompanionPlacement | 'beyond-tidal' | null {
  const independent = resolveIndependentAstrometry(primary, anchorRow.gaiaSourceId, anchorRow.hip);
  if (independent !== null) return independent;
  const offset = rebasedAnchorOffset(primary, anchorRow);
  if (offset === null) return null;
  if (projectionBeyondTidalLimit(anchor.x, anchor.y, anchor.z, offset.sepArcsec)) return 'beyond-tidal';
  return projectFromSepPa(anchor.x, anchor.y, anchor.z, offset.sepArcsec, offset.paDeg);
}
