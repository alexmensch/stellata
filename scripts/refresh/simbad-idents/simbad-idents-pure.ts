// The SIMBAD identifier pull: the designation classes the label cells read, with each object's catalogue keys. See README.md.

import { ascending, compareCodeUnits } from '../../../src/astro-core/order-pure';
import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import type { DeclaredOutputs } from '../../util/emit-artifacts';
import { readTable } from '../../util/tsv/table-pure';
import type { Column, Row } from '../pull/columns-pure';
import type { Ask, Phase, PhasedPull, WrittenTable } from '../pull/pull';
import { SIMBAD } from '../pull/tap-pure';
import { fetchBasic, fetchIdentSets, identPhase, oidOf, parseLedger, simbadPhases, type BasicCells } from '../simbad/simbad-fetch-pure';
import { GAIA_DR3, GJ, HD, HIP, MAIN_ID, OID, type Namespace } from '../simbad/simbad-specs-pure';

/** An ident class: SIMBAD's prefix, with its trailing space. */
const designationClass = (prefix: string): Namespace => ({ prefix, name: prefix.trim(), numeric: false });

/** Asked over the whole of SIMBAD: README.md#the-classes. */
export const WHOLE_SKY_CLASSES = ['* ', 'NAME ', 'LAL ', 'Ross ', 'Wolf '].map(designationClass);
/** Asked only on the objects simbad_sptype.tsv resolved a manifest record to: README.md#the-classes. */
export const REACHED_CLASSES = ['** ', 'V* ', 'X '].map(designationClass);
/** The keys a record joins an object on. */
export const KEY_NAMESPACES = [HIP, HD, GJ, GAIA_DR3] as const;

/** The most rows the whole-sky classes may return: 20,715 at the 2026-11-16 count. */
export const WHOLE_SKY_MAX_ROWS = 30_000;

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

/** The written columns' names; `IDENTS_COLUMNS` is their order. */
export const IDENTS = {
  oid: OID.tsv, mainId: MAIN_ID.tsv, hip: HIP.name, hd: HD.name, gj: GJ.name, sourceId: GAIA_DR3.name, idents: 'idents',
} as const;

const IDENTS_COLUMNS: readonly [Column, ...Column[]] = [
  { name: IDENTS.oid }, { name: IDENTS.mainId }, { name: IDENTS.hip }, { name: IDENTS.hd },
  { name: IDENTS.gj }, { name: IDENTS.sourceId }, { name: IDENTS.idents },
];

/** An id with SIMBAD's space padding collapsed: `*  39 Psc` is written `* 39 Psc`. */
export const collapseSpaces = (id: string): string => id.replace(/\s+/g, ' ').trim();

/** The values one row joins with `|`. */
export const VALUE_SEPARATOR = '|';

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

const numericOrder = (a: string, b: string): number => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

/** One row per object holding an id of a pulled class: README.md#the-table. */
export function identsRows(
  idents: ReadonlyMap<number, ReadonlySet<string>>,
  keys: ReadonlyMap<number, ReadonlyMap<string, ReadonlySet<string>>>,
  basic: ReadonlyMap<number, BasicCells>,
): Row[] {
  return [...idents.keys()].sort(ascending).map((oid) => {
    const keyCell = (ns: Namespace): string | null => {
      const values = [...(keys.get(oid)?.get(ns.name) ?? [])].sort(ns.numeric ? numericOrder : compareCodeUnits);
      return values.length === 0 ? null : values.join(VALUE_SEPARATOR);
    };
    return [
      String(oid), basic.get(oid)?.[MAIN_ID.column] ?? null,
      keyCell(HIP), keyCell(HD), keyCell(GJ), keyCell(GAIA_DR3),
      [...idents.get(oid)!].sort(compareCodeUnits).join(VALUE_SEPARATOR),
    ];
  });
}

export interface IdentsGates {
  readonly band: WrittenTable['band'];
  readonly spotRows: WrittenTable['spotRows'];
}

export function identsTable({ band, spotRows }: IdentsGates): WrittenTable {
  return { columns: IDENTS_COLUMNS, sortBy: [{ column: IDENTS.oid, as: 'integer' }], band, spotRows };
}

const spot = (oid: string, mainId: string, hip: string | null, hd: string | null, idents: string) => ({
  key: IDENTS.oid, value: oid, cells: { [IDENTS.mainId]: mainId, [IDENTS.hip]: hip, [IDENTS.hd]: hd, [IDENTS.idents]: idents },
});

/** README.md#gates. */
export const IDENTS_GATES: IdentsGates = {
  band: { min: 65_000, max: 80_000 },
  spotRows: [
    spot('1450042', '*  39 Psc', '1427', '1352', '* 39 Psc|** TOK 646A'),
    spot('2966222', 'HD  33793', '24186', '33793', "NAME Kapteyn Star|NAME Kapteyn's|NAME Kapteyn's star|V* VZ Pic"),
    spot('365467', '* pi.02 UMi', '76695', '141652', '* 18 UMi|* pi.02 UMi|** STF 1989AB'),
    spot('794302', '* bet Tau', '25428', '35497', '* 112 Tau|* 23 Aur|* bet Tau|* gam Aur|NAME Elnath'),
  ],
};

/** Every distinct oid a simbad_sptype.tsv row names, ascending. */
export function sptypeOids(text: string): number[] {
  const oids = new Set<number>();
  for (const row of readTable({ file: DATA_FILES.simbadSptype, columns: [IDENTS.oid], hint: 'Re-run `pnpm run refresh:simbad-sptype`.' }, text)) {
    oids.add(row.requiredId(IDENTS.oid));
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
