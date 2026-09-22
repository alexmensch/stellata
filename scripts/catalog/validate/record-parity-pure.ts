// Sid-keyed field comparison between two built catalogues.
// README.md § Additive-mode record parity.

import {
  FLAG_HAS_NAME,
  NO_COMPANION,
  RECORD_LAYOUT,
  RECORD_SIZE,
  readCatalogHeader,
  readNameTable,
  readRecordField,
  readRecordFieldBig,
  recordsOffset,
  type NumericRecordField,
} from '../record/catalog-pure';

const NUMERIC_FIELDS = (Object.keys(RECORD_LAYOUT) as (keyof typeof RECORD_LAYOUT)[])
  .filter((f): f is NumericRecordField =>
    f !== 'gaiaSourceId' && f !== 'companion' && f !== 'nameOffset');

export interface FieldDelta {
  readonly sid: number;
  readonly field: string;
  readonly baseline: string;
  readonly current: string;
}

export interface ParityReport {
  readonly baselineRecords: number;
  readonly currentRecords: number;
  /** Sids the baseline carries that the current build does not. */
  readonly droppedSids: readonly number[];
  /** Sids only the current build carries — the additive half, never a failure. */
  readonly addedSids: number;
  /** One entry per field that moved on a shared sid. */
  readonly deltas: readonly FieldDelta[];
  readonly deltasByField: ReadonlyMap<string, number>;
  /** Records carrying NO_SID, which nothing can key. */
  readonly baselineUnallocated: number;
  readonly currentUnallocated: number;
  /** Sids more than one record carries, in either build — skipped. */
  readonly baselineSharedSids: number;
  readonly currentSharedSids: number;
}

interface CatalogView {
  readonly view: DataView;
  readonly base: number;
  readonly count: number;
  readonly nameAt: ReadonlyMap<number, string>;
  readonly indexBySid: ReadonlyMap<number, number>;
  readonly sharedSids: ReadonlySet<number>;
  readonly unallocated: number;
}

function openCatalog(buffer: ArrayBuffer): CatalogView {
  const view = new DataView(buffer);
  const header = readCatalogHeader(buffer);
  const base = recordsOffset(header);
  const indexBySid = new Map<number, number>();
  const sharedSids = new Set<number>();
  let unallocated = 0;
  for (let i = 0; i < header.count; i++) {
    const sid = readRecordField(view, base + i * RECORD_SIZE, 'sid');
    if (sid === 0) { unallocated++; continue; }
    // A sid on two records is one object drawn twice, so which record the
    // comparison lands on is arbitrary — reported, never compared.
    if (indexBySid.has(sid)) { sharedSids.add(sid); continue; }
    indexBySid.set(sid, i);
  }
  return {
    view,
    base,
    count: header.count,
    nameAt: readNameTable(buffer, header.nameTableOffset, header.nameTableLength),
    indexBySid,
    sharedSids,
    unallocated,
  };
}

function nameOf(cat: CatalogView, off: number): string | null {
  if ((readRecordField(cat.view, off, 'flags') & FLAG_HAS_NAME) === 0) return null;
  return cat.nameAt.get(readRecordField(cat.view, off, 'nameOffset')) ?? null;
}

/** The companion as an OBJECT, so the comparison survives the re-sort. */
function companionSidOf(cat: CatalogView, off: number): number | null {
  const idx = readRecordField(cat.view, off, 'companion');
  if (idx === NO_COMPANION || idx >= cat.count) return null;
  return readRecordField(cat.view, cat.base + idx * RECORD_SIZE, 'sid');
}

/** Every field of every record the two builds share, keyed on sid. Record
 *  INDICES move whenever membership does and are never compared —
 *  `../record/README.md` § Record order. */
export function compareRecordParity(
  baselineBuffer: ArrayBuffer,
  currentBuffer: ArrayBuffer,
  maxDeltaSamples = 200,
): ParityReport {
  const baseline = openCatalog(baselineBuffer);
  const current = openCatalog(currentBuffer);

  const droppedSids: number[] = [];
  const deltas: FieldDelta[] = [];
  const deltasByField = new Map<string, number>();

  const note = (sid: number, field: string, b: unknown, c: unknown) => {
    deltasByField.set(field, (deltasByField.get(field) ?? 0) + 1);
    if (deltas.length < maxDeltaSamples) {
      deltas.push({ sid, field, baseline: String(b), current: String(c) });
    }
  };

  for (const [sid, bi] of baseline.indexBySid) {
    if (baseline.sharedSids.has(sid) || current.sharedSids.has(sid)) continue;
    const ci = current.indexBySid.get(sid);
    if (ci === undefined) { droppedSids.push(sid); continue; }
    const bOff = baseline.base + bi * RECORD_SIZE;
    const cOff = current.base + ci * RECORD_SIZE;

    for (const field of NUMERIC_FIELDS) {
      const b = readRecordField(baseline.view, bOff, field);
      const c = readRecordField(current.view, cOff, field);
      if (!Object.is(b, c)) note(sid, field, b, c);
    }
    const bGaia = readRecordFieldBig(baseline.view, bOff, 'gaiaSourceId');
    const cGaia = readRecordFieldBig(current.view, cOff, 'gaiaSourceId');
    if (bGaia !== cGaia) note(sid, 'gaiaSourceId', bGaia, cGaia);

    const bName = nameOf(baseline, bOff);
    const cName = nameOf(current, cOff);
    if (bName !== cName) note(sid, 'name', bName, cName);

    const bComp = companionSidOf(baseline, bOff);
    const cComp = companionSidOf(current, cOff);
    if (bComp !== cComp) note(sid, 'companionSid', bComp, cComp);
  }

  let addedSids = 0;
  for (const sid of current.indexBySid.keys()) {
    if (!baseline.indexBySid.has(sid)) addedSids++;
  }

  return {
    baselineRecords: baseline.count,
    currentRecords: current.count,
    droppedSids,
    addedSids,
    deltas,
    deltasByField,
    baselineUnallocated: baseline.unallocated,
    currentUnallocated: current.unallocated,
    baselineSharedSids: baseline.sharedSids.size,
    currentSharedSids: current.sharedSids.size,
  };
}

/** Moved fields are reported, never failed: README.md § Additive-mode record
 *  parity. */
export function parityHolds(report: ParityReport): boolean {
  return report.droppedSids.length === 0 && report.currentSharedSids === 0;
}

export function formatParityReport(report: ParityReport, samples = 20): string {
  const movedFields = [...report.deltasByField]
    .sort((a, b) => b[1] - a[1])
    .map(([field, n]) => `${field} ${n.toLocaleString()}`);
  const lines = [
    `baseline ${report.baselineRecords.toLocaleString()} records`
    + ` (${report.baselineUnallocated.toLocaleString()} NO_SID)`,
    `current  ${report.currentRecords.toLocaleString()} records`
    + ` (${report.currentUnallocated.toLocaleString()} NO_SID)`,
    `added    ${report.addedSids.toLocaleString()} sids`,
    `dropped  ${report.droppedSids.length.toLocaleString()} sids`,
    `moved    ${movedFields.length === 0 ? 'nothing' : movedFields.join(' · ')}`,
    `shared   ${report.baselineSharedSids} baseline / ${report.currentSharedSids} current`
    + ' sid(s) on more than one record, skipped',
  ];
  for (const sid of report.droppedSids.slice(0, samples)) lines.push(`  dropped sid ${sid}`);
  for (const d of report.deltas.slice(0, samples)) {
    lines.push(`  sid ${d.sid} ${d.field}: ${d.baseline} -> ${d.current}`);
  }
  return lines.join('\n');
}
