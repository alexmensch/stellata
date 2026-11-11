// The SIMBAD WDS cross-ID pull: each WDS component's object, with its main_id, Gaia DR3 source_id and HIP. See README.md.

import type { Check, DeclaredOutputs } from '../../util/emit-artifacts';
import type { Column, Row } from '../pull/columns-pure';
import type { Ask, Phase, PhasedPull, WrittenTable } from '../pull/pull';
import { SIMBAD } from '../pull/tap-pure';
import { fetchBasic, identPhase, oidOf, parseLedger, resolveOids, simbadPhases, type ParseLedger } from '../simbad/simbad-fetch-pure';
import { GAIA_DR3, HD, HIP, MAIN_ID, OID, WDS, compose, identKey, parseIdent } from '../simbad/simbad-specs-pure';
import { componentId, identSuffix, type WdsComponent } from './wds-components-pure';
import {
  cascadeCandidates, cascadeRecoveries, catalogueAlias, resolveHip, type CatalogueAlias,
} from './wds-xids-cascade-pure';
import { assertOverridesOnComponents, type WdsXidOverride } from './wds-xids-overrides-pure';

/** The least share of the WDS components that must reach an object (README.md#the-request-and-the-gates). */
export const MIN_COMPONENT_REACH = 0.36;

const CORE = simbadPhases({ basic: [OID, MAIN_ID], idents: [HIP, GAIA_DR3] });

/** Phase A and the cascade both ask ids for their oids; the cascade's order decides which of two disagreeing aliases binds, so it is the server's. */
export const XIDS_PHASES = {
  resolve: CORE.resolve,
  aliases: identPhase([HIP, HD]),
  cascade: { ...CORE.resolve, orderBy: 'id' },
  basic: CORE.basic,
  xrefs: CORE.idents,
} as const satisfies Record<string, Phase>;

/** The written columns' names; `XIDS_COLUMNS` is their order. */
export const XIDS = { wdsId: 'wds_id', component: 'component', oid: OID.tsv, mainId: MAIN_ID.tsv, gaia: 'gaia_source_id', hip: 'hip' } as const;

export const XIDS_COLUMNS: readonly [Column, ...Column[]] = [
  { name: XIDS.wdsId }, { name: XIDS.component }, { name: XIDS.oid }, { name: XIDS.mainId }, { name: XIDS.gaia }, { name: XIDS.hip },
];

export function xidsTable(components: number): WrittenTable {
  return {
    columns: XIDS_COLUMNS,
    sortBy: [{ column: XIDS.wdsId, as: 'text' }, { column: XIDS.component, as: 'text' }],
    band: { min: Math.ceil(components * MIN_COMPONENT_REACH), max: components },
    spotRows: [
      { key: XIDS.oid, value: '930049', cells: { [XIDS.wdsId]: '06451-1643', [XIDS.component]: 'B', [XIDS.mainId]: '* alf CMa B', [XIDS.gaia]: '2947050466531873024', [XIDS.hip]: null } },
      { key: XIDS.oid, value: '1800871', cells: { [XIDS.wdsId]: '11182+3132', [XIDS.component]: 'B', [XIDS.gaia]: '756853643637996160', [XIDS.hip]: '55203' } },
      { key: XIDS.oid, value: '3396054', cells: { [XIDS.wdsId]: '14396-6050', [XIDS.component]: 'A', [XIDS.mainId]: '* alf Cen A', [XIDS.gaia]: null, [XIDS.hip]: '71683' } },
    ],
  };
}

export interface XidsInputs {
  readonly components: readonly WdsComponent[];
  readonly overrides: readonly WdsXidOverride[];
  readonly overridesFile: string;
  readonly requestFrom: readonly string[];
}

const share = (n: number, of: number): string => `${n}/${of} (${of === 0 ? '0.0' : ((100 * n) / of).toFixed(1)}%)`;

/** Each component's object by its WDS ident: Phase A. An answer naming no asked component is refused, never dropped. */
async function resolveByIdent(ask: Ask, components: readonly WdsComponent[], ledger: ParseLedger): Promise<Map<string, number>> {
  const byKey = new Map(components.map((c) => [identKey(compose(WDS, identSuffix(c))), c]));
  const oids = new Map<string, number>();
  for (const [suffix, oid] of await resolveOids(ask, CORE, WDS, components.map(identSuffix), ledger)) {
    const c = byKey.get(identKey(compose(WDS, suffix)));
    if (c === undefined) throw new Error(`SIMBAD answered ${compose(WDS, suffix)}, which names no component the request asked`);
    oids.set(componentId(c), oid);
  }
  return oids;
}

/** Each HD and HIP number an object holds, the first in id order; a lettered alias gives its number too. */
function firstNumbers(rows: readonly Row[], ledger: ParseLedger): { hd: Map<number, string>; hip: Map<number, string> } {
  const out = { hd: new Map<number, string>(), hip: new Map<number, string>() };
  for (const [oidCell, idCell] of rows) {
    const id = idCell ?? '';
    const [ns, into] = id.startsWith(HD.prefix) ? [HD, out.hd] : [HIP, out.hip];
    const alias = catalogueAlias(ns, id, ledger);
    if (alias === null) continue;
    const oid = oidOf(oidCell);
    if (!into.has(oid)) into.set(oid, alias.number);
  }
  return out;
}

/** An override whose object SIMBAD's basic table does not hold would write a row with no main_id or ids: a typo passes every other gate. */
export function overridesHeldCheck(overrides: readonly WdsXidOverride[], held: ReadonlySet<number>, file: string): Check {
  const missing = overrides.filter((o) => !held.has(o.oid)).map((o) => `${componentId(o)} → ${o.oid}`);
  const report = `overrides: ${overrides.length - missing.length}/${overrides.length} on an object SIMBAD holds`;
  return missing.length === 0
    ? { kind: 'pass', report }
    : { kind: 'fail', message: `${file} pins ${missing.length} objects SIMBAD's basic table does not hold: ${missing.join(', ')}`, report };
}

export function xidsPull(outputs: DeclaredOutputs<'xids'>, inputs: XidsInputs): PhasedPull<'xids'> {
  const { components, overrides } = inputs;
  assertOverridesOnComponents(overrides, components, inputs.overridesFile);
  const request = [
    ...components.map((c) => `${WDS.prefix}${identSuffix(c)}`),
    ...overrides.map((o) => `override ${componentId(o)} ${o.oid}`),
  ];
  return {
    archive: SIMBAD,
    outputs,
    phases: XIDS_PHASES,
    tables: { xids: xidsTable(components.length) },
    request: { request, requestFrom: inputs.requestFrom },
    async run(ask, log) {
      const ledger = parseLedger();
      const oids = await resolveByIdent(ask, components, ledger);
      log(`WDS idents: ${share(oids.size, components.length)} components matched`);

      const siblings = new Map<string, number[]>();
      for (const c of components) {
        const oid = oids.get(componentId(c));
        if (oid !== undefined) siblings.set(c.wdsId, [...(siblings.get(c.wdsId) ?? []), oid]);
      }
      const unresolved = components.filter((c) => !oids.has(componentId(c)) && siblings.has(c.wdsId));
      if (unresolved.length > 0) {
        const primaries = [...new Set(unresolved.flatMap((c) => siblings.get(c.wdsId) ?? []))].sort((a, b) => a - b);
        const numbers = firstNumbers(await ask(XIDS_PHASES.aliases, primaries.map(String)), ledger);
        log(`aliases: ${numbers.hd.size} HD and ${numbers.hip.size} HIP over ${primaries.length} resolved siblings of ${unresolved.length} unresolved components`);
        const candidates = cascadeCandidates(unresolved, siblings, numbers.hd, numbers.hip);
        const ids = [...candidates.values()].map((cand) => cand.id).sort();
        const rows = await ask(XIDS_PHASES.cascade, ids.map((id) => `'${id}'`));
        const cascade = cascadeRecoveries(rows.map(([oid, id]) => ({ id: id ?? '', oid: oidOf(oid) })), candidates, new Set(oids.values()));
        for (const [key, { oid }] of cascade.recoveries) oids.set(key, oid);
        log(`cascade: ${ids.length} candidates, ${cascade.recoveries.size} components recovered (alias hits HD ${cascade.hits.HD}, CCDM ${cascade.hits.CCDM}, HIP ${cascade.hits.HIP})`);
        for (const conflict of cascade.conflicts) log(`  cascade kept the first of two objects for ${conflict}`);
      }
      for (const o of overrides) oids.set(componentId(o), o.oid);

      const letters = new Map<number, Set<string>>();
      for (const c of components) {
        const oid = oids.get(componentId(c));
        if (oid !== undefined) letters.set(oid, (letters.get(oid) ?? new Set()).add(c.component));
      }
      const unique = [...letters.keys()].sort((a, b) => a - b);
      const basic = await fetchBasic(ask, CORE, unique);
      const hipAliases = new Map<number, CatalogueAlias[]>();
      const gaia = new Map<number, string>();
      for (const [oidCell, idCell] of await ask(XIDS_PHASES.xrefs, unique.map(String))) {
        const id = idCell ?? '';
        const oid = oidOf(oidCell);
        if (id.startsWith(HIP.prefix)) {
          const hip = catalogueAlias(HIP, id, ledger);
          if (hip !== null) hipAliases.set(oid, [...(hipAliases.get(oid) ?? []), hip]);
          continue;
        }
        const parsed = parseIdent(GAIA_DR3, id);
        ledger.note(parsed);
        if (parsed.kind === 'suffix') gaia.set(oid, parsed.suffix);
      }

      const rows: Row[] = [];
      let withGaia = 0;
      let withHip = 0;
      for (const c of components) {
        const oid = oids.get(componentId(c));
        if (oid === undefined) continue;
        const hip = resolveHip(hipAliases.get(oid) ?? [], letters.get(oid) ?? new Set());
        const sourceId = gaia.get(oid) ?? null;
        if (sourceId !== null) withGaia++;
        if (hip !== null) withHip++;
        rows.push([c.wdsId, c.component, String(oid), basic.get(oid)?.[MAIN_ID.column] ?? null, sourceId, hip]);
      }
      log(`rows: ${rows.length}, ${withGaia} with a Gaia DR3 source_id, ${withHip} with a HIP`);
      return { rows: { xids: rows }, checks: [ledger.check('idents'), overridesHeldCheck(overrides, new Set(basic.keys()), inputs.overridesFile)] };
    },
  };
}
