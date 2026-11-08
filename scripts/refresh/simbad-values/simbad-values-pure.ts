// The SIMBAD value-tier pull: bibcoded rv, parallax, PM, coordinates and B/V fluxes for the value cohort. See README.md.

import type { ManifestRecord } from '../../catalog/membership/membership-manifest-tsv';
import type { DeclaredOutputs, Projection } from '../../util/emit-artifacts';
import type { PhasedPull, WrittenTable } from '../pull/pull';
import { SIMBAD } from '../pull/tap-pure';
import { keyedRows, membershipKeys, requestLines, valueCohort } from '../simbad/membership-keys-pure';
import { coverage, requestReport, resolveMembershipKeys } from '../simbad/resolve-membership-pure';
import { fetchBasic, fetchFlux, fetchIdents, parseLedger, phaseRecord, simbadPhases } from '../simbad/simbad-fetch-pure';
import {
  countFilled, fillLine, floorCheck, fluxBlock, identBlock, isFilled, simbadColumns, simbadRows,
} from '../simbad/simbad-rows-pure';
import {
  BASIC_BIBCODED_GROUPS, COO_BIBCODE, COO_QUAL, DEC, GAIA_DR3, GJ, HIP, MAIN_ID, OID, PLX_BIBCODE, PLX_ERR, PLX_QUAL,
  PLX_VALUE, PMDEC, PMRA, PM_BIBCODE, PM_QUAL, RA, RVZ_BIBCODE, RVZ_ERR, RVZ_QUAL, RVZ_RADVEL, RVZ_TYPE, TYC,
  fluxColumns, fluxGroup, type FluxBand,
} from '../simbad/simbad-specs-pure';

export const BASIC = [
  OID, MAIN_ID,
  RA, DEC, COO_QUAL, COO_BIBCODE,
  PMRA, PMDEC, PM_QUAL, PM_BIBCODE,
  PLX_VALUE, PLX_ERR, PLX_QUAL, PLX_BIBCODE,
  RVZ_RADVEL, RVZ_ERR, RVZ_TYPE, RVZ_QUAL, RVZ_BIBCODE,
] as const;
export const IDENTS = [HIP, GAIA_DR3, TYC, GJ];
export const FLUX_BANDS: readonly FluxBand[] = [{ filter: 'B' }, { filter: 'V' }];
export const VALUES_PHASES = simbadPhases({ basic: BASIC, idents: IDENTS, fluxes: FLUX_BANDS });

/** Every SIMBAD object carries coordinates, so a lower fill means the reply's shape or the column list drifted. */
export const COORD_FLOOR = 0.99;
/** Gaia DR3 ident resolution over the cohort's source_ids: 99.6% measured 2026-08-15. */
export const GAIA_RESOLUTION_FLOOR = 0.95;
/** The least share of the cohort's keyed rows that must reach an object: 74,446 of 75,040 at the 2026-09-08 pull. */
export const MIN_ROW_REACH = 0.97;

const GROUPS = [...BASIC_BIBCODED_GROUPS, ...FLUX_BANDS.map(fluxGroup)];
const COLUMNS = simbadColumns(BASIC, [identBlock(IDENTS, new Map()), fluxBlock(FLUX_BANDS, new Map())]);

export function valuesTable(keyed: number): WrittenTable {
  return {
    columns: COLUMNS,
    sortBy: [{ column: OID.tsv, as: 'integer' }],
    band: { min: Math.ceil(keyed * MIN_ROW_REACH), max: keyed },
    spotRows: [
      {
        key: OID.tsv, value: '747',
        cells: { simbad_main_id: '* tau Cyg', hip: '104887', plx_value: { near: 49.16, within: 0.5 }, rvz_radvel: { near: -20.9, within: 1 } },
      },
      {
        key: OID.tsv, value: '6222',
        cells: { simbad_main_id: '* lam And', hip: '116584', plx_value: { near: 38.574, within: 0.5 }, rvz_radvel: { near: 6.84, within: 1 } },
      },
    ],
  };
}

export interface ValuesInputs {
  readonly records: () => Iterable<ManifestRecord>;
  readonly gaiaComplete: ReadonlySet<string>;
  readonly requestFrom: readonly string[];
}

export function valuesPull(outputs: DeclaredOutputs<'values'>, inputs: ValuesInputs): PhasedPull<'values'> {
  const keys = membershipKeys(inputs.records(), valueCohort(inputs.gaiaComplete));
  const request: Projection = { request: requestLines(keys), requestFrom: inputs.requestFrom };
  return {
    archive: SIMBAD,
    outputs,
    phases: phaseRecord(VALUES_PHASES),
    tables: { values: valuesTable(keyedRows(keys)) },
    request,
    async run(ask, log) {
      log(`value cohort: ${keyedRows(keys) + keys.keyless} manifest rows (${keys.keyless} carrying no key); `
        + `Gaia 5p states every cascade value for ${inputs.gaiaComplete.size} source_ids`);
      const ledger = parseLedger();
      const resolved = await resolveMembershipKeys(ask, VALUES_PHASES, keys, ledger);
      for (const line of requestReport(resolved)) log(line);
      const gained = [...resolved.gainedByWidening.values()].reduce((n, g) => n + g, 0);
      log(`oids: ${resolved.oids.size} (+${gained} the widening reached alone)`);
      const oids = [...resolved.oids].sort((a, b) => a - b);
      const basic = await fetchBasic(ask, VALUES_PHASES, oids);
      const idents = await fetchIdents(ask, VALUES_PHASES, IDENTS, oids, ledger);
      const flux = await fetchFlux(ask, VALUES_PHASES, FLUX_BANDS, oids);

      const total = basic.size;
      const coords = countFilled(basic.values(), (cells) => isFilled(cells[RA.column]));
      log(fillLine('coordinates', coords, total));
      for (const [label, column] of [['radial velocity', RVZ_RADVEL], ['rv bibcode', RVZ_BIBCODE], ['parallax', PLX_VALUE],
        ['parallax bibcode', PLX_BIBCODE], ['proper motion', PMRA], ['pm bibcode', PM_BIBCODE]] as const) {
        log(fillLine(label, countFilled(basic.values(), (cells) => isFilled(cells[column.column])), total));
      }
      for (const band of FLUX_BANDS) {
        const [value, , bibcode] = fluxColumns(band).map((c) => c.tsv);
        const reached = countFilled(flux.values(), (cells) => isFilled(cells[value]));
        const shipped = countFilled(flux.values(), (cells) => isFilled(cells[value]) && isFilled(cells[bibcode]));
        log(`${fillLine(`flux ${band.filter}`, reached, total)}; ${shipped} ship, ${reached - shipped} dropped as unattributable`);
      }

      return {
        rows: { values: simbadRows(oids, basic, BASIC, [identBlock(IDENTS, idents), fluxBlock(FLUX_BANDS, flux)], GROUPS) },
        checks: [
          floorCheck('Gaia DR3 ident resolution', coverage(resolved, GAIA_DR3.name), GAIA_RESOLUTION_FLOOR, 'the request set or SIMBAD\'s ident table drifted'),
          floorCheck('coordinate fill', coords / Math.max(1, total), COORD_FLOOR, 'SIMBAD\'s reply shape or the column list drifted'),
          ledger.check('idents'),
        ],
      };
    },
  };
}
