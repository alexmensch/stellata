// public/system-membership.json: which records form one physical system, how its subsystems nest,
// and each record's known companions with no record of their own. See README.md.

export const SYSTEM_MEMBERSHIP_VERSION = 1;

export const EVIDENCE_SOURCES = ['wds', 'ccdm', 'geometric'] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const NO_RECORD_COMPANIONS = ['eclipsing-partner', 'simbad-multiple', 'ccdm-companion'] as const;
export type NoRecordCompanion = (typeof NO_RECORD_COMPANIONS)[number];

export interface RecordNode {
  readonly kind: 'record';
  /** A catalog.bin record index, true for the catalogue build that wrote the file. */
  readonly record: number;
}

export interface GroupNode {
  readonly kind: 'group';
  /** The WDS component token the group stands for (`B`, `Aa`, `AB`), or null. */
  readonly component: string | null;
  /** Two or more. */
  readonly children: readonly SystemNode[];
}

export type SystemNode = RecordNode | GroupNode;

export interface MembershipSystem {
  /** Each evidence source that joined at least one of its records, in EVIDENCE_SOURCES order. */
  readonly sources: readonly EvidenceSource[];
  readonly root: GroupNode;
}

export interface SystemMembership {
  readonly systems: readonly MembershipSystem[];
  /** Keyed by record index; each list non-empty, in NO_RECORD_COMPANIONS order. */
  readonly companions: ReadonlyMap<number, readonly NoRecordCompanion[]>;
}

/** Every record leaf under `node`, depth first. */
export function nodeRecords(node: SystemNode): number[] {
  if (node.kind === 'record') return [node.record];
  return node.children.flatMap(nodeRecords);
}

type WireNode = number | { readonly component?: string; readonly children: readonly WireNode[] };

function toWire(node: SystemNode): WireNode {
  if (node.kind === 'record') return node.record;
  const children = node.children.map(toWire);
  return node.component === null ? { children } : { component: node.component, children };
}

export function serializeSystemMembership(m: SystemMembership): string {
  return JSON.stringify({
    version: SYSTEM_MEMBERSHIP_VERSION,
    systems: m.systems.map((s) => ({ sources: s.sources, root: toWire(s.root) })),
    companions: [...m.companions],
  }) + '\n';
}

function fail(why: string): never {
  throw new Error(`system membership: ${why}`);
}

function isRecordIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** A list of known values, unique and in `order`'s order. */
function orderedSubset<T extends string>(raw: unknown, order: readonly T[], what: string): T[] {
  if (!Array.isArray(raw) || raw.length === 0) fail(`${what} is ${JSON.stringify(raw)}, not a non-empty list`);
  let last = -1;
  for (const v of raw) {
    const at = order.indexOf(v as T);
    if (at < 0) fail(`${what} names unknown value ${JSON.stringify(v)}`);
    if (at <= last) fail(`${what} ${JSON.stringify(raw)} is not unique and in order ${order.join(', ')}`);
    last = at;
  }
  return raw as T[];
}

function fromWire(raw: unknown, seen: Set<number>): SystemNode {
  if (isRecordIndex(raw)) {
    if (seen.has(raw)) fail(`record ${raw} is in more than one place`);
    seen.add(raw);
    return { kind: 'record', record: raw };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(`node ${JSON.stringify(raw)} is neither a record index nor a group`);
  const { component, children } = raw as { component?: unknown; children?: unknown };
  if (component !== undefined && (typeof component !== 'string' || component === '')) fail(`group component ${JSON.stringify(component)} is not a token`);
  if (!Array.isArray(children) || children.length < 2) fail(`group ${JSON.stringify(component ?? null)} has fewer than two children`);
  return { kind: 'group', component: component ?? null, children: children.map((c) => fromWire(c, seen)) };
}

/** Throws on a version mismatch, an unknown source or companion kind, a group with fewer than two children, or a record in two places. */
export function parseSystemMembership(text: string): SystemMembership {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (raw.version !== SYSTEM_MEMBERSHIP_VERSION) fail(`version ${JSON.stringify(raw.version)}, expected ${SYSTEM_MEMBERSHIP_VERSION}`);
  if (!Array.isArray(raw.systems)) fail('systems is missing');
  if (!Array.isArray(raw.companions)) fail('companions is missing');
  const seen = new Set<number>();
  const systems = raw.systems.map((s: unknown, i): MembershipSystem => {
    const { sources, root } = (s ?? {}) as { sources?: unknown; root?: unknown };
    const node = fromWire(root, seen);
    if (node.kind !== 'group') fail(`system ${i}'s root is a single record`);
    return { sources: orderedSubset(sources, EVIDENCE_SOURCES, `system ${i}'s sources`), root: node };
  });
  const companions = new Map<number, readonly NoRecordCompanion[]>();
  for (const entry of raw.companions as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2 || !isRecordIndex(entry[0])) fail(`companion entry ${JSON.stringify(entry)} is not [record, kinds]`);
    if (companions.has(entry[0])) fail(`record ${entry[0]} has two companion entries`);
    companions.set(entry[0], orderedSubset(entry[1], NO_RECORD_COMPANIONS, `record ${entry[0]}'s companions`));
  }
  return { systems, companions };
}
