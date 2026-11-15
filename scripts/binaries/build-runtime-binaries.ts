// Build public/binaries.bin from multiples.tsv and the catalogue's pair ends. See README.md#runtime-side-artifact.

import { relative } from 'node:path';

import { CATALOG_PAIR_ENDS } from '../catalog/companions/record-index/catalog-pair-ends-source';
import { emitArtifacts } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';
import { countSnapshotCheck } from '../util/snapshot-check';
import { handedFileHash, stepInputHashes } from '../util/step-input-hashes';
import { readArtifact } from '../util/sources/source';
import { MULTIPLES_TSV } from './multiples-tsv';
import { RUNTIME_BINARIES_COUNTS } from './build-runtime-binaries-expected-json';
import { RUNTIME_BINARIES_OUTPUTS } from './runtime-binaries-outputs';
import { encodeRuntimeBinaries, multiplesHandshake } from './runtime-binaries-pure';
import {
  RUNTIME_PAIRS_CODES, RUNTIME_PAIRS_INVARIANTS, RUNTIME_PAIRS_LINEAGE_BUDGET, runtimePairsLineageLines,
} from './runtime-pairs-lineage-pure';
import { countedStageLineage, namedStageRun } from '../catalog/lineage/stage-lineage';
import { RUNTIME_PAIRS_LINEAGE } from '../../src/catalog-format/pipeline-outputs/lineage-files';

const log = (msg: string): void => console.log(`[build-runtime-binaries] ${msg}`);

export function main(): void {
  const rows = readArtifact(MULTIPLES_TSV);
  const pairEnds = CATALOG_PAIR_ENDS.read();
  log(`pair ends: ${pairEnds.pairs.size.toLocaleString()} resolved pairs`);
  const { bytes, pairs, fates, counts: c, nested } = encodeRuntimeBinaries(rows, pairEnds.pairs);
  log(`${c.pairs_total.toLocaleString()} physical pairs; ${nested.toLocaleString()} nest inside an outer pair`);
  log(`orbit coverage: ${c.pairs_with_orbit.toLocaleString()} with elements (${c.pairs_with_inclination.toLocaleString()} with inclination)`);
  const inputs = stepInputHashes();
  const lineage = countedStageLineage(namedStageRun({
    spec: RUNTIME_PAIRS_LINEAGE, codes: RUNTIME_PAIRS_CODES, lines: () => runtimePairsLineageLines(pairs, fates),
    budget: RUNTIME_PAIRS_LINEAGE_BUDGET, invariants: RUNTIME_PAIRS_INVARIANTS, inputs,
  }), RUNTIME_PAIRS_CODES);
  log(`fates: ${Object.entries(lineage.counts).map(([code, n]) => `${code}=${n}`).join(', ')}`);
  emitArtifacts({
    outputs: RUNTIME_BINARIES_OUTPUTS,
    files: { binaries: bytes, ...lineage.files },
    members: lineage.members,
    checks: [
      multiplesHandshake(pairEnds.multiplesSha1, handedFileHash(inputs, MULTIPLES_TSV.file)),
      ...lineage.checks,
      countSnapshotCheck(RUNTIME_BINARIES_COUNTS, {
        actual: { stages: { encode: c, [RUNTIME_PAIRS_LINEAGE.stage]: lineage.counts } },
        failureLabel: 'build-runtime-binaries count',
      }),
    ],
  });
  const out = RUNTIME_BINARIES_OUTPUTS.files.binaries;
  const emitted = lineage.counts[RUNTIME_PAIRS_CODES.code('emitted')];
  log(`wrote ${relative(REPO_ROOT, out)} (${emitted.toLocaleString()} pairs, ${(bytes.length / 1024).toFixed(1)} KB)`);
}
