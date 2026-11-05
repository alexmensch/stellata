// Canonical specs for the sibling artifacts (clouds.json, local-group.json)
// that carry an in-record sid, each namespace its own registry partition. See
// /scripts/sid/README.md#sibling-artifact-stamping.

import type { SidObject } from './allocate-pure';
import { ALLOCATION_CODES, objectOutcomeCodes, type ObjectOutcomeCodes } from './allocation-lineage-pure';
import type { SidKind } from './sid-pure';
import { sourceRowRef, sourceRowRefText, type RowKeyed } from '../util/sources/row-ref-pure';
import {
  CLOUD_PARTITION, LOCAL_GROUP_PARTITION, SIBLING_PARTITIONS, type SiblingPartition,
} from '../../src/catalog-format/pipeline-outputs/data-files';
import {
  CLOUDS_ALLOCATION_LINEAGE, LOCAL_GROUP_ALLOCATION_LINEAGE, type StageLineageSpec,
} from '../../src/catalog-format/pipeline-outputs/lineage-files';

export interface SiblingArtifactSpec<S extends string = string> {
  /** Top-level array property holding the objects. */
  arrayKey: string;
  /** Designation namespace the ledger keys these objects on (/docs/sid.md#3-designation-namespaces). */
  ns: SiblingPartition;
  kind: SidKind;
  /** pnpm script that emits `file` and allocates `ns`. */
  buildHint: string;
  /** The allocation code a new object of this artifact mints under. */
  mintCode: string;
  /** The build's own allocation stage. */
  lineage: StageLineageSpec<S | `${S}.identity`, S>;
  codes: ObjectOutcomeCodes;
}

export const SIBLING_ARTIFACTS = {
  clouds: {
    arrayKey: 'clouds',
    ns: CLOUD_PARTITION,
    kind: 'cloud',
    buildHint: 'pnpm run build:clouds',
    mintCode: ALLOCATION_CODES.code('mint.cloud'),
    lineage: CLOUDS_ALLOCATION_LINEAGE,
    codes: objectOutcomeCodes(CLOUDS_ALLOCATION_LINEAGE.stage),
  },
  'local-group': {
    arrayKey: 'objects',
    ns: LOCAL_GROUP_PARTITION,
    kind: 'galaxy',
    buildHint: 'pnpm run build:local-group',
    mintCode: ALLOCATION_CODES.code('mint.local-group'),
    lineage: LOCAL_GROUP_ALLOCATION_LINEAGE,
    codes: objectOutcomeCodes(LOCAL_GROUP_ALLOCATION_LINEAGE.stage),
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

/** A sibling artifact's records, cited by their slug. */
export type SiblingArtifact = RowKeyed<{ readonly id: string }>;

/** The SidObjects one sibling artifact's records allocate as, each founded on its own record. */
export function siblingArtifactObjects(
  spec: SiblingArtifactSpec, artifact: SiblingArtifact, items: readonly SiblingItem[],
): SidObject[] {
  return items.map((o) => ({
    designations: [`${spec.ns}:${o.id}`],
    kind: spec.kind,
    label: `${spec.ns} ${o.name ?? o.id}`,
    admission: { kind: 'declared', code: spec.mintCode, origin: sourceRowRefText(sourceRowRef(artifact, o)) },
  }));
}

/** A sibling record's frozen `id`, the slug its SID is keyed on: ASCII kebab-case of `name` after NFKD,
 *  `fallback` when nothing survives. Changing it re-keys every sibling record. */
export function siblingSlug(name: string, fallback: string): string {
  return name.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || fallback;
}
