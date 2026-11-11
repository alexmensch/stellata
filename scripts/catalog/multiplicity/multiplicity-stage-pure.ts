// The multiplicity stage's count block, its log line, and each record's multiplicity status. See README.md.

import {
  MULTIPLICITY_RESOLVED, MULTIPLICITY_SINGLE, MULTIPLICITY_UNRESOLVED,
} from '../../../src/catalog-format/record/catalog-pure';

/** The multiplicity stage's count block. */
export type MultiplicityCounts = {
  /** `inferBinaries` companion assignments. */
  binaryPairs: number;
  /** Pairs where both stars chose each other (sets FLAG_BINARY_PRIMARY). */
  binaryMutualPairs: number;
  /** Total CCDM systems in the source TSV. */
  ccdmGroups: number;
  /** CCDM systems resolved against catalog records. */
  ccdmResolved: number;
  /** New FLAG_BINARY_PRIMARY bits set by the CCDM pass (excludes ones
   *  already set by `inferBinaries`). */
  ccdmFlagged: number;
  /** CCDM primaries the optical-double gate vetoed: nearest same-group
   *  sibling >1 pc away in 3D at Gaia-quality distances, with no physical
   *  pair / eclipsing / geometric evidence. See isOpticalDoublePrimary. */
  ccdmSuppressedOptical: number;
  /** FLAG_BINARY_PRIMARY bits newly set by the eclipsing-binary pass:
   *  varType == ECLIPSING records not already flagged by the geometric
   *  or CCDM passes. */
  eclipsingWinged: number;
  /** FLAG_BINARY_PRIMARY bits newly set by the renderable-companion pass:
   *  physical systems whose primary/secondary resolve to distinct catalog
   *  records (a promoted companion or a binaries.bin orbit) but which the
   *  geometric, CCDM, and eclipsing passes all left unflagged. One per WDS
   *  system anchor; excludes systems already flagged. Canopus, 16 Cyg A. */
  renderableCompanionWinged: number;
  /** Catalog records carrying a multiples.tsv component designation
   *  (`cl`/`cp` on their SearchEntry) — the WDS root's naming anchor plus
   *  the letter, which both the display-name composer and the
   *  "<system> <letter>" search aliases build from. */
  componentDesignations: number;
  /** Records backed by a resolved multiples.tsv member row —
   *  multiplicityStatus = MULTIPLICITY_RESOLVED. */
  multiplicityResolved: number;
  /** Records SIMBAD flags as multiple (otype '**') with no resolved
   *  multiples.tsv member row — multiplicityStatus =
   *  MULTIPLICITY_UNRESOLVED (spectroscopic binaries, 64 Vir class). */
  multiplicityUnresolved: number;
};

/** Each record's multiplicity_status byte (README.md#multiplicity-status), and how many took each non-single value. */
export function multiplicityStatuses(
  records: readonly { readonly gaiaSourceId: string | null }[],
  resolvedMembers: ReadonlySet<number>,
  isSimbadMultiple: (gaiaSourceId: string) => boolean,
): { status: Uint8Array; counts: Pick<MultiplicityCounts, 'multiplicityResolved' | 'multiplicityUnresolved'> } {
  const status = new Uint8Array(records.length);
  for (const idx of resolvedMembers) status[idx] = MULTIPLICITY_RESOLVED;
  let multiplicityUnresolved = 0;
  for (let i = 0; i < records.length; i++) {
    if (status[i] !== MULTIPLICITY_SINGLE) continue;
    const sourceId = records[i].gaiaSourceId;
    if (sourceId !== null && isSimbadMultiple(sourceId)) {
      status[i] = MULTIPLICITY_UNRESOLVED;
      multiplicityUnresolved++;
    }
  }
  return { status, counts: { multiplicityResolved: resolvedMembers.size, multiplicityUnresolved } };
}

export function multiplicitySummary(c: MultiplicityCounts): string {
  return `  multiplicity: ${c.binaryPairs} companion assignments, ${c.binaryMutualPairs} mutual pairs; `
    + `CCDM ${c.ccdmGroups} systems → ${c.ccdmResolved} resolved in catalog, ${c.ccdmFlagged} new primaries flagged, `
    + `${c.ccdmSuppressedOptical} suppressed as optical doubles; wings on ${c.eclipsingWinged} eclipsing binaries `
    + `and ${c.renderableCompanionWinged} renderable-companion primaries; ${c.componentDesignations} component designations; `
    + `${c.multiplicityResolved} resolved, ${c.multiplicityUnresolved} unresolved (SIMBAD '**', nothing resolved)`;
}
