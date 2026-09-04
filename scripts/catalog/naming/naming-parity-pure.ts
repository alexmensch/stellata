// The naming parity ledger's codec and its record-identity key. Pure, so
// the generator and the test read one implementation.
// See README.md § The parity ledger.

export interface RowIndexMap {
  byGaia: Record<string, number>;
  byHip: Record<string, number>;
  bySynth: Record<string, number>;
}

/** Record indices reshuffle on every rebuild, so the ledger keys on the
 *  same identifiers the runtime binaries loader resolves records through —
 *  `gaia` first, then `hip`, then the promoted record's synthetic key. */
export function ledgerKeys(map: RowIndexMap): Map<number, string> {
  const out = new Map<number, string>();
  const claim = (idx: number, key: string) => {
    if (!out.has(idx)) out.set(idx, key);
  };
  for (const [id, idx] of Object.entries(map.byGaia)) claim(idx, `gaia:${id}`);
  for (const [id, idx] of Object.entries(map.byHip)) claim(idx, `hip:${id}`);
  for (const [id, idx] of Object.entries(map.bySynth)) claim(idx, `synth:${id}`);
  return out;
}

export interface ParityRow {
  key: string;
  /** The label this record displayed before the naming ladder landed.
   *  FROZEN: it is the string a user could have typed. */
  old: string;
  /** The label the ladder composes. Empty where the record now displays
   *  the runtime's `Gaia DR3` / `SID #` last resort. */
  new: string;
  /** Whether `old` still resolves THIS record through the search corpus.
   *  § 8.1 makes that the hard invariant for a string with external
   *  provenance — a published name or a designation the structure
   *  re-derives. A `false` row is only legitimate where the build composed
   *  the string itself, which § 5 says has no external existence and
   *  disappears with the composition that made it. */
  resolves: boolean;
}

const PARITY_HEADER = 'key\told\tnew\tresolves';

export function parseParityLedger(text: string): ParityRow[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines[0] !== PARITY_HEADER) {
    throw new Error(`naming-parity.tsv header must be ${PARITY_HEADER}`);
  }
  return lines.slice(1).map((line) => {
    const [key, old, next = '', resolves = ''] = line.split('\t');
    return { key, old, new: next, resolves: resolves === 'yes' };
  });
}

export function formatParityLedger(rows: readonly ParityRow[]): string {
  const sorted = [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return [
    PARITY_HEADER,
    ...sorted.map((r) => `${r.key}\t${r.old}\t${r.new}\t${r.resolves ? 'yes' : 'no'}`),
  ].join('\n') + '\n';
}

export interface LabelResolver {
  fuzzyEntries: readonly { label: string; index: number }[];
  hipMap: ReadonlyMap<number, number>;
  hdMap: ReadonlyMap<number, number>;
  hrMap: ReadonlyMap<number, number>;
  glMap: ReadonlyMap<string, number>;
  flamMap: ReadonlyMap<string, readonly { index: number }[]>;
}

/** Does `label` reach `idx` through the search corpus — fuzzy label, exact
 *  Flamsteed key, or one of the identifier maps? The generator and the gate
 *  both ask through here so the ledger's `resolves` column means exactly
 *  what the test checks. */
export function labelResolvesTo(
  index: LabelResolver,
  byLabel: ReadonlyMap<string, ReadonlySet<number>>,
  normalizeGl: (raw: string) => string,
  label: string,
  idx: number,
): boolean {
  if (byLabel.get(label.toLowerCase())?.has(idx) === true) return true;
  if (index.flamMap.get(label.toLowerCase())?.some((e) => e.index === idx) === true) {
    return true;
  }
  const num = /^(HIP|HD|HR)\s+(\d+)$/i.exec(label);
  if (num !== null) {
    const map = num[1].toUpperCase() === 'HIP' ? index.hipMap
      : num[1].toUpperCase() === 'HD' ? index.hdMap : index.hrMap;
    if (map.get(Number(num[2])) === idx) return true;
  }
  return index.glMap.get(normalizeGl(label)) === idx;
}

export function labelIndexOf(
  index: LabelResolver,
): Map<string, Set<number>> {
  const byLabel = new Map<string, Set<number>>();
  for (const e of index.fuzzyEntries) {
    const bucket = byLabel.get(e.label.toLowerCase());
    if (bucket) bucket.add(e.index);
    else byLabel.set(e.label.toLowerCase(), new Set([e.index]));
  }
  return byLabel;
}

export interface DuplicateRow {
  label: string;
  keys: string[];
}

export function parseDuplicateLedger(text: string): DuplicateRow[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  return lines.slice(1).map((line) => {
    const [label, keys] = line.split('\t');
    return { label, keys: keys.split('|') };
  });
}

export function formatDuplicateLedger(rows: readonly DuplicateRow[]): string {
  const sorted = [...rows].sort((a, b) =>
    a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  return ['label\tkeys', ...sorted.map((r) => `${r.label}\t${r.keys.join('|')}`)]
    .join('\n') + '\n';
}
