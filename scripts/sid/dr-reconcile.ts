// `pnpm run sid:dr-reconcile` — classify a Gaia DR transition's cross-match
// pull per /docs/sid.md#61-procedure and emit the churn report, plus the carried-1:1
// bridge edges for review. See scripts/sid/README.md.

import { emitArtifacts, runStep } from '../util/emit-artifacts';
import { DR_RECONCILE_OUTPUTS } from './dr-reconcile-outputs';
import {
  DR2_NEIGHBOURHOOD,
  DR2_NEIGHBOURHOOD_REQUEST,
  NEIGHBOURHOOD_HINT,
  RISK_REQUEST_HINT,
  neighbourhoodSource,
  riskRequestSource,
} from './dr2-neighbourhood-source';
import {
  ACCEPT_MAS,
  MAG_REVIEW_DELTA,
  classifyDrTransition,
} from './dr-reconcile-pure';

interface CliArgs {
  request: string | null;
  neighbourhood: string | null;
  riskCol: string;
  candidateCol: string;
  riskNs: string;
  candidateNs: string;
}

function parseArgs(argv: string[]): CliArgs {
  const option = (name: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const get = (name: string, fallback: string): string => option(name) ?? fallback;
  return {
    request: option('request'),
    neighbourhood: option('neighbourhood'),
    riskCol: get('risk-col', 'dr3_source_id'),
    candidateCol: get('candidate-col', 'dr2_source_id'),
    riskNs: get('risk-ns', 'gaia_dr3'),
    candidateNs: get('candidate-ns', 'gaia_dr2'),
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const request = args.request === null
    ? DR2_NEIGHBOURHOOD_REQUEST
    : riskRequestSource({ file: args.request, hint: RISK_REQUEST_HINT });
  const neighbourhood = args.neighbourhood === null
    ? DR2_NEIGHBOURHOOD
    : neighbourhoodSource({ file: args.neighbourhood, hint: NEIGHBOURHOOD_HINT });
  const riskIds = request.read();
  const rows = neighbourhood.read(args.riskCol, args.candidateCol);
  const c = classifyDrTransition(riskIds, rows);

  const pct = (n: number) => `${((n / riskIds.length) * 100).toFixed(2)}%`;
  const q = c.distanceQuantiles;
  console.log(`risk set: ${riskIds.length} ids (${args.riskNs}) vs ${rows.length} cross-match rows`);
  console.log(`  carried 1:1 (unique ≤ ${ACCEPT_MAS} mas): ${c.carried.length} (${pct(c.carried.length)})`);
  console.log(`    same source_id kept: ${c.carriedSameId}`);
  console.log(`    distance p50/p90/p99/max (mas): ${q.p50}/${q.p90}/${q.p99}/${q.max}`);
  console.log(`    |Δmag| > ${MAG_REVIEW_DELTA} review flags: ${c.magFlagged.length}`);
  console.log(`  contested (≥2 ≤ ${ACCEPT_MAS} mas): ${c.contested.length}`);
  console.log(
    `  shared-candidate groups: ${c.sharedCandidateGroups.length} ` +
      `(covering ${c.sharedCandidateGroups.reduce((n, g) => n + g.riskIds.length, 0)} risk ids)`,
  );
  console.log(`  dropped, rows but none accepted: ${c.droppedNearMiss.length}`);
  console.log(`  dropped, no cross-match rows: ${c.droppedNoRows.length}`);

  const line = (riskId: bigint) => `    ${args.riskNs}:${riskId}`;
  if (c.contested.length > 0) {
    console.log('  contested detail:');
    for (const ct of c.contested) {
      console.log(`${line(ct.riskId)} → ${ct.candidates.map((r) => `${r.candidateId}@${r.angularDistanceMas}mas`).join(', ')}`);
    }
  }
  if (c.sharedCandidateGroups.length > 0) {
    console.log('  shared-candidate detail (split/merge review, /docs/sid.md#61-procedure):');
    for (const g of c.sharedCandidateGroups) {
      console.log(`    ${args.candidateNs}:${g.candidateId} ← ${g.riskIds.map((r) => `${args.riskNs}:${r}`).join(', ')}`);
    }
  }
  if (c.magFlagged.length > 0) {
    console.log(`  |Δmag| > ${MAG_REVIEW_DELTA} detail:`);
    for (const m of c.magFlagged) {
      console.log(`${line(m.riskId)} → ${m.candidateId} (Δmag ${m.magnitudeDifference})`);
    }
  }
  if (c.droppedNearMiss.length > 0) {
    console.log('  near-miss detail (manual review + PM-propagation check):');
    for (const id of c.droppedNearMiss) console.log(line(id));
  }

  const body = c.carried
    .map((m) => `${args.riskNs}:${m.riskId}\t${args.candidateNs}:${m.candidateId}\tcarried 1:1 @ ${m.angularDistanceMas} mas`)
    .join('\n');
  emitArtifacts({ outputs: DR_RECONCILE_OUTPUTS, files: { bridges: `a\tb\tnote\n${body}\n` } });
  console.log(
    `wrote ${DR_RECONCILE_OUTPUTS.files.bridges} (${c.carried.length} bridge edges — human review before commit)`,
  );
}

runStep(main);