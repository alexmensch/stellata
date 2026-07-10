// Canonical specs for the sibling artifacts (clouds.json, local-group.json)
// that carry an in-record sid, shared by sid:allocate and the stamp. See
// scripts/sid/README.md § Sibling-artifact stamping.

import type { SidKind, SidObject } from './sid-pure';

export interface SiblingArtifactSpec {
  /** public/ filename. */
  file: string;
  /** Top-level array property holding the objects. */
  arrayKey: string;
  /** Designation namespace the ledger keys these objects on (docs/sid.md § 3). */
  ns: string;
  kind: SidKind;
  /** npm script that emits `file`. */
  buildHint: string;
}

export const SIBLING_ARTIFACTS: Record<string, SiblingArtifactSpec> = {
  clouds: {
    file: 'clouds.json',
    arrayKey: 'clouds',
    ns: 'cloud',
    kind: 'cloud',
    buildHint: 'npm run build:clouds',
  },
  'local-group': {
    file: 'local-group.json',
    arrayKey: 'objects',
    ns: 'lg',
    kind: 'galaxy',
    buildHint: 'npm run build:local-group',
  },
};

export interface SiblingItem {
  id: string;
  name?: string;
}

/** The SidObjects one sibling artifact's records resolve through — the single
 *  definition shared by sid:allocate (minting) and the stamp (resolving), so
 *  both derive an identical namespace + kind per record. */
export function siblingArtifactObjects(spec: SiblingArtifactSpec, items: SiblingItem[]): SidObject[] {
  return items.map((o) => ({
    designations: [`${spec.ns}:${o.id}`],
    kind: spec.kind,
    label: `${spec.ns} ${o.name ?? o.id}`,
  }));
}
