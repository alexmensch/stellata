// Canonical specs for the sibling artifacts (clouds.json, local-group.json)
// that carry an in-record sid, each namespace its own registry partition. See
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
  /** pnpm script that emits `file` and allocates `ns`. */
  buildHint: string;
  /** The allocation code a new object of this artifact mints under. */
  mintCode: string;
}

export const SIBLING_ARTIFACTS = {
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
} as const satisfies Record<string, SiblingArtifactSpec>;

export type SiblingName = keyof typeof SIBLING_ARTIFACTS;
export type SiblingNamespace = (typeof SIBLING_ARTIFACTS)[SiblingName]['ns'];

const SIBLING_NAMES = Object.keys(SIBLING_ARTIFACTS) as SiblingName[];
export const SIBLING_NAMESPACES: readonly SiblingNamespace[] = SIBLING_NAMES.map((name) => SIBLING_ARTIFACTS[name].ns);

export function siblingOf(ns: SiblingNamespace): SiblingArtifactSpec {
  return SIBLING_ARTIFACTS[SIBLING_NAMES.find((name) => SIBLING_ARTIFACTS[name].ns === ns)!];
}

export function isSiblingNamespace(ns: string): ns is SiblingNamespace {
  return (SIBLING_NAMESPACES as readonly string[]).includes(ns);
}

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
