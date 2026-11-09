// The SIMBAD WDS cross-ID pull: each WDS component's object, with its main_id, Gaia DR3 source_id and HIP. See README.md.

import type { DeclaredOutputs } from '../../util/emit-artifacts';
import type { Row } from '../pull/columns-pure';
import type { Ask, Phase, PhasedPull, WrittenTable } from '../pull/pull';
import { SIMBAD } from '../pull/tap-pure';
import { fetchBasic, identPhase, oidOf, parseLedger, resolveOids, simbadPhases, type ParseLedger } from '../simbad/simbad-fetch-pure';
import { GAIA_DR3, HD, HIP, MAIN_ID, OID, WDS, parseIdent } from '../simbad/simbad-specs-pure';
import { componentId, identSuffix, type WdsComponent } from './wds-components-pure';
import {
  cascadeCandidates, cascadeRecoveries, parseCatalogueIdent, resolveHip, type CatalogueIdent,
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

const COLUMNS = ['wds_id', 'component', 'simbad_oid', 'simbad_main_id', 'gaia_source_id', 'hip'] as const;

export function xidsTable(components: number): WrittenTable {
  return {
    columns: [{ name: COLUMNS[0] }, ...COLUMNS.slice(1).map((name) => ({ name }))],
    sortBy: [{ column: 'wds_id', as: 'text' }, { column: 'component', as: 'text' }],
    band: { min: Math.ceil(components * MIN_COMPONENT_REACH), max: components },
    spotRows: [
      { key: 'simbad_oid', value: '930049', cells: { wds_id: '06451-1643', component: 'B', simbad_main_id: '* alf CMa B', gaia_source_id: '2947050466531873024', hip: null } },
      { key: 'simbad_oid', value: '1800871', cells: { wds_id: '11182+3132', component: 'B', gaia_source_id: '756853643637996160', hip: '55203' } },
      { key: 'simbad_oid', value: '3396054', cells: { wds_id: '14396-6050', component: 'A', simbad_main_id: '* alf Cen A', gaia_source_id: null, hip: '71683' } },
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

/** Each component's object by its WDS ident: Phase A. */
async function resolveByIdent(ask: Ask, components: readonly WdsComponent[], ledger: ParseLedger): Promise<Map<string, number>> {
  const bySuffix = new Map(components.map((c) => [identSuffix(c), c]));
  const oids = new Map<string, number>();
  for (const [suffix, oid] of await resolveOids(ask, CORE, WDS, [...bySuffix.keys()], ledger)) {
    const c = bySuffix.get(suffix);
    if (c !== undefined) oids.set(componentId(c), oid);
  }
  return oids;
}

/** Each HD and HIP number an object holds, the first in id order; a lettered alias gives its number too. */
function firstNumbers(rows: readonly Row[]): { hd: Map<number, number>; hip: Map<number, number> } {
  const out = { hd: new Map<number, number>(), hip: new Map<number, number>() };
  for (const [oidCell, id] of rows) {
    const parsed = parseCatalogueIdent(id ?? '');
    if (parsed === null) continue;
    const into = parsed.catalogue === 'HD' ? out.hd : out.hip;
    const oid = oidOf(oidCell);
    if (!into.has(oid)) into.set(oid, parsed.number);
  }
  return out;
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
        const numbers = firstNumbers(await ask(XIDS_PHASES.aliases, primaries.map(String)));
        log(`aliases: ${numbers.hd.size} HD and ${numbers.hip.size} HIP over ${primaries.length} resolved siblings of ${unresolved.length} unresolved components`);
        const candidates = cascadeCandidates(unresolved, siblings, numbers.hd, numbers.hip);
        const ids = [...candidates.keys()].sort();
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
      const hipAliases = new Map<number, CatalogueIdent[]>();
      const gaia = new Map<number, string>();
      for (const [oidCell, idCell] of await ask(XIDS_PHASES.xrefs, unique.map(String))) {
        const id = idCell ?? '';
        const oid = oidOf(oidCell);
        const hip = id.startsWith(HIP.prefix) ? parseCatalogueIdent(id) : null;
        if (hip !== null) {
          hipAliases.set(oid, [...(hipAliases.get(oid) ?? []), hip]);
          continue;
        }
        const parsed = parseIdent(GAIA_DR3, id);
        ledger.note(parsed);
        if (parsed.kind === 'suffix') gaia.set(oid, parsed.suffix);
      }

      const rows: Row[] = [];
      for (const c of components) {
        const oid = oids.get(componentId(c));
        if (oid === undefined) continue;
        const hip = resolveHip(hipAliases.get(oid) ?? [], letters.get(oid) ?? new Set());
        rows.push([c.wdsId, c.component, String(oid), basic.get(oid)?.[MAIN_ID.column] ?? null, gaia.get(oid) ?? null, hip === null ? null : String(hip)]);
      }
      log(`rows: ${rows.length}, ${rows.filter((r) => r[4] !== null).length} with a Gaia DR3 source_id, ${rows.filter((r) => r[5] !== null).length} with a HIP`);
      return { rows: { xids: rows }, checks: [ledger.check('idents')] };
    },
  };
}
