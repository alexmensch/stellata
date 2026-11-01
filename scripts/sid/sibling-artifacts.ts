// Canonical specs for the sibling artifacts (clouds.json, local-group.json)
// that carry an in-record sid, allocated by the stamp. See
// /scripts/sid/README.md#sibling-artifact-stamping.

import type { SidObject } from './allocate-pure';
import { ALLOCATION_CODES } from './allocation-lineage-pure';
import type { SidKind } from './sid-pure';

export interface SiblingArtifactSpec {
  /** public/ filename. */
  file: string;
  /** Top-level array property holding the objects. */
  arrayKey: string;
  /** Designation namespace the ledger keys these objects on (/docs/sid.md#3-designation-namespaces). */
  ns: string;
  kind: SidKind;
  /** pnpm script that emits `file`. */
  buildHint: string;
  /** The allocation code a new object of this artifact mints under. */
  mintCode: string;
}

export const SIBLING_ARTIFACTS: Record<string, SiblingArtifactSpec> = {
  clouds: {
    file: 'clouds.json',
    arrayKey: 'clouds',
    ns: 'cloud',
    kind: 'cloud',
    buildHint: 'pnpm run build:clouds',
    mintCode: ALLOCATION_CODES.code('mint.cloud'),
  },
  'local-group': {
    file: 'local-group.json',
    arrayKey: 'objects',
    ns: 'lg',
    kind: 'galaxy',
    buildHint: 'pnpm run build:local-group',
    mintCode: ALLOCATION_CODES.code('mint.local-group'),
  },
};

export const SIBLING_NAMESPACES: ReadonlySet<string> = new Set(Object.values(SIBLING_ARTIFACTS).map((s) => s.ns));

export interface SiblingItem {
  id: string;
  name?: string;
}

/** The SidObjects one sibling artifact's records allocate as. */
export function siblingArtifactObjects(spec: SiblingArtifactSpec, items: SiblingItem[]): SidObject[] {
  return items.map((o) => ({
    designations: [`${spec.ns}:${o.id}`],
    kind: spec.kind,
    label: `${spec.ns} ${o.name ?? o.id}`,
    admission: { kind: 'declared', code: spec.mintCode, origin: null },
  }));
}
