// Pure classifier for Gaia data-release reconciliation: per-risk-id
// carried / contested / dropped classes, shared-candidate grouping, and
// the Δmag review flag. Procedure and measured dry run: /docs/sid.md#6-gaia-data-release-reconciliation.

import { readTable } from '../util/tsv/table-pure';

/** Acceptance radius for a cross-match candidate (/docs/sid.md#61-procedure). */
export const ACCEPT_MAS = 400;

/** |Δmag| beyond which an accepted 1:1 match is flagged for review —
 *  a same-position much-brighter source is a possible mis-match. */
export const MAG_REVIEW_DELTA = 1;

export interface NeighbourhoodRow {
  riskId: bigint;
  candidateId: bigint;
  angularDistanceMas: number;
  magnitudeDifference: number | null;
}

export interface CarriedMatch {
  riskId: bigint;
  candidateId: bigint;
  angularDistanceMas: number;
  magnitudeDifference: number | null;
}

export interface ContestedRisk {
  riskId: bigint;
  candidates: NeighbourhoodRow[];
}

export interface SharedCandidateGroup {
  candidateId: bigint;
  riskIds: bigint[];
}

export interface DrClassification {
  carried: CarriedMatch[];
  carriedSameId: number;
  magFlagged: CarriedMatch[];
  contested: ContestedRisk[];
  /** Rows exist for the risk id but none within ACCEPT_MAS. */
  droppedNearMiss: bigint[];
  /** No cross-match rows at all for the risk id. */
  droppedNoRows: bigint[];
  /** One candidate accepted by ≥2 risk ids — a split of ours in the
   *  reversed dry-run orientation, a merge of ours in a forward DR bump
   *  (/docs/sid.md#61-procedure). */
  sharedCandidateGroups: SharedCandidateGroup[];
  /** p50 / p90 / p99 / max over carried match distances (mas). */
  distanceQuantiles: { p50: number; p90: number; p99: number; max: number };
}

export function readRiskIds(text: string, file: string): bigint[] {
  const spec = { file, columns: ['gaia_source_id'], hint: 'Re-run `pnpm run sid:risk-set`.' };
  return [...readTable(spec, text)].map((row) => BigInt(row.requiredSourceId('gaia_source_id')));
}

export function readNeighbourhoodRows(
  text: string,
  riskCol: string,
  candidateCol: string,
  file: string,
): NeighbourhoodRow[] {
  const spec = {
    file,
    columns: [riskCol, candidateCol, 'angular_distance', 'magnitude_difference'],
    hint: 'Re-pull it per /docs/sid.md#61-procedure.',
  };
  return [...readTable(spec, text)].map((row) => ({
    riskId: BigInt(row.requiredSourceId(riskCol)),
    candidateId: BigInt(row.requiredSourceId(candidateCol)),
    angularDistanceMas: row.float('angular_distance') ?? row.fail('angular_distance is empty'),
    magnitudeDifference: row.float('magnitude_difference'),
  }));
}

function nearestRank(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}

export function classifyDrTransition(
  riskIds: bigint[],
  rows: NeighbourhoodRow[],
  acceptMas: number = ACCEPT_MAS,
): DrClassification {
  const rowsByRisk = new Map<bigint, NeighbourhoodRow[]>();
  for (const row of rows) {
    const list = rowsByRisk.get(row.riskId);
    if (list) list.push(row);
    else rowsByRisk.set(row.riskId, [row]);
  }

  const carried: CarriedMatch[] = [];
  const contested: ContestedRisk[] = [];
  const droppedNearMiss: bigint[] = [];
  const droppedNoRows: bigint[] = [];

  for (const riskId of riskIds) {
    const candidates = rowsByRisk.get(riskId);
    if (!candidates || candidates.length === 0) {
      droppedNoRows.push(riskId);
      continue;
    }
    const accepted = candidates.filter((r) => r.angularDistanceMas <= acceptMas);
    if (accepted.length === 0) droppedNearMiss.push(riskId);
    else if (accepted.length === 1) carried.push(accepted[0]);
    else contested.push({ riskId, candidates: accepted });
  }

  const byCandidate = new Map<bigint, bigint[]>();
  for (const m of carried) {
    const list = byCandidate.get(m.candidateId);
    if (list) list.push(m.riskId);
    else byCandidate.set(m.candidateId, [m.riskId]);
  }
  const sharedCandidateGroups: SharedCandidateGroup[] = [];
  for (const [candidateId, ids] of byCandidate) {
    if (ids.length > 1) sharedCandidateGroups.push({ candidateId, riskIds: ids });
  }

  const distances = carried.map((m) => m.angularDistanceMas).sort((a, b) => a - b);
  return {
    carried,
    carriedSameId: carried.filter((m) => m.riskId === m.candidateId).length,
    magFlagged: carried.filter(
      (m) => m.magnitudeDifference !== null && Math.abs(m.magnitudeDifference) > MAG_REVIEW_DELTA,
    ),
    contested,
    droppedNearMiss,
    droppedNoRows,
    sharedCandidateGroups,
    distanceQuantiles: {
      p50: nearestRank(distances, 0.5),
      p90: nearestRank(distances, 0.9),
      p99: nearestRank(distances, 0.99),
      max: distances.length === 0 ? NaN : distances[distances.length - 1],
    },
  };
}
