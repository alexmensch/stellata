// Pure classifier for Gaia data-release reconciliation: per-risk-id
// carried / contested / dropped classes, shared-candidate grouping, and
// the Δmag review flag. Procedure and measured dry run: docs/sid.md § 6.

/** Acceptance radius for a cross-match candidate (docs/sid.md § 6.1). */
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
   *  (docs/sid.md § 6.1). */
  sharedCandidateGroups: SharedCandidateGroup[];
  /** p50 / p90 / p99 / max over carried match distances (mas). */
  distanceQuantiles: { p50: number; p90: number; p99: number; max: number };
}

export function readRiskIds(text: string): bigint[] {
  const lines = text.trimEnd().split('\n');
  if (lines[0] !== 'gaia_source_id') throw new Error(`bad request header "${lines[0]}"`);
  return lines.slice(1).map((l) => BigInt(l));
}

export function readNeighbourhoodRows(
  text: string,
  riskCol: string,
  candidateCol: string,
): NeighbourhoodRow[] {
  const lines = text.trimEnd().split('\n');
  const cols = lines[0].split('\t');
  const iRisk = cols.indexOf(riskCol);
  const iCand = cols.indexOf(candidateCol);
  const iDist = cols.indexOf('angular_distance');
  const iDmag = cols.indexOf('magnitude_difference');
  if (iRisk < 0 || iCand < 0 || iDist < 0 || iDmag < 0) {
    throw new Error(`neighbourhood TSV lacks a required column (header: ${lines[0]})`);
  }
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return {
      riskId: BigInt(cells[iRisk]),
      candidateId: BigInt(cells[iCand]),
      angularDistanceMas: Number(cells[iDist]),
      magnitudeDifference: cells[iDmag] === '' ? null : Number(cells[iDmag]),
    };
  });
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
