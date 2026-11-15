// The whole-table VizieR pulls' tables: each VizieR column under the name its TSV writes, with formats, sort keys, bands and spot rows. See README.md.

import type { Column, Format, SortKey } from '../pull/columns-pure';
import { near, type Pinned, type RowBand, type SpotRow } from '../pull/gates-pure';
import type { PullTable } from '../pull/pull';
import { VIZIER } from '../pull/tap-pure';

/** A VOTable `float`, written as numpy printed the float32 Python read. */
export const FLOAT: Format = { repr: true, float32: true };
/** A VOTable `double`, written as Python's repr. */
export const DOUBLE: Format = { repr: true };

/** A column under the name its TSV writes, keeping the VizieR name an ASU mirror asks it by. */
export interface VizierColumn extends Column {
  readonly vizier: string;
}

export function vizierColumn(vizier: string, name: string, format?: Format): VizierColumn {
  return {
    name,
    vizier,
    ...(vizier === name ? {} : { select: `${VIZIER.quote(vizier)} AS ${name}` }),
    ...(format === undefined ? {} : { format }),
  };
}

/** An inclusive range on one VizieR column. */
export interface VizierRange {
  readonly column: string;
  readonly min: number;
  readonly max: number;
}

/** One VizieR query as both its ADQL parts and its ASU form, so the CDS and CfA mirrors ask the same rows. */
export function vizierQuery(vizierId: string, columns: readonly [VizierColumn, ...VizierColumn[]], range?: VizierRange) {
  return {
    from: VIZIER.quote(vizierId),
    columns,
    ...(range === undefined ? {} : { where: `${VIZIER.quote(range.column)} BETWEEN ${range.min} AND ${range.max}` }),
    asu: {
      source: vizierId,
      columns: columns.map((c) => ({ archive: c.vizier, name: c.name })),
      constraints: range === undefined ? {} : { [range.column]: `${range.min}..${range.max}` },
    },
  };
}

const integer = (column: string): SortKey => ({ column, as: 'integer' });
const text = (column: string): SortKey => ({ column, as: 'text' });

export interface VizierTable extends PullTable {
  readonly vizierId: string;
}

/** A pull's `release`: each table's VizieR id, in the pull's order. */
export const vizierRelease = (tables: Iterable<{ readonly vizierId: string }>): string =>
  [...tables].map(({ vizierId }) => `VizieR ${vizierId}`).join(', ');

/** `keys`, then every other column as text: rows tied on the keys would otherwise keep whichever order the answering mirror sent. */
export function totalOrder(columns: readonly Column[], keys: readonly [SortKey, ...SortKey[]]): readonly [SortKey, ...SortKey[]] {
  const keyed = new Set(keys.map((k) => k.column));
  return [...keys, ...columns.filter((c) => !keyed.has(c.name)).map((c) => text(c.name))];
}

function wholeTable(
  vizierId: string, columns: readonly [VizierColumn, ...VizierColumn[]], keys: readonly [SortKey, ...SortKey[]], band: RowBand,
  spotRows: readonly [SpotRow, ...SpotRow[]],
): VizierTable {
  const { asu, ...query } = vizierQuery(vizierId, columns);
  return { vizierId, ...query, sortBy: totalOrder(columns, keys), scope: { kind: 'whole-table', asu }, band, spotRows };
}

const spot = (key: string, value: string, cells: Readonly<Record<string, Pinned>>): SpotRow => ({ key, value, cells });

/** TYC1/TYC2/TYC3 stay separate; the `1000-1006-1` form the Gaia cross-walks key on is composed by the catalogue's parser. */
export const TYC2_HD = wholeTable(
  'IV/25/tyc2_hd',
  [
    vizierColumn('TYC1', 'tyc1'), vizierColumn('TYC2', 'tyc2'), vizierColumn('TYC3', 'tyc3'),
    vizierColumn('HD', 'hd'), vizierColumn('n_HD', 'n_hd'), vizierColumn('n_TYC', 'n_tyc'),
  ],
  [integer('tyc1'), integer('tyc2'), integer('tyc3')],
  { min: 350_000, max: 357_000 },
  [
    spot('hd', '172167', { tyc1: '3105', tyc2: '2070', tyc3: '1', n_hd: '1', n_tyc: '1' }),
    spot('hd', '48915', { tyc1: '5949', tyc2: '2777', tyc3: '1', n_hd: '1', n_tyc: '1' }),
  ],
);

/** `cst` is the constellation the Bayer / Flamsteed designation is named for, and Bayer letters arrive in IV/27A's own lowercase form (`alf`). */
export const CROSS_INDEX = wholeTable(
  'IV/27A/catalog',
  [
    vizierColumn('HD', 'hd'), vizierColumn('HR', 'hr'), vizierColumn('HIP', 'hip'),
    vizierColumn('Bayer', 'bayer'), vizierColumn('Fl', 'flamsteed'), vizierColumn('Cst', 'cst'),
  ],
  [integer('hd')],
  { min: 3_600, max: 3_800 },
  [
    spot('hd', '172167', { hr: '7001', hip: '91262', bayer: 'alf', flamsteed: '3', cst: 'Lyr' }),
    spot('hd', '48915', { hr: '2491', hip: '32349', bayer: 'alf', flamsteed: '9', cst: 'CMa' }),
  ],
);

export const BSC5 = wholeTable(
  'V/50/catalog',
  [vizierColumn('HR', 'hr'), vizierColumn('HD', 'hd'), vizierColumn('Name', 'name')],
  [integer('hr')],
  { min: 9_000, max: 9_200 },
  [spot('hr', '7001', { hd: '172167', name: '3Alp Lyr' }), spot('hr', '2491', { hd: '48915', name: '9Alp CMa' })],
);

/** `GaiaDR3` is an EDR3 source_id, which shares DR3's id space; `RAJ2000` vs `Epoch`: /data/classic-ids/README.md#the-astrometry-re-slice. */
export const CNS5 = wholeTable(
  'J/A+A/670/A19/cns5',
  [
    vizierColumn('CNS5', 'cns5'), vizierColumn('GJ', 'gj'), vizierColumn('Comp', 'gj_comp'),
    vizierColumn('GaiaDR3', 'gaia_source_id'), vizierColumn('HIP', 'hip'),
    vizierColumn('RAJ2000', 'ra_deg', DOUBLE), vizierColumn('DEJ2000', 'de_deg', DOUBLE),
    vizierColumn('Epoch', 'pos_epoch', DOUBLE), vizierColumn('r_pos', 'pos_bibcode'),
    vizierColumn('plx', 'plx_mas', FLOAT), vizierColumn('e_plx', 'e_plx_mas', FLOAT), vizierColumn('r_plx', 'plx_bibcode'),
    vizierColumn('pmRA', 'pm_ra', DOUBLE), vizierColumn('e_pmRA', 'e_pm_ra', DOUBLE),
    vizierColumn('pmDE', 'pm_de', DOUBLE), vizierColumn('e_pmDE', 'e_pm_de', DOUBLE),
    vizierColumn('r_pmRA', 'pm_bibcode'),
  ],
  [integer('cns5')],
  { min: 5_800, max: 6_000 },
  [
    spot('cns5', '3591', {
      gj: '551', gj_comp: 'C', gaia_source_id: '5853498713190525696', hip: '70890',
      ra_deg: near(217.39232147201, 1e-8), de_deg: near(-62.67607511677, 1e-8), pos_epoch: near(2016.0, 1e-6),
      plx_mas: near(768.07, 0.005), e_plx_mas: near(0.06, 0.005),
      pm_ra: near(-3781.74, 0.005), e_pm_ra: near(0.031, 0.0005), pm_de: near(769.47, 0.005), e_pm_de: near(0.051, 0.0005),
      pos_bibcode: '2020yCat.1350....0G', plx_bibcode: '2020yCat.1350....0G', pm_bibcode: '2020yCat.1350....0G',
    }),
  ],
);

const VMAG_DECIMALS: Format = { fixed: 3, float32: true };

export const HIP_MAIN_VMAG = wholeTable(
  'I/239/hip_main',
  [
    vizierColumn('HIP', 'hip'), vizierColumn('Vmag', 'vmag', VMAG_DECIMALS), vizierColumn('B-V', 'bv', VMAG_DECIMALS),
    vizierColumn('HD', 'hd'),
  ],
  [integer('hip')],
  { min: 117_000, max: 119_000 },
  [
    spot('hip', '32349', { vmag: near(-1.44, 0.005), bv: near(0.009, 0.005) }),
    spot('hip', '71683', { vmag: near(-0.01, 0.005), bv: near(0.71, 0.005) }),
    spot('hip', '91262', { vmag: near(0.03, 0.005), bv: near(0, 0.005) }),
  ],
);

/** `Name` is not unique: a resolved system has a row per component, so the key is name + comp (/data/gliese/README.md#the-join-key). */
export const GLIESE = wholeTable(
  'V/70A/catalog',
  [
    vizierColumn('Name', 'name'), vizierColumn('Comp', 'comp'),
    vizierColumn('Vmag', 'vmag', FLOAT), vizierColumn('n_Vmag', 'n_vmag'), vizierColumn('r_Vmag', 'r_vmag'),
    vizierColumn('B-V', 'bv', FLOAT), vizierColumn('n_B-V', 'n_bv'), vizierColumn('r_B-V', 'r_bv'),
    vizierColumn('Sp', 'sp'), vizierColumn('r_Sp', 'r_sp'),
    vizierColumn('plx', 'plx_mas', FLOAT), vizierColumn('e_plx', 'e_plx_mas', FLOAT), vizierColumn('n_plx', 'n_plx'),
    vizierColumn('trplx', 'trplx_mas', FLOAT), vizierColumn('RV', 'rv', FLOAT), vizierColumn('n_RV', 'n_rv'),
    vizierColumn('HD', 'hd'),
    vizierColumn('RAB1950', 'ra_b1950_deg', DOUBLE), vizierColumn('DEB1950', 'de_b1950_deg', DOUBLE),
    vizierColumn('pm', 'pm_arcsec_yr', FLOAT), vizierColumn('pmPA', 'pm_pa_deg', FLOAT),
    vizierColumn('DM', 'dm'), vizierColumn('Giclas', 'giclas'), vizierColumn('LHS', 'lhs'), vizierColumn('OtherName', 'other_name'),
  ],
  [text('name'), text('comp')],
  { min: 3_700, max: 3_900 },
  [
    spot('name', 'Gl 699', { comp: null, vmag: near(9.55, 0.005), bv: near(1.74, 0.005), sp: 'M5 V' }),
    spot('name', 'NN 3417', { comp: null, vmag: near(13.65, 0.005), sp: 'm' }),
  ],
);

/** `RArad` / `DErad` hold degrees despite the suffix. */
export const HIP2 = wholeTable(
  'I/311/hip2',
  [
    vizierColumn('HIP', 'hip'), vizierColumn('RArad', 'ra_icrs', DOUBLE), vizierColumn('DErad', 'de_icrs', DOUBLE),
    vizierColumn('Plx', 'plx', FLOAT), vizierColumn('e_Plx', 'e_plx', FLOAT),
    vizierColumn('pmRA', 'pm_ra', DOUBLE), vizierColumn('pmDE', 'pm_de', DOUBLE),
    vizierColumn('e_pmRA', 'e_pm_ra', FLOAT), vizierColumn('e_pmDE', 'e_pm_de', FLOAT),
    vizierColumn('F2', 'goodness_of_fit', FLOAT), vizierColumn('Ntr', 'n_transits'),
  ],
  [integer('hip')],
  { min: 117_000, max: 118_500 },
  [spot('hip', '32349', { pm_ra: near(-546.01, 0.1), pm_de: near(-1223.07, 0.1) })],
);

/** MSC's Syst / Prim / Sec / Parent are Tokovinin's own hierarchy labels, not WDS letters: ../../binaries/load/msc-pure.ts maps them. */
export const MSC_SYSTEMS = wholeTable(
  'J/ApJS/235/6/systems',
  [
    vizierColumn('ID', 'wds_id'), vizierColumn('Prim', 'prim'), vizierColumn('Sec', 'sec'), vizierColumn('Parent', 'parent'),
    vizierColumn('Type', 'obs_type'), vizierColumn('Per', 'per', DOUBLE), vizierColumn('x_Per', 'per_unit'),
    vizierColumn('Sep', 'sep', DOUBLE), vizierColumn('x_Sep', 'sep_unit'), vizierColumn('PA', 'pa_deg', FLOAT),
    vizierColumn('Vmag1', 'vmag1', FLOAT), vizierColumn('SpT1', 'spt1'), vizierColumn('Vmag2', 'vmag2', FLOAT),
    vizierColumn('SpT2', 'spt2'), vizierColumn('Mass1', 'mass1_msun', FLOAT), vizierColumn('Mass2', 'mass2_msun', FLOAT),
  ],
  [text('wds_id')],
  { min: 13_000, max: 17_000 },
  [spot('wds_id', '00022+2705', { prim: 'A', sec: 'B', per: near(26.28, 0.01), per_unit: 'y', spt1: 'G5V' })],
);

export const MSC_ORBITS = wholeTable(
  'J/ApJS/235/6/orbits',
  [
    vizierColumn('ID', 'wds_id'), vizierColumn('Syst', 'syst'), vizierColumn('Per', 'per', DOUBLE),
    vizierColumn('x_Per', 'per_unit'), vizierColumn('T', 't0', DOUBLE), vizierColumn('e', 'e', FLOAT),
    vizierColumn('a', 'a_arcsec', DOUBLE), vizierColumn('Node', 'node_deg', FLOAT), vizierColumn('LongP', 'longp_deg', FLOAT),
    vizierColumn('Incl', 'incl_deg', FLOAT), vizierColumn('K1', 'k1_kms', FLOAT), vizierColumn('K2', 'k2_kms', FLOAT),
    vizierColumn('V0', 'v0_kms', FLOAT), vizierColumn('Flag', 'node_flag'), vizierColumn('Note', 'note'),
  ],
  [text('wds_id')],
  { min: 4_000, max: 6_500 },
  [spot('wds_id', '23300+5833', { syst: 'Aa,Ab', per: near(6.0663, 0.01), per_unit: 'd' })],
);

export const MSC_COMPONENTS = wholeTable(
  'J/ApJS/235/6/catalog',
  [
    vizierColumn('ID', 'wds_id'), vizierColumn('m_ID', 'comp'), vizierColumn('SpT', 'spt'),
    vizierColumn('Vmag', 'vmag', FLOAT), vizierColumn('Bmag', 'bmag', FLOAT), vizierColumn('Sep', 'sep_arcsec', FLOAT),
    vizierColumn('HIP', 'hip'), vizierColumn('HD', 'hd'), vizierColumn('plx', 'plx_mas', FLOAT),
  ],
  [text('wds_id'), text('comp')],
  { min: 11_000, max: 15_000 },
  [spot('hip', '115990', { wds_id: '23300+5833', comp: 'A', spt: 'B3IV', vmag: near(4.91, 0.005), hd: '221253' })],
);
