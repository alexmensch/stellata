// The SIMBAD identifier pull: the designation classes the label cells read, with each object's catalogue keys. See README.md.

import { ascending, compareCodeUnits } from '../../../src/astro-core/order-pure';
import { IDENTS_COLUMN, IDENTS_SEPARATOR } from '../../catalog/simbad/simbad-idents-parse';
import type { DeclaredOutputs } from '../../util/emit-artifacts';
import type { Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import type { Column, Row } from '../pull/columns-pure';
import type { Ask, Phase, PhasedPull, WrittenTable } from '../pull/pull';
import { SIMBAD } from '../pull/tap-pure';
import { fetchBasic, fetchIdentSets, identPhase, oidOf, parseLedger, simbadPhases, type BasicCells } from '../simbad/simbad-fetch-pure';
import { GAIA_DR3, GJ, HD, HIP, MAIN_ID, OID, type Namespace } from '../simbad/simbad-specs-pure';

/** An ident class: SIMBAD's prefix, with its trailing space. */
const designationClass = (prefix: string): Namespace => ({ prefix, name: prefix.trim(), numeric: false });

/** Asked over the whole of SIMBAD: README.md#the-classes. */
export const WHOLE_SKY_CLASSES = ['* ', '** ', 'Gmb ', 'NAME ', 'LAL ', 'Ross ', 'Wolf '].map(designationClass);
/** Asked only on the objects simbad_sptype.tsv resolved a manifest record to: README.md#the-classes. */
export const REACHED_CLASSES = ['V* ', 'X '].map(designationClass);
/** The keys a record joins an object on. */
export const KEY_NAMESPACES = [HIP, HD, GJ, GAIA_DR3] as const;

/** The most rows the whole-sky classes may return: 153,260 at the 2026-11-18 count. */
export const WHOLE_SKY_MAX_ROWS = 200_000;

const CORE = simbadPhases({ basic: [OID, MAIN_ID], idents: KEY_NAMESPACES });

export const IDENTS_PHASES = {
  wholeSky: {
    from: 'ident',
    where: WHOLE_SKY_CLASSES.map((c) => `id LIKE '${c.prefix}%'`).join(' OR '),
    columns: [{ name: 'oidref' }, { name: 'id' }],
    scope: { kind: 'whole-table', maxRows: WHOLE_SKY_MAX_ROWS },
  },
  reached: identPhase(REACHED_CLASSES),
  keys: CORE.idents,
  basic: CORE.basic,
} as const satisfies Record<string, Phase>;

const [FIRST_COLUMN, ...OTHER_COLUMNS] = Object.values(IDENTS_COLUMN);
const IDENTS_COLUMNS: readonly [Column, ...Column[]] = [{ name: FIRST_COLUMN }, ...OTHER_COLUMNS.map((name) => ({ name }))];

/** An id with SIMBAD's space padding collapsed: `*  39 Psc` is written `* 39 Psc`. */
export const collapseSpaces = (id: string): string => id.replace(/\s+/g, ' ').trim();

/** Each oid's ids among `classes`, spaces collapsed. */
export function identsByOid(rows: readonly Row[], classes: readonly Namespace[]): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const [oidCell, idCell] of rows) {
    const id = collapseSpaces(idCell ?? '');
    if (!classes.some((c) => id.startsWith(c.prefix))) continue;
    const oid = oidOf(oidCell);
    let held = out.get(oid);
    if (held === undefined) out.set(oid, held = new Set());
    held.add(id);
  }
  return out;
}

function mergeInto(into: Map<number, Set<string>>, from: ReadonlyMap<number, ReadonlySet<string>>): void {
  for (const [oid, ids] of from) {
    const held = into.get(oid);
    if (held === undefined) into.set(oid, new Set(ids));
    else for (const id of ids) held.add(id);
  }
}

const numericOrder = (a: string, b: string): number => ascending(BigInt(a), BigInt(b));

/** One row per object holding an id of a pulled class: README.md#the-table. */
export function identsRows(
  idents: ReadonlyMap<number, ReadonlySet<string>>,
  keys: ReadonlyMap<number, ReadonlyMap<string, ReadonlySet<string>>>,
  basic: ReadonlyMap<number, BasicCells>,
): Row[] {
  return [...idents.keys()].sort(ascending).map((oid) => {
    const keyCell = (ns: Namespace): string | null => {
      const values = [...(keys.get(oid)?.get(ns.name) ?? [])].sort(ns.numeric ? numericOrder : compareCodeUnits);
      return values.length === 0 ? null : values.join(IDENTS_SEPARATOR);
    };
    return [
      String(oid), basic.get(oid)?.[MAIN_ID.column] ?? null,
      keyCell(HIP), keyCell(HD), keyCell(GJ), keyCell(GAIA_DR3),
      [...idents.get(oid)!].sort(compareCodeUnits).join(IDENTS_SEPARATOR),
    ];
  });
}

export interface IdentsGates {
  readonly band: WrittenTable['band'];
  readonly spotRows: WrittenTable['spotRows'];
}

export function identsTable({ band, spotRows }: IdentsGates): WrittenTable {
  return { columns: IDENTS_COLUMNS, sortBy: [{ column: IDENTS_COLUMN.oid, as: 'integer' }], band, spotRows };
}

const spot = (oid: string, mainId: string, hip: string | null, hd: string | null, idents: string) => ({
  key: IDENTS_COLUMN.oid, value: oid, cells: { [IDENTS_COLUMN.mainId]: mainId, [IDENTS_COLUMN.hip]: hip, [IDENTS_COLUMN.hd]: hd, [IDENTS_COLUMN.idents]: idents },
});

/** README.md#gates. */
export const IDENTS_GATES: IdentsGates = {
  band: { min: 140_000, max: 170_000 },
  spotRows: [
    spot('1450042', '*  39 Psc', '1427', '1352', '* 39 Psc|** TOK 646A'),
    spot('2966222', 'HD  33793', '24186', '33793', "NAME Kapteyn Star|NAME Kapteyn's|NAME Kapteyn's star|V* VZ Pic"),
    spot('365467', '* pi.02 UMi', '76695', '141652', '* 18 UMi|* pi.02 UMi|** STF 1989AB'),
    spot('122759', 'HD 239960', '110893', '239960', '** KR 60AB'),
    spot('794302', '* bet Tau', '25428', '35497', '* 112 Tau|* 23 Aur|* bet Tau|* gam Aur|NAME Elnath'),
  ],
};

/** Every distinct oid a simbad_sptype.tsv row names, ascending. */
export function sptypeOids(text: string, from: Declared): number[] {
  const oids = new Set<number>();
  for (const row of readTable({ ...from, columns: [OID.tsv] }, text)) {
    oids.add(row.requiredId(OID.tsv));
  }
  return [...oids].sort(ascending);
}

export interface IdentsRequest {
  /** The oids simbad_sptype.tsv resolved a manifest record to, ascending. */
  readonly oids: readonly number[];
  readonly requestFrom: readonly string[];
}

export function identsPull(outputs: DeclaredOutputs<'idents'>, { oids, requestFrom }: IdentsRequest, gates: IdentsGates = IDENTS_GATES): PhasedPull<'idents'> {
  return {
    archive: SIMBAD,
    outputs,
    phases: IDENTS_PHASES,
    tables: { idents: identsTable(gates) },
    request: { request: oids.map(String), requestFrom },
    async run(ask: Ask, log) {
      const ledger = parseLedger();
      const idents = identsByOid(await ask(IDENTS_PHASES.wholeSky), WHOLE_SKY_CLASSES);
      log(`whole-sky classes: ${idents.size} objects`);
      const reached = identsByOid(await ask(IDENTS_PHASES.reached, oids.map(String)), REACHED_CLASSES);
      log(`reached classes: ${reached.size} of the ${oids.length} resolved objects`);
      mergeInto(idents, reached);
      const held = [...idents.keys()].sort(ascending);
      const keys = await fetchIdentSets(ask, IDENTS_PHASES.keys, held, ledger);
      const basic = await fetchBasic(ask, CORE, held);
      const rows = identsRows(idents, keys, basic);
      log(`rows: ${rows.length}`);
      return { rows: { idents: rows }, checks: [ledger.check('keys')] };
    },
  };
}
