// Membership audit of the inherited spine against the frozen primary tables
// AT-HYG merged: per-row designation attestation, source_id reproduction from
// the raw cross-walks, and the records the primaries admit that the spine lacks.

import { SOL_PROPER_NAME, normaliseGjKey } from '../catalog-pure';
import type {
  Bsc5Row,
  Cns5Row,
  CrossIndexRow,
  Tyc2HdRow,
} from '../classic-ids/classic-ids-parse';
import { lookupGliese, type GlieseIndex } from '../gliese-parse';
import type { Tycho2Row } from '../tycho2-parse';
import type { SpineRow } from './inherited-spine-pure';

/** The HD number above which AT-HYG's Tycho-2 → HD link took effect. Below it
 *  the spine carries an HD only where HYG supplied one — measured, not designed:
 *  see README.md § The primaries audit. */
export const ATHYG_HD_LINK_FLOOR = 100_000;

/** `cns5 = 0` is the Sun, a spine row by its proper name rather than a GJ. */
const CNS5_SUN = 0;

export interface WgsnKeys {
  names: ReadonlySet<string>;
  hd: ReadonlySet<number>;
  hip: ReadonlySet<number>;
}

/** The designations SIMBAD's `ident` table hangs on the object it holds under
 *  a Gaia DR3 source_id — the frozen sp_type pull's cross-ID columns. */
export interface SimbadXids {
  hip: number | null;
  tyc: string | null;
  gj: string | null;
}

export interface PrimaryTables {
  iv25: readonly Tyc2HdRow[];
  v50: readonly Bsc5Row[];
  iv27a: readonly CrossIndexRow[];
  cns5: readonly Cns5Row[];
  gliese: GlieseIndex;
  /** HIP numbers I/239 publishes a row for. */
  hipI239: ReadonlySet<number>;
  wgsn: WgsnKeys;
  tycho2: ReadonlyMap<string, Tycho2Row>;
  tycToSource: ReadonlyMap<string, string>;
  hipToSource: ReadonlyMap<number, string>;
  simbadBySourceId: ReadonlyMap<string, SimbadXids>;
}

interface PrimaryIndex {
  hdToTycs: Map<number, string[]>;
  tycToHds: Map<string, Tyc2HdRow[]>;
  hrSet: Set<number>;
  v50Hd: Set<number>;
  iv27aHd: Set<number>;
  iv27aHip: Set<number>;
  /** Exact `number+comp` keys, per-letter aliases and bare numbers, all through
   *  `normaliseGjKey` — the attestation question is "does CNS5 number this
   *  star", so the bare fold is admissible here where the value tiers refuse it. */
  cns5Keys: Set<string>;
  cns5ByKey: Map<string, Cns5Row>;
}

function indexPrimaries(t: PrimaryTables): PrimaryIndex {
  const hdToTycs = new Map<number, string[]>();
  const tycToHds = new Map<string, Tyc2HdRow[]>();
  for (const row of t.iv25) {
    const tycs = hdToTycs.get(row.hd) ?? [];
    tycs.push(row.tyc);
    hdToTycs.set(row.hd, tycs);
    const hds = tycToHds.get(row.tyc) ?? [];
    hds.push(row);
    tycToHds.set(row.tyc, hds);
  }
  const hrSet = new Set(t.v50.map((r) => r.hr));
  const v50Hd = new Set<number>();
  for (const r of t.v50) if (r.hd !== null) v50Hd.add(r.hd);
  const iv27aHd = new Set(t.iv27a.map((r) => r.hd));
  const iv27aHip = new Set<number>();
  for (const r of t.iv27a) if (r.hip !== null) iv27aHip.add(r.hip);
  const cns5Keys = new Set<string>();
  const cns5ByKey = new Map<string, Cns5Row>();
  for (const r of t.cns5) {
    const bare = normaliseGjKey(r.gj);
    if (bare === null) continue;
    const comp = (r.gjComp ?? '').trim().toUpperCase();
    const exact = `${bare}${comp}`;
    cns5Keys.add(exact);
    cns5Keys.add(bare);
    if (!cns5ByKey.has(exact)) cns5ByKey.set(exact, r);
    if (!cns5ByKey.has(bare)) cns5ByKey.set(bare, r);
    for (const letter of comp) {
      cns5Keys.add(`${bare}${letter}`);
      if (!cns5ByKey.has(`${bare}${letter}`)) cns5ByKey.set(`${bare}${letter}`, r);
    }
  }
  return { hdToTycs, tycToHds, hrSet, v50Hd, iv27aHd, iv27aHip, cns5Keys, cns5ByKey };
}

export type HdAttestation = 'iv25' | 'v50' | null;
export type GlAttestation = 'cns5' | 'v70a' | null;
export type BayerFlamAttestation = 'iv27a' | 'wgsn' | null;
export type ProperAttestation = 'wgsn' | 'sol' | null;

/** Which frozen primary attests each classical designation the row carries.
 *  `null` on a non-empty cell is a designation only AT-HYG asserts. */
export interface Attestation {
  hd: HdAttestation;
  hr: 'v50' | null;
  hip: 'i239' | null;
  gl: GlAttestation;
  bayerFlam: BayerFlamAttestation;
  proper: ProperAttestation;
  tyc: 'tycho2' | null;
}

export type ClassicalCell = 'hd' | 'hr' | 'hip' | 'gl' | 'bayerFlam' | 'proper';
export const CLASSICAL_CELLS: readonly ClassicalCell[] = [
  'hd', 'hr', 'hip', 'gl', 'bayerFlam', 'proper',
];

export interface RowAttestation {
  attestation: Attestation;
  /** Classical cells the row carries a value in. */
  carried: ClassicalCell[];
  /** Carried cells no primary attests. */
  unattested: ClassicalCell[];
  /** No carried classical cell is attested: the record exists on AT-HYG's
   *  authority alone. */
  residual: boolean;
}

function intCell(cell: string): number | null {
  return cell === '' ? null : Number.parseInt(cell, 10);
}

function attestGl(gl: string, idx: PrimaryIndex, gliese: GlieseIndex): GlAttestation {
  const key = normaliseGjKey(gl);
  if (key === null) return null;
  const bare = key.replace(/[A-Z]+$/, '');
  if (idx.cns5Keys.has(key) || idx.cns5Keys.has(bare)) return 'cns5';
  return lookupGliese(gliese, gl) !== null ? 'v70a' : null;
}

export function attestSpineRow(
  row: SpineRow,
  tables: PrimaryTables,
  idx: PrimaryIndex = indexPrimaries(tables),
): RowAttestation {
  const hd = intCell(row.hd);
  const hr = intCell(row.hr);
  const hip = intCell(row.hip);
  const attestation: Attestation = {
    hd: hd === null ? null : idx.hdToTycs.has(hd) ? 'iv25' : idx.v50Hd.has(hd) ? 'v50' : null,
    hr: hr === null ? null : idx.hrSet.has(hr) ? 'v50' : null,
    hip: hip === null ? null : tables.hipI239.has(hip) ? 'i239' : null,
    gl: row.gl === '' ? null : attestGl(row.gl, idx, tables.gliese),
    bayerFlam: row.bayer === '' && row.flam === ''
      ? null
      : (hd !== null && idx.iv27aHd.has(hd)) || (hip !== null && idx.iv27aHip.has(hip))
        ? 'iv27a'
        : (hd !== null && tables.wgsn.hd.has(hd)) || (hip !== null && tables.wgsn.hip.has(hip))
          ? 'wgsn'
          : null,
    proper: row.proper === ''
      ? null
      : row.proper === SOL_PROPER_NAME ? 'sol' : tables.wgsn.names.has(row.proper) ? 'wgsn' : null,
    tyc: row.tyc !== '' && tables.tycho2.has(row.tyc) ? 'tycho2' : null,
  };
  const carried: ClassicalCell[] = [];
  const unattested: ClassicalCell[] = [];
  const present: Record<ClassicalCell, boolean> = {
    hd: hd !== null, hr: hr !== null, hip: hip !== null, gl: row.gl !== '',
    bayerFlam: row.bayer !== '' || row.flam !== '', proper: row.proper !== '',
  };
  for (const cell of CLASSICAL_CELLS) {
    if (!present[cell]) continue;
    carried.push(cell);
    if (attestation[cell] === null) unattested.push(cell);
  }
  return {
    attestation,
    carried,
    unattested,
    residual: carried.length > 0 && unattested.length === carried.length,
  };
}

export type IdentityVerdict =
  | 'sol'
  | 'agree'
  | 'disagree'
  | 'unreachable'
  | 'no_spine_id_walk_binds'
  | 'no_spine_id_unreachable';

/** Whether SIMBAD's object for the spine's source_id carries one of the
 *  record's own designations. A GJ compares on its bare number: SIMBAD names
 *  a Gaia source by the system entry where the record names the component. */
export type SimbadCorroboration =
  | 'corroborates'
  | 'contradicts'
  | 'no_object'
  | 'no_crossid';

const SIMBAD_CORROBORATIONS: readonly SimbadCorroboration[] = [
  'corroborates', 'contradicts', 'no_object', 'no_crossid',
];

/** What the raw cross-walks say the row's source_id is, against the cell the
 *  spine froze. Raw means pre-gate: the binding gate is downstream of this. */
export interface IdentityCheck {
  spine: string | null;
  viaTyc: string | null;
  viaHip: string | null;
  viaCns5: string | null;
  verdict: IdentityVerdict;
  /** Routes whose answer equals the spine cell. */
  agreeing: Array<'tyc' | 'hip' | 'cns5'>;
  /** Set on `disagree` and `unreachable` only — the bindings no cross-walk
   *  reproduces, where SIMBAD's frozen cross-IDs are the remaining witness. */
  simbad: SimbadCorroboration | null;
  /** The row would carry no `hip` / `hd` / `hr` / `gl` designation, so its SID
   *  canonical key is the Gaia id itself. */
  gaiaKeyed: boolean;
}

function bareGj(cell: string | null): string | null {
  return normaliseGjKey(cell)?.replace(/[A-Z]+$/, '') ?? null;
}

function corroborate(row: SpineRow, xids: SimbadXids | undefined): SimbadCorroboration {
  if (xids === undefined) return 'no_object';
  const hip = intCell(row.hip);
  const gl = bareGj(row.gl === '' ? null : row.gl);
  const simbadGl = bareGj(xids.gj);
  const compared: boolean[] = [];
  if (row.tyc !== '' && xids.tyc !== null) compared.push(row.tyc === xids.tyc);
  if (hip !== null && xids.hip !== null) compared.push(hip === xids.hip);
  if (gl !== null && simbadGl !== null) compared.push(gl === simbadGl);
  if (compared.length === 0) return 'no_crossid';
  return compared.some(Boolean) ? 'corroborates' : 'contradicts';
}

export function checkIdentity(
  row: SpineRow,
  tables: PrimaryTables,
  idx: PrimaryIndex = indexPrimaries(tables),
): IdentityCheck {
  const spine = row.gaia_source_id === '' ? null : row.gaia_source_id;
  const hip = intCell(row.hip);
  const viaTyc = row.tyc === '' ? null : tables.tycToSource.get(row.tyc) ?? null;
  const viaHip = hip === null ? null : tables.hipToSource.get(hip) ?? null;
  const glKey = normaliseGjKey(row.gl === '' ? null : row.gl);
  const cns5Row = glKey === null
    ? undefined
    : idx.cns5ByKey.get(glKey) ?? idx.cns5ByKey.get(glKey.replace(/[A-Z]+$/, ''));
  const viaCns5 = cns5Row?.gaiaSourceId ?? null;
  const agreeing: IdentityCheck['agreeing'] = [];
  if (spine !== null) {
    if (viaTyc === spine) agreeing.push('tyc');
    if (viaHip === spine) agreeing.push('hip');
    if (viaCns5 === spine) agreeing.push('cns5');
  }
  const anyRoute = viaTyc !== null || viaHip !== null || viaCns5 !== null;
  let verdict: IdentityVerdict;
  if (row.proper === SOL_PROPER_NAME) verdict = 'sol';
  else if (spine === null) verdict = anyRoute ? 'no_spine_id_walk_binds' : 'no_spine_id_unreachable';
  else if (agreeing.length > 0) verdict = 'agree';
  else verdict = anyRoute ? 'disagree' : 'unreachable';
  const unreproduced = verdict === 'disagree' || verdict === 'unreachable';
  return {
    spine, viaTyc, viaHip, viaCns5, verdict, agreeing,
    simbad: unreproduced && spine !== null
      ? corroborate(row, tables.simbadBySourceId.get(spine))
      : null,
    gaiaKeyed: hip === null && row.hd === '' && row.hr === '' && row.gl === '',
  };
}

/** One Tycho-2 star IV/25 numbers that is no spine row — a record the
 *  primaries admit and AT-HYG's subset did not. */
export interface HdAddition {
  tyc: string;
  hds: number[];
  ambiguous: boolean;
  vtMag: number | null;
  inTycho2: boolean;
  gaiaSourceId: string | null;
}

export interface Additions {
  hd: HdAddition[];
  /** IV/25 rows whose TYC is already a spine row under another (or no) HD —
   *  a label event, not a record. */
  hdOnExistingRecord: number;
  /** I/239 HIPs no spine row carries. */
  hip: Array<{ hip: number; gaiaSourceId: string | null }>;
  /** CNS5 rows no spine `gl` cell reaches, split by whether the row's own HIP
   *  or source_id already names a spine record. */
  cns5: { newRecords: Cns5Row[]; onExistingRecord: number };
  /** IV/27A rows neither HD nor HIP of which is a spine cell. */
  iv27a: CrossIndexRow[];
  /** V/50 rows neither HR nor HD of which is a spine cell. */
  v50: Bsc5Row[];
}

export interface SpineKeys {
  tyc: ReadonlySet<string>;
  hd: ReadonlySet<number>;
  hr: ReadonlySet<number>;
  hip: ReadonlySet<number>;
  glKeys: ReadonlySet<string>;
  gaia: ReadonlySet<string>;
}

export function spineKeys(rows: Iterable<SpineRow>): SpineKeys {
  const tyc = new Set<string>();
  const hd = new Set<number>();
  const hr = new Set<number>();
  const hip = new Set<number>();
  const glKeys = new Set<string>();
  const gaia = new Set<string>();
  for (const row of rows) {
    if (row.tyc !== '') tyc.add(row.tyc);
    if (row.hd !== '') hd.add(Number.parseInt(row.hd, 10));
    if (row.hr !== '') hr.add(Number.parseInt(row.hr, 10));
    if (row.hip !== '') hip.add(Number.parseInt(row.hip, 10));
    const gl = normaliseGjKey(row.gl === '' ? null : row.gl);
    if (gl !== null) {
      glKeys.add(gl);
      glKeys.add(gl.replace(/[A-Z]+$/, ''));
    }
    if (row.gaia_source_id !== '') gaia.add(row.gaia_source_id);
  }
  return { tyc, hd, hr, hip, glKeys, gaia };
}

export function findAdditions(
  tables: PrimaryTables,
  spine: SpineKeys,
  idx: PrimaryIndex = indexPrimaries(tables),
): Additions {
  const hd: HdAddition[] = [];
  let hdOnExistingRecord = 0;
  for (const [tyc, rows] of idx.tycToHds) {
    if (spine.tyc.has(tyc)) {
      if (rows.some((r) => !spine.hd.has(r.hd))) hdOnExistingRecord++;
      continue;
    }
    const t2 = tables.tycho2.get(tyc);
    hd.push({
      tyc,
      hds: rows.map((r) => r.hd),
      ambiguous: rows.some((r) => r.nHd > 1 || r.nTyc > 1),
      vtMag: t2?.vtMag ?? null,
      inTycho2: t2 !== undefined,
      gaiaSourceId: tables.tycToSource.get(tyc) ?? null,
    });
  }
  hd.sort((a, b) => Math.min(...a.hds) - Math.min(...b.hds));

  const hip: Additions['hip'] = [];
  for (const h of [...tables.hipI239].sort((a, b) => a - b)) {
    if (!spine.hip.has(h)) hip.push({ hip: h, gaiaSourceId: tables.hipToSource.get(h) ?? null });
  }

  const newRecords: Cns5Row[] = [];
  let onExistingRecord = 0;
  for (const r of tables.cns5) {
    if (r.cns5 === CNS5_SUN) continue;
    const bare = normaliseGjKey(r.gj);
    if (bare === null) continue;
    const comp = (r.gjComp ?? '').trim().toUpperCase();
    const reached = spine.glKeys.has(bare)
      || spine.glKeys.has(`${bare}${comp}`)
      || [...comp].some((letter) => spine.glKeys.has(`${bare}${letter}`));
    if (reached) continue;
    const onRecord = (r.hip !== null && spine.hip.has(r.hip))
      || (r.gaiaSourceId !== null && spine.gaia.has(r.gaiaSourceId));
    if (onRecord) onExistingRecord++;
    else newRecords.push(r);
  }

  const iv27a = tables.iv27a.filter(
    (r) => !spine.hd.has(r.hd) && (r.hip === null || !spine.hip.has(r.hip)),
  );
  const v50 = tables.v50.filter(
    (r) => !spine.hr.has(r.hr) && (r.hd === null || !spine.hd.has(r.hd)),
  );
  return { hd, hdOnExistingRecord, hip, cns5: { newRecords, onExistingRecord }, iv27a, v50 };
}

export interface AuditSummary {
  rows: number;
  residual: number;
  partiallyUnattested: number;
  unattestedByCell: Record<ClassicalCell, number>;
  attestedBy: Record<string, number>;
  tycInTycho2: number;
  identity: Record<IdentityVerdict, number>;
  identityAgreeingRoutes: Record<string, number>;
  /** The `disagree` + `unreachable` rows: bindings only AT-HYG asserts. */
  unreproduced: {
    total: number;
    simbad: Record<SimbadCorroboration, number>;
    gaiaKeyed: number;
  };
  additions: {
    hdRecords: number;
    hdOnExistingRecord: number;
    hdBelowLinkFloor: number;
    hdAmbiguous: number;
    hdInTycho2: number;
    hdWithGaia: number;
    hdVtHistogram: Record<string, number>;
    hip: number;
    hipWithGaia: number;
    cns5Records: number;
    cns5OnExistingRecord: number;
    cns5WithGaia: number;
    iv27a: number;
    v50: number;
    v50HdLess: number;
  };
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export interface AuditResult {
  summary: AuditSummary;
  residualRows: Array<{ row: SpineRow; unattested: ClassicalCell[] }>;
  partialRows: Array<{ row: SpineRow; unattested: ClassicalCell[] }>;
  /** Every `disagree` and `unreachable` row, with its SIMBAD witness. */
  unreproduced: Array<{ row: SpineRow; check: IdentityCheck }>;
  additions: Additions;
}

export function auditSpine(rows: readonly SpineRow[], tables: PrimaryTables): AuditResult {
  const idx = indexPrimaries(tables);
  const unattestedByCell = Object.fromEntries(
    CLASSICAL_CELLS.map((c) => [c, 0]),
  ) as Record<ClassicalCell, number>;
  const attestedBy: Record<string, number> = {};
  const identity = {
    sol: 0, agree: 0, disagree: 0, unreachable: 0,
    no_spine_id_walk_binds: 0, no_spine_id_unreachable: 0,
  } satisfies Record<IdentityVerdict, number>;
  const identityAgreeingRoutes: Record<string, number> = {};
  const residualRows: AuditResult['residualRows'] = [];
  const partialRows: AuditResult['partialRows'] = [];
  const unreproduced: AuditResult['unreproduced'] = [];
  const simbad = Object.fromEntries(
    SIMBAD_CORROBORATIONS.map((c) => [c, 0]),
  ) as Record<SimbadCorroboration, number>;
  let gaiaKeyed = 0;
  let tycInTycho2 = 0;

  for (const row of rows) {
    const a = attestSpineRow(row, tables, idx);
    for (const cell of a.unattested) unattestedByCell[cell]++;
    for (const cell of CLASSICAL_CELLS) {
      const by = a.attestation[cell];
      if (by !== null) bump(attestedBy, `${cell}:${by}`);
    }
    if (a.attestation.tyc !== null) tycInTycho2++;
    if (a.residual) residualRows.push({ row, unattested: a.unattested });
    else if (a.unattested.length > 0) partialRows.push({ row, unattested: a.unattested });

    const c = checkIdentity(row, tables, idx);
    identity[c.verdict]++;
    if (c.verdict === 'agree') bump(identityAgreeingRoutes, c.agreeing.join('+'));
    if (c.simbad !== null) {
      unreproduced.push({ row, check: c });
      simbad[c.simbad]++;
      if (c.gaiaKeyed) gaiaKeyed++;
    }
  }

  const additions = findAdditions(tables, spineKeys(rows), idx);
  const hdVtHistogram: Record<string, number> = {};
  for (const a of additions.hd) {
    bump(hdVtHistogram, a.vtMag === null ? 'none' : String(Math.floor(a.vtMag)));
  }
  const summary: AuditSummary = {
    rows: rows.length,
    residual: residualRows.length,
    partiallyUnattested: partialRows.length,
    unattestedByCell,
    attestedBy,
    tycInTycho2,
    identity,
    identityAgreeingRoutes,
    unreproduced: { total: unreproduced.length, simbad, gaiaKeyed },
    additions: {
      hdRecords: additions.hd.length,
      hdOnExistingRecord: additions.hdOnExistingRecord,
      hdBelowLinkFloor: additions.hd.filter((a) => Math.min(...a.hds) < ATHYG_HD_LINK_FLOOR).length,
      hdAmbiguous: additions.hd.filter((a) => a.ambiguous).length,
      hdInTycho2: additions.hd.filter((a) => a.inTycho2).length,
      hdWithGaia: additions.hd.filter((a) => a.gaiaSourceId !== null).length,
      hdVtHistogram,
      hip: additions.hip.length,
      hipWithGaia: additions.hip.filter((h) => h.gaiaSourceId !== null).length,
      cns5Records: additions.cns5.newRecords.length,
      cns5OnExistingRecord: additions.cns5.onExistingRecord,
      cns5WithGaia: additions.cns5.newRecords.filter((r) => r.gaiaSourceId !== null).length,
      iv27a: additions.iv27a.length,
      v50: additions.v50.length,
      v50HdLess: additions.v50.filter((r) => r.hd === null).length,
    },
  };
  return { summary, residualRows, partialRows, unreproduced, additions };
}

function sortedEntries(counts: Record<string, number>): Array<[string, number]> {
  return Object.entries(counts).sort(([a], [b]) => {
    const na = Number(a);
    const nb = Number(b);
    return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a < b ? -1 : 1;
  });
}

export function formatAuditReport(s: AuditSummary): string {
  const lines: string[] = [];
  lines.push(`spine rows: ${s.rows}`);
  lines.push(`  residual (no classical cell attested by any primary): ${s.residual}`);
  lines.push(`  rows with some unattested cell: ${s.partiallyUnattested}`);
  lines.push('  unattested cells, per identifier:');
  for (const cell of CLASSICAL_CELLS) lines.push(`    ${cell}: ${s.unattestedByCell[cell]}`);
  lines.push('  attested by:');
  for (const [k, v] of sortedEntries(s.attestedBy)) lines.push(`    ${k}: ${v}`);
  lines.push(`  tyc in Tycho-2 pull: ${s.tycInTycho2}`);
  lines.push('identity (spine gaia_source_id vs raw cross-walks):');
  for (const [k, v] of Object.entries(s.identity)) lines.push(`  ${k}: ${v}`);
  lines.push('  agreeing routes:');
  for (const [k, v] of sortedEntries(s.identityAgreeingRoutes)) lines.push(`    ${k}: ${v}`);
  const u = s.unreproduced;
  lines.push(`  bindings only AT-HYG asserts (disagree + unreachable): ${u.total}`);
  lines.push(`    SIMBAD's object for that id carries the record's own TYC/HIP/GJ: ${u.simbad.corroborates}`);
  lines.push(`    SIMBAD's object carries a different TYC/HIP/GJ: ${u.simbad.contradicts}`);
  lines.push(`    SIMBAD holds no object under that id: ${u.simbad.no_object}`);
  lines.push(`    SIMBAD's object carries no TYC/HIP/GJ to compare: ${u.simbad.no_crossid}`);
  lines.push(`    rows whose SID key is the Gaia id itself (no hip/hd/hr/gl): ${u.gaiaKeyed}`);
  const a = s.additions;
  lines.push('additions the primaries admit that the spine lacks:');
  lines.push(`  IV/25 HD stars (by TYC): ${a.hdRecords}  ` +
    `(HD < ${ATHYG_HD_LINK_FLOOR}: ${a.hdBelowLinkFloor}, ambiguous-flagged: ${a.hdAmbiguous}, ` +
    `in Tycho-2: ${a.hdInTycho2}, DR3 best-neighbour: ${a.hdWithGaia})`);
  lines.push(`    HD numbers landing on an existing spine record: ${a.hdOnExistingRecord}`);
  lines.push('    VT histogram:');
  for (const [k, v] of sortedEntries(a.hdVtHistogram)) lines.push(`      ${k}: ${v}`);
  lines.push(`  I/239 HIPs: ${a.hip} (DR3 best-neighbour: ${a.hipWithGaia})`);
  lines.push(`  CNS5 GJ rows: ${a.cns5Records} new records (DR3 id: ${a.cns5WithGaia}); ` +
    `${a.cns5OnExistingRecord} land on an existing record`);
  lines.push(`  IV/27A Bayer/Flamsteed rows: ${a.iv27a}`);
  lines.push(`  V/50 HR rows: ${a.v50} (HD-less: ${a.v50HdLess})`);
  return lines.join('\n');
}
