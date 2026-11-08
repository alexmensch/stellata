// The manifest-keyed SIMBAD spectral-type pull: Phase A, the basic table, the value-keyed union, cross-IDs. See README.md.

import type { ManifestRecord } from '../../catalog/membership/membership-manifest-tsv';
import type { DeclaredOutputs } from '../../util/emit-artifacts';
import type { PhasedPull, WrittenTable } from '../pull/pull';
import type { SpotRow } from '../pull/gates-pure';
import { SIMBAD } from '../pull/tap-pure';
import { keyedRows, membershipKeys, requestLines } from '../simbad/membership-keys-pure';
import { requestReport, resolveMembershipKeys } from '../simbad/resolve-membership-pure';
import { fetchBasic, fetchIdents, parseLedger, phaseRecord, simbadPhases } from '../simbad/simbad-fetch-pure';
import { countFilled, fillLine, floorCheck, identBlock, isFilled, simbadColumns, simbadRows } from '../simbad/simbad-rows-pure';
import { GAIA_DR3, GJ, HIP, MAIN_ID, OID, OTYPE, SP_BIBCODE, SP_QUAL, SP_TYPE, TYC } from '../simbad/simbad-specs-pure';
import { recoveredRows, unionReportLines, unionUnanswered } from '../simbad/union-pure';

export const BASIC = [OID, MAIN_ID, SP_TYPE, SP_QUAL, SP_BIBCODE, OTYPE] as const;
export const IDENTS = [HIP, GAIA_DR3, TYC, GJ];
export const SPTYPE_PHASES = simbadPhases({ basic: BASIC, idents: IDENTS });

/** sp_type fill drops sharply in the faint tail; under this the pull is broken, not sparse. */
export const SP_TYPE_FLOOR = 0.5;
/** Recovered rows printed per run: a sample of what the union added, beside its counts. */
export const RECOVERED_SAMPLE = 25;

/** The written rows against the manifest's keyed rows: a key binds at most one object, and the union adds objects beyond them. */
export const ROW_BAND = { minOfKeyed: 0.9, maxOfKeyed: 1.1 };

const COLUMNS = simbadColumns(BASIC, [identBlock(IDENTS, new Map())]);

/** Arcturus, and alf Cen A, a component SIMBAD types apart from its system. */
const SPOT_ROWS: readonly [SpotRow, ...SpotRow[]] = [
  { key: OID.tsv, value: '2252964', cells: { simbad_main_id: '* alf Boo', sp_type: 'K1.5IIIFe-0.5', hip: '69673' } },
  { key: OID.tsv, value: '3396054', cells: { simbad_main_id: '* alf Cen A', sp_type: 'G2V', hip: '71683', gj: '559 A' } },
];

export function sptypeTable(keyed: number): WrittenTable {
  return {
    columns: COLUMNS,
    sortBy: [{ column: OID.tsv, as: 'integer' }],
    band: { min: Math.ceil(keyed * ROW_BAND.minOfKeyed), max: Math.floor(keyed * ROW_BAND.maxOfKeyed) },
    spotRows: SPOT_ROWS,
  };
}

export function sptypePull(
  outputs: DeclaredOutputs<'sptype'>, records: () => Iterable<ManifestRecord>, requestFrom: readonly string[],
): PhasedPull<'sptype'> {
  const keys = membershipKeys(records());
  return {
    archive: SIMBAD,
    outputs,
    phases: phaseRecord(SPTYPE_PHASES),
    tables: { sptype: sptypeTable(keyedRows(keys)) },
    request: { request: requestLines(keys), requestFrom },
    async run(ask, log) {
      log(`manifest rows: ${keyedRows(keys) + keys.keyless} (${keys.keyless} carrying no key)`);
      const ledger = parseLedger();
      const resolved = await resolveMembershipKeys(ask, SPTYPE_PHASES, keys, ledger);
      for (const line of requestReport(resolved)) log(line);
      const basic = await fetchBasic(ask, SPTYPE_PHASES, [...resolved.oids].sort((a, b) => a - b));
      const union = await unionUnanswered(ask, SPTYPE_PHASES, ledger, { records, bindings: resolved.bindings, rows: basic, value: SP_TYPE.column });
      for (const line of unionReportLines(union.report)) log(line);
      const merged = new Map([...basic, ...union.found]);
      let shown = 0;
      for (const [record, namespace, oid] of recoveredRows(records(), union.added)) {
        if (shown++ === RECOVERED_SAMPLE) break;
        log(`      recovered via ${namespace.padEnd(9)} hip=${String(record.hip ?? '-').padStart(7)} hd=${String(record.hd ?? '-').padStart(7)} → ${merged.get(oid)?.[SP_TYPE.column]}`);
      }
      const oids = [...merged.keys()].sort((a, b) => a - b);
      const idents = await fetchIdents(ask, SPTYPE_PHASES, IDENTS, oids, ledger);
      const typed = countFilled(merged.values(), (cells) => isFilled(cells[SP_TYPE.column]));
      log(fillLine('sp_type', typed, merged.size));
      return {
        rows: { sptype: simbadRows(oids, merged, BASIC, [identBlock(IDENTS, idents)]) },
        checks: [
          floorCheck('sp_type coverage', typed / Math.max(1, merged.size), SP_TYPE_FLOOR, 'SIMBAD\'s reply shape or the column list drifted'),
          ledger.check('idents'),
        ],
      };
    },
  };
}
