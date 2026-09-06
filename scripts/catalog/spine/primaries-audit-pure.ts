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
import { parseIntOrNull } from '../parse/corpus-tsv';
import type { Tycho2Row } from '../tycho2-parse';
import type { SpineRow } from './inherited-spine-pure';

/** The HD number above which AT-HYG's Tycho-2 → HD link took effect. Below it
 *  the spine carries an HD only where HYG supplied one — measured, not designed:
 *  see README.md § The primaries audit. */
export const ATHYG_HD_LINK_FLOOR = 100_000;

/** `cns5 = 0` is the Sun, a spine row by its proper name rather than a GJ. */
const CNS5_SUN = 0;

/** Strip an already-normalised Gliese key to its bare catalogue number.
 *
 *  Not `glieseNumber` (`../classic-ids/classic-id-overlay-pure.ts`), which
 *  reads a raw designation and answers `null` for the V/70A supplement's own
 *  `NN 3001` / `Wo 9722` spellings. Attestation has to reach those rows, so the
 *  fold runs over `normaliseGjKey`'s output instead. */
export function bareGjKey(key: string): string {
  return key.replace(/[A-Z]+$/, '');
}

export interface WgsnKeys {
  names: ReadonlySet<string>;
  hd: ReadonlySet<number>;
  hip: ReadonlySet<number>;
  /** Flamsteed numbers WGSN publishes, by the star's own HD / HIP. */
  flamByHd: ReadonlyMap<number, ReadonlySet<number>>;
  flamByHip: ReadonlyMap<number, ReadonlySet<number>>;
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
  /** HIP numbers carrying a van Leeuwen HIP2 re-reduction solution. */
  hip2: ReadonlySet<number>;
  wgsn: WgsnKeys;
  tycho2: ReadonlyMap<string, Tycho2Row>;
  tycToSource: ReadonlyMap<string, string>;
  hipToSource: ReadonlyMap<number, string>;
  simbadBySourceId: ReadonlyMap<string, SimbadXids>;
}

export interface PrimaryIndex {
  hdToTycs: Map<number, string[]>;
  tycToHds: Map<string, Tyc2HdRow[]>;
  hrSet: Set<number>;
  v50Hd: Set<number>;
  iv27aHd: Set<number>;
  iv27aHip: Set<number>;
  iv27aFlamByHd: Map<number, Set<number>>;
  iv27aFlamByHip: Map<number, Set<number>>;
  /** Exact `number+comp` keys, per-letter aliases and bare numbers, all through
   *  `normaliseGjKey` — the attestation question is "does CNS5 number this
   *  star", so the bare fold is admissible here where the value tiers refuse it. */
  cns5Keys: Set<string>;
  cns5ByKey: Map<string, Cns5Row>;
}

/** Insert into a map of key → set, creating the set on first write. */
export function addKeyed(by: Map<number, Set<number>>, key: number, value: number): void {
  const set = by.get(key) ?? new Set<number>();
  set.add(value);
  by.set(key, set);
}

export function indexPrimaries(t: PrimaryTables): PrimaryIndex {
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
  const iv27aFlamByHd = new Map<number, Set<number>>();
  const iv27aFlamByHip = new Map<number, Set<number>>();
  for (const r of t.iv27a) {
    if (r.hip !== null) iv27aHip.add(r.hip);
    if (r.flamsteed === null) continue;
    addKeyed(iv27aFlamByHd, r.hd, r.flamsteed);
    if (r.hip !== null) addKeyed(iv27aFlamByHip, r.hip, r.flamsteed);
  }
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
  return {
    hdToTycs, tycToHds, hrSet, v50Hd, iv27aHd, iv27aHip,
    iv27aFlamByHd, iv27aFlamByHip, cns5Keys, cns5ByKey,
  };
}

export type HdAttestation = 'iv25' | 'v50' | null;
export type GlAttestation = 'cns5' | 'v70a' | null;

/** IV/27A or WGSN publishes a Bayer designation for this star. The letter
 *  itself is not compared: HYG's `Alp-1` and IV/27A's `alf01` meet only through
 *  the naming ladder's normalisers, which are `../naming/`'s to own. `flam` is
 *  compared by value — README.md § The primaries audit states the asymmetry. */
export type BayerAttestation = 'iv27a' | 'wgsn' | null;
export type FlamAttestation = 'iv27a' | 'wgsn' | null;
export type ProperAttestation = 'wgsn' | 'sol' | null;

/** Which frozen primary attests each classical designation the row carries.
 *  `null` on a non-empty cell is a designation only AT-HYG asserts. */
export interface Attestation {
  hd: HdAttestation;
  hr: 'v50' | null;
  hip: 'i239' | null;
  gl: GlAttestation;
  bayer: BayerAttestation;
  flam: FlamAttestation;
  proper: ProperAttestation;
  tyc: 'tycho2' | null;
}

export type ClassicalCell = 'hd' | 'hr' | 'hip' | 'gl' | 'bayer' | 'flam' | 'proper';
export const CLASSICAL_CELLS: readonly ClassicalCell[] = [
  'hd', 'hr', 'hip', 'gl', 'bayer', 'flam', 'proper',
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

function attestGl(gl: string, idx: PrimaryIndex, gliese: GlieseIndex): GlAttestation {
  const key = normaliseGjKey(gl);
  if (key === null) return null;
  if (idx.cns5Keys.has(key) || idx.cns5Keys.has(bareGjKey(key))) return 'cns5';
  return lookupGliese(gliese, gl) !== null ? 'v70a' : null;
}

function attestBayer(
  hd: number | null, hip: number | null, idx: PrimaryIndex, wgsn: WgsnKeys,
): BayerAttestation {
  if ((hd !== null && idx.iv27aHd.has(hd)) || (hip !== null && idx.iv27aHip.has(hip))) return 'iv27a';
  if ((hd !== null && wgsn.hd.has(hd)) || (hip !== null && wgsn.hip.has(hip))) return 'wgsn';
  return null;
}

function publishesFlam(
  by: ReadonlyMap<number, ReadonlySet<number>>, key: number | null, flam: number,
): boolean {
  return key !== null && (by.get(key)?.has(flam) ?? false);
}

function attestFlam(
  flam: number, hd: number | null, hip: number | null,
  idx: PrimaryIndex, wgsn: WgsnKeys,
): FlamAttestation {
  if (publishesFlam(idx.iv27aFlamByHd, hd, flam)
    || publishesFlam(idx.iv27aFlamByHip, hip, flam)) return 'iv27a';
  if (publishesFlam(wgsn.flamByHd, hd, flam)
    || publishesFlam(wgsn.flamByHip, hip, flam)) return 'wgsn';
  return null;
}

/** The identifier cells attestation reads — a spine row's, or a membership
 *  manifest row's, which carries the same columns. */
export type IdentifierCells = Pick<
  SpineRow, 'tyc' | 'hip' | 'hd' | 'hr' | 'gl' | 'flam' | 'bayer' | 'proper'
>;

export function attestSpineRow(
  row: IdentifierCells,
  tables: PrimaryTables,
  idx: PrimaryIndex,
): RowAttestation {
  const hd = parseIntOrNull(row.hd);
  const hr = parseIntOrNull(row.hr);
  const hip = parseIntOrNull(row.hip);
  const flam = parseIntOrNull(row.flam);
  const attestation: Attestation = {
    hd: hd === null ? null : idx.hdToTycs.has(hd) ? 'iv25' : idx.v50Hd.has(hd) ? 'v50' : null,
    hr: hr === null ? null : idx.hrSet.has(hr) ? 'v50' : null,
    hip: hip === null ? null : tables.hipI239.has(hip) ? 'i239' : null,
    gl: row.gl === '' ? null : attestGl(row.gl, idx, tables.gliese),
    bayer: row.bayer === '' ? null : attestBayer(hd, hip, idx, tables.wgsn),
    flam: flam === null ? null : attestFlam(flam, hd, hip, idx, tables.wgsn),
    proper: row.proper === ''
      ? null
      : row.proper === SOL_PROPER_NAME ? 'sol' : tables.wgsn.names.has(row.proper) ? 'wgsn' : null,
    tyc: row.tyc !== '' && tables.tycho2.has(row.tyc) ? 'tycho2' : null,
  };
  const carried: ClassicalCell[] = [];
  const unattested: ClassicalCell[] = [];
  const present: Record<ClassicalCell, boolean> = {
    hd: hd !== null, hr: hr !== null, hip: hip !== null, gl: row.gl !== '',
    bayer: row.bayer !== '', flam: flam !== null, proper: row.proper !== '',
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
  const key = normaliseGjKey(cell);
  return key === null ? null : bareGjKey(key);
}

function corroborate(row: SpineRow, xids: SimbadXids | undefined): SimbadCorroboration {
  if (xids === undefined) return 'no_object';
  const hip = parseIntOrNull(row.hip);
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
  idx: PrimaryIndex,
): IdentityCheck {
  const spine = row.gaia_source_id === '' ? null : row.gaia_source_id;
  const hip = parseIntOrNull(row.hip);
  const viaTyc = row.tyc === '' ? null : tables.tycToSource.get(row.tyc) ?? null;
  const viaHip = hip === null ? null : tables.hipToSource.get(hip) ?? null;
  const glKey = normaliseGjKey(row.gl === '' ? null : row.gl);
  const cns5Row = glKey === null
    ? undefined
    : idx.cns5ByKey.get(glKey) ?? idx.cns5ByKey.get(bareGjKey(glKey));
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
  /** Lowest HD on the TYC — the number the link-floor band and the sort key
   *  both read, since a TYC carrying several is admitted once. */
  lowestHd: number;
  ambiguous: boolean;
  vtMag: number | null;
  inTycho2: boolean;
  gaiaSourceId: string | null;
}

/** An IV/25 identification whose TYC is already a spine row but whose HD is not
 *  a spine cell — a label event, not a record. */
export interface HdLabelAddition {
  tyc: string;
  hds: number[];
}

export interface HipAddition {
  hip: number;
  gaiaSourceId: string | null;
  inHip2: boolean;
  inTycho2: boolean;
}

/** How much of IV/25 the spine already carries, either side of the link floor.
 *  The gap below it is the AT-HYG defect § 3.1 of docs/catalog-driver.md
 *  reports; measured over distinct HD numbers, not IV/25 rows. */
export interface Iv25Coverage {
  belowFloor: { iv25: number; onSpine: number };
  atOrAboveFloor: { iv25: number; onSpine: number };
}

export interface Additions {
  hd: HdAddition[];
  hdOnExistingRecord: HdLabelAddition[];
  /** I/239 HIPs no spine row carries. */
  hip: HipAddition[];
  /** CNS5 rows no spine `gl` cell reaches, split by whether the row's own HIP
   *  or source_id already names a spine record. */
  cns5: { newRecords: Cns5Row[]; onExistingRecord: Cns5Row[] };
  /** IV/27A rows neither HD nor HIP of which is a spine cell. */
  iv27a: CrossIndexRow[];
  /** V/50 rows neither HR nor HD of which is a spine cell. */
  v50: Bsc5Row[];
  iv25Coverage: Iv25Coverage;
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
    const hdCell = parseIntOrNull(row.hd);
    const hrCell = parseIntOrNull(row.hr);
    const hipCell = parseIntOrNull(row.hip);
    if (hdCell !== null) hd.add(hdCell);
    if (hrCell !== null) hr.add(hrCell);
    if (hipCell !== null) hip.add(hipCell);
    const gl = normaliseGjKey(row.gl === '' ? null : row.gl);
    if (gl !== null) {
      glKeys.add(gl);
      glKeys.add(bareGjKey(gl));
    }
    if (row.gaia_source_id !== '') gaia.add(row.gaia_source_id);
  }
  return { tyc, hd, hr, hip, glKeys, gaia };
}

function iv25Coverage(idx: PrimaryIndex, spine: SpineKeys): Iv25Coverage {
  const coverage: Iv25Coverage = {
    belowFloor: { iv25: 0, onSpine: 0 },
    atOrAboveFloor: { iv25: 0, onSpine: 0 },
  };
  for (const hd of idx.hdToTycs.keys()) {
    const band = hd < ATHYG_HD_LINK_FLOOR ? coverage.belowFloor : coverage.atOrAboveFloor;
    band.iv25++;
    if (spine.hd.has(hd)) band.onSpine++;
  }
  return coverage;
}

export function findAdditions(
  tables: PrimaryTables,
  spine: SpineKeys,
  idx: PrimaryIndex,
): Additions {
  const hd: HdAddition[] = [];
  const hdOnExistingRecord: HdLabelAddition[] = [];
  for (const [tyc, rows] of idx.tycToHds) {
    const hds = rows.map((r) => r.hd);
    if (spine.tyc.has(tyc)) {
      const unknown = hds.filter((h) => !spine.hd.has(h));
      if (unknown.length > 0) hdOnExistingRecord.push({ tyc, hds: unknown });
      continue;
    }
    const t2 = tables.tycho2.get(tyc);
    hd.push({
      tyc,
      hds,
      lowestHd: Math.min(...hds),
      ambiguous: rows.some((r) => r.nHd > 1 || r.nTyc > 1),
      vtMag: t2?.vtMag ?? null,
      inTycho2: t2 !== undefined,
      gaiaSourceId: tables.tycToSource.get(tyc) ?? null,
    });
  }
  hd.sort((a, b) => a.lowestHd - b.lowestHd);

  const hip: HipAddition[] = [];
  const tycho2Hips = new Set<number>();
  for (const row of tables.tycho2.values()) if (row.hip !== null) tycho2Hips.add(row.hip);
  for (const h of [...tables.hipI239].sort((a, b) => a - b)) {
    if (spine.hip.has(h)) continue;
    hip.push({
      hip: h,
      gaiaSourceId: tables.hipToSource.get(h) ?? null,
      inHip2: tables.hip2.has(h),
      inTycho2: tycho2Hips.has(h),
    });
  }

  const newRecords: Cns5Row[] = [];
  const onExistingRecord: Cns5Row[] = [];
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
    if (onRecord) onExistingRecord.push(r);
    else newRecords.push(r);
  }

  const iv27a = tables.iv27a.filter(
    (r) => !spine.hd.has(r.hd) && (r.hip === null || !spine.hip.has(r.hip)),
  );
  const v50 = tables.v50.filter(
    (r) => !spine.hr.has(r.hr) && (r.hd === null || !spine.hd.has(r.hd)),
  );
  return {
    hd, hdOnExistingRecord, hip,
    cns5: { newRecords, onExistingRecord },
    iv27a, v50,
    iv25Coverage: iv25Coverage(idx, spine),
  };
}

/** AT-HYG's own HD cells, split by whether the row descends from HYG and by
 *  HD-number width. AT-HYG takes HD "from HYG if known, otherwise Tycho-2"
 *  through IV/25, and the `hyg` id is the only per-row trace of which branch
 *  ran — so a row whose HYG entry simply carried no HD counts as HYG-sourced
 *  here. The split is a proxy for AT-HYG's provenance, not its own record of
 *  it: docs/catalog-driver.md § 3.1 states what it does and does not license. */
export interface AthygHdProvenance {
  hygSixDigit: number;
  hygShorter: number;
  tycSixDigit: number;
  tycShorter: number;
}

const HD_SIX_DIGITS = 6;

export function tallyAthygHdProvenance(
  rows: Iterable<{ hd: string; hyg: string }>,
): AthygHdProvenance {
  const tally: AthygHdProvenance = {
    hygSixDigit: 0, hygShorter: 0, tycSixDigit: 0, tycShorter: 0,
  };
  for (const row of rows) {
    const hd = row.hd.trim();
    if (hd === '') continue;
    const fromHyg = row.hyg.trim() !== '';
    const six = hd.length >= HD_SIX_DIGITS;
    if (fromHyg) six ? tally.hygSixDigit++ : tally.hygShorter++;
    else six ? tally.tycSixDigit++ : tally.tycShorter++;
  }
  return tally;
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
  athygHdProvenance: AthygHdProvenance;
  additions: {
    hdRecords: number;
    hdOnExistingRecordTycs: number;
    hdOnExistingRecordHds: number;
    hdBelowLinkFloor: number;
    hdAmbiguous: number;
    hdInTycho2: number;
    hdWithGaia: number;
    hdVtHistogram: Record<string, number>;
    iv25Coverage: Iv25Coverage;
    hip: number;
    hipWithGaia: number;
    hipWithHip2: number;
    hipInTycho2: number;
    cns5Records: number;
    cns5OnExistingRecord: number;
    cns5WithGaia: number;
    cns5WithHip: number;
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

/** Called once per spine row so a caller can stream the per-row attestation
 *  out rather than have the audit hold one object per row. */
export type RowSink = (
  row: SpineRow, attestation: RowAttestation, identity: IdentityCheck,
) => void;

export function auditSpine(
  rows: readonly SpineRow[],
  tables: PrimaryTables,
  athygHdProvenance: AthygHdProvenance,
  onRow?: RowSink,
): AuditResult {
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
    onRow?.(row, a, c);
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
    athygHdProvenance,
    additions: {
      hdRecords: additions.hd.length,
      hdOnExistingRecordTycs: additions.hdOnExistingRecord.length,
      hdOnExistingRecordHds: additions.hdOnExistingRecord
        .reduce((n, a) => n + a.hds.length, 0),
      hdBelowLinkFloor: additions.hd.filter((a) => a.lowestHd < ATHYG_HD_LINK_FLOOR).length,
      hdAmbiguous: additions.hd.filter((a) => a.ambiguous).length,
      hdInTycho2: additions.hd.filter((a) => a.inTycho2).length,
      hdWithGaia: additions.hd.filter((a) => a.gaiaSourceId !== null).length,
      hdVtHistogram,
      iv25Coverage: additions.iv25Coverage,
      hip: additions.hip.length,
      hipWithGaia: additions.hip.filter((h) => h.gaiaSourceId !== null).length,
      hipWithHip2: additions.hip.filter((h) => h.inHip2).length,
      hipInTycho2: additions.hip.filter((h) => h.inTycho2).length,
      cns5Records: additions.cns5.newRecords.length,
      cns5OnExistingRecord: additions.cns5.onExistingRecord.length,
      cns5WithGaia: additions.cns5.newRecords.filter((r) => r.gaiaSourceId !== null).length,
      cns5WithHip: additions.cns5.newRecords.filter((r) => r.hip !== null).length,
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

function percent(part: number, whole: number): string {
  return whole === 0 ? 'n/a' : `${((100 * part) / whole).toFixed(1)}%`;
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
  const p = s.athygHdProvenance;
  lines.push("AT-HYG's own HD cells, by row ancestry and HD width:");
  lines.push(`  HYG-sourced rows: ${p.hygSixDigit} six-digit, ${p.hygShorter} shorter`);
  lines.push(`  Tycho-2-sourced rows: ${p.tycSixDigit} six-digit, ${p.tycShorter} shorter`);
  const a = s.additions;
  const cov = a.iv25Coverage;
  lines.push('  spine coverage of IV/25 HD numbers:');
  lines.push(`    below HD ${ATHYG_HD_LINK_FLOOR}: ${cov.belowFloor.onSpine} of ` +
    `${cov.belowFloor.iv25} (${percent(cov.belowFloor.onSpine, cov.belowFloor.iv25)})`);
  lines.push(`    at or above: ${cov.atOrAboveFloor.onSpine} of ` +
    `${cov.atOrAboveFloor.iv25} (${percent(cov.atOrAboveFloor.onSpine, cov.atOrAboveFloor.iv25)})`);
  lines.push('additions the primaries admit that the spine lacks:');
  lines.push(`  IV/25 HD stars (by TYC): ${a.hdRecords}  ` +
    `(HD < ${ATHYG_HD_LINK_FLOOR}: ${a.hdBelowLinkFloor}, ambiguous-flagged: ${a.hdAmbiguous}, ` +
    `in Tycho-2: ${a.hdInTycho2}, DR3 best-neighbour: ${a.hdWithGaia})`);
  lines.push(`    HD numbers landing on an existing spine record: ${a.hdOnExistingRecordHds} ` +
    `on ${a.hdOnExistingRecordTycs} TYCs`);
  lines.push('    VT histogram:');
  for (const [k, v] of sortedEntries(a.hdVtHistogram)) lines.push(`      ${k}: ${v}`);
  lines.push(`  I/239 HIPs: ${a.hip} (HIP2 solution: ${a.hipWithHip2}, ` +
    `DR3 best-neighbour: ${a.hipWithGaia}, in Tycho-2: ${a.hipInTycho2})`);
  lines.push(`  CNS5 GJ rows: ${a.cns5Records} new records ` +
    `(DR3 id: ${a.cns5WithGaia}, HIP: ${a.cns5WithHip}); ` +
    `${a.cns5OnExistingRecord} land on an existing record`);
  lines.push(`  IV/27A Bayer/Flamsteed rows: ${a.iv27a}`);
  lines.push(`  V/50 HR rows: ${a.v50} (HD-less: ${a.v50HdLess})`);
  return lines.join('\n');
}
