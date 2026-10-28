// The committed SID registry, read and structurally validated for a read-only consumer.

import { readArtifact } from '../util/sources/source';
import { LEDGER } from './ledger-tsv';
import { REINSTATEMENTS, RETIREMENTS } from './registry-source';
import {
  validateLedger,
  validateReinstatements,
  validateRetirements,
  type LedgerRow,
  type ReinstatementRow,
  type RetirementRow,
  type SameasEdge,
} from './sid-pure';
import { loadStoredEdges } from './stored-edges';

export interface Registry {
  ledger: LedgerRow[];
  retirements: RetirementRow[];
  reinstatements: ReinstatementRow[];
  storedEdges: SameasEdge[];
}

export function loadRegistry(): Registry {
  const ledger = readArtifact(LEDGER);
  const retirements = RETIREMENTS.read().rows;
  const reinstatements = REINSTATEMENTS.read().rows;
  const errors = [
    ...validateLedger(ledger),
    ...validateRetirements(retirements, ledger, reinstatements),
    ...validateReinstatements(reinstatements, ledger, retirements),
  ];
  if (errors.length > 0) {
    throw new Error(`SID registry is structurally invalid:\n  ${errors.join('\n  ')}`);
  }
  return { ledger, retirements, reinstatements, storedEdges: loadStoredEdges() };
}
