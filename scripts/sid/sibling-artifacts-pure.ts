// Canonical specs for the sibling artifacts (clouds.json, local-group.json)
// that carry an in-record sid, each namespace its own registry partition. See
// /scripts/sid/README.md#sibling-artifact-stamping.

import { PUBLIC_FILES } from '../../src/catalog-format/public-artifacts/public-artifacts';
import type { SidObject } from './allocate-pure';
import { ALLOCATION_CODES } from './allocation-lineage-pure';
import type { SidKind } from './sid-pure';
import { SIBLING_PARTITIONS, type SiblingPartition } from '../../src/catalog-format/pipeline-outputs/data-files';

export interface SiblingArtifactSpec {
  /** public/ filename. */
  file: string;
  /** Top-level array property holding the objects. */
  arrayKey: string;
  /** Designation namespace the ledger keys these objects on (/docs/sid.md#3-designation-namespaces). */
  ns: SiblingPartition;
  kind: SidKind;
  /** pnpm script that emits `file` and allocates `ns`. */
  buildHint: string;
  /** The allocation code a new object of this artifact mints under. */
  mintCode: string;
}

export const SIBLING_ARTIFACTS = {
  clouds: {
    file: PUBLIC_FILES.clouds,
    arrayKey: 'clouds',
    ns: 'cloud',
    kind: 'cloud',
    buildHint: 'pnpm run build:clouds',
    mintCode: ALLOCATION_CODES.code('mint.cloud'),
  },
  'local-group': {
    file: PUBLIC_FILES.localGroup,
    arrayKey: 'objects',
    ns: 'lg',
    kind: 'galaxy',
    buildHint: 'pnpm run build:local-group',
    mintCode: ALLOCATION_CODES.code('mint.local-group'),
  },
} as const satisfies Record<string, SiblingArtifactSpec>;

export type SiblingName = keyof typeof SIBLING_ARTIFACTS;
type UnclaimedPartition = Exclude<SiblingPartition, (typeof SIBLING_ARTIFACTS)[SiblingName]['ns']>;
/** Fails typecheck while a sibling partition has no artifact; nothing reads it. */
export const EVERY_SIBLING_PARTITION_CLAIMED: [UnclaimedPartition] extends [never] ? true : never = true;

const SIBLING_NAMES = Object.keys(SIBLING_ARTIFACTS) as SiblingName[];

export function siblingOf(ns: SiblingPartition): SiblingArtifactSpec {
  return SIBLING_ARTIFACTS[SIBLING_NAMES.find((name) => SIBLING_ARTIFACTS[name].ns === ns)!];
}

export function isSiblingNamespace(ns: string): ns is SiblingPartition {
  return (SIBLING_PARTITIONS as readonly string[]).includes(ns);
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

/** A sibling record's frozen `id`, the slug its SID is keyed on: ASCII kebab-case of `name` after NFKD,
 *  `fallback` when nothing survives. Changing it re-keys every sibling record. */
export function siblingSlug(name: string, fallback: string): string {
  return name.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || fallback;
}
