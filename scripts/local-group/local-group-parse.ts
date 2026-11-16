// The LVDB snapshot, override and alias parsers behind build:local-group. See README.md.

import type { Declared } from '../util/sources/source';
import { readTable, type ColumnTable, type TableRow, type TableSpec } from '../util/tsv/table-pure';
import {
  canonicalDesignation,
  type AliasRow,
  type LvdbRow,
  type OverrideRow,
} from './build-local-group-pure';

const LVDB_COLUMNS = [
  'key', 'name', 'ra', 'dec', 'distance', 'confirmed_real', 'confirmed_galaxy',
  'rhalf_physical', 'ellipticity', 'position_angle', 'apparent_magnitude_v', 'n_sersic',
] as const;
const LVDB_FLAG = ['0', '1'] as const;

/** Position and the two confirmation flags are required; an empty structure or photometry cell is null. */
export function parseLvdb(table: ColumnTable): LvdbRow[] {
  return [...table(LVDB_COLUMNS)].map((row) => {
    const key = row.requiredText('key');
    return {
      key,
      name: row.text('name') ?? key,
      ra: row.requiredFloat('ra'),
      dec: row.requiredFloat('dec'),
      distanceKpc: row.requiredFloat('distance'),
      confirmedReal: row.oneOf('confirmed_real', LVDB_FLAG) === '1',
      confirmedGalaxy: row.oneOf('confirmed_galaxy', LVDB_FLAG) === '1',
      rhalfPhysicalPc: row.float('rhalf_physical'),
      ellipticity: row.float('ellipticity'),
      positionAngle: row.float('position_angle'),
      apparentMagV: row.float('apparent_magnitude_v'),
      nSersic: row.float('n_sersic'),
    };
  });
}

const OVERRIDES_REQUIRED = ['name', 'a_pc', 'b_pc', 'c_pc', 'orient', 'source'] as const;
const OVERRIDES_OPTIONAL = [
  'ra_deg', 'dec_deg', 'distance_kpc', 'm_v', 'profile', 'n_sersic', 'r_d_pc',
  'bulge_to_total', 'bulge_re_pc', 'bulge_n', 'color',
] as const;
const OVERRIDE_PROFILES = ['', 'disc', 'sersic'] as const;
type OverridesColumn = (typeof OVERRIDES_REQUIRED)[number] | (typeof OVERRIDES_OPTIONAL)[number];

/** Schema and per-column semantics: /data/local-group/README.md#override-schema. */
export function parseOverrides(tsv: string, from: Declared): OverrideRow[] {
  const spec = {
    ...from,
    columns: OVERRIDES_REQUIRED,
    optional: OVERRIDES_OPTIONAL,
    comments: true,
  } satisfies TableSpec<OverridesColumn>;
  return [...readTable(spec, tsv)].map(overrideRow);
}

function overrideRow(row: TableRow<OverridesColumn>): OverrideRow {
  const opt = (col: (typeof OVERRIDES_OPTIONAL)[number]): string | undefined => row.text(col) ?? undefined;
  const optNum = (col: (typeof OVERRIDES_OPTIONAL)[number]): number | undefined => row.float(col) ?? undefined;
  const axis = (col: 'a_pc' | 'b_pc' | 'c_pc'): number => row.requiredFloat(col);
  const name = row.text('name') ?? '';
  const result: OverrideRow = {
    name,
    axes: [axis('a_pc'), axis('b_pc'), axis('c_pc')],
    orient: row.text('orient') ?? '',
  };
  // Standalone position columns: all three must be present and
  // non-empty for the row to stand alone — partial population is a
  // config error worth surfacing.
  {
    const ra = optNum('ra_deg');
    const dec = optNum('dec_deg');
    const dist = optNum('distance_kpc');
    const count = [ra, dec, dist].filter((v) => v !== undefined).length;
    if (count > 0 && count < 3) {
      row.fail(
        `'${name}' partially populates standalone position (ra/dec/distance) — all three must be set together or all empty`,
      );
    }
    if (count === 3) {
      result.raDeg = ra;
      result.decDeg = dec;
      result.distanceKpc = dist;
    }
  }
  const mV = optNum('m_v');
  if (mV !== undefined) result.mV = mV;
  const profile = row.oneOf('profile', OVERRIDE_PROFILES);
  if (profile !== '') result.profile = profile;
  const nSersic = optNum('n_sersic');
  if (nSersic !== undefined) result.nSersic = nSersic;
  const rdPc = optNum('r_d_pc');
  if (rdPc !== undefined) result.rdPc = rdPc;
  {
    const bt = optNum('bulge_to_total');
    const re = optNum('bulge_re_pc');
    const bn = optNum('bulge_n');
    const count = [bt, re, bn].filter((v) => v !== undefined).length;
    if (count > 0 && count < 3) {
      row.fail(
        `'${name}' partially populates the bulge (bulge_to_total/bulge_re_pc/bulge_n) — all three must be set together or all empty`,
      );
    }
    if (count === 3) {
      result.bulgeToTotal = bt;
      result.bulgeRePc = re;
      result.bulgeN = bn;
    }
  }
  const color = opt('color');
  if (color !== undefined) result.color = color;
  return result;
}

/** Parse aliases.tsv: name<TAB>type[<TAB>alias1|alias2…[<TAB>canonical]].
 *  Comments and blank lines skipped; the first non-comment line is the
 *  header. Designations are normalised to their conventional form on the
 *  way in, so a curator writing "M 110" and "M110" in different columns
 *  still matches. A `canonical` naming no listed alias is a curation typo
 *  — the promoted name would be untypeable in search. */
const ALIAS_COLUMNS = ['name', 'type', 'aliases', 'canonical'] as const;

export function parseAliases(tsv: string, from: Declared): AliasRow[] {
  return [...readTable({ ...from, columns: ALIAS_COLUMNS, comments: true }, tsv)].map((row) => {
    const name = row.text('name') ?? '';
    const type = row.text('type');
    if (type === null) return row.fail(`'${name}' has an empty type`);
    const aliases = row.raw('aliases')
      .split('|')
      .map((s) => canonicalDesignation(s.trim()))
      .filter(Boolean);
    const canonical = canonicalDesignation(row.text('canonical') ?? '');
    if (canonical && !aliases.includes(canonical)) {
      row.fail(`'${name}' promotes '${canonical}', which is not one of its aliases`);
    }
    return {
      name,
      type,
      aliases,
      ...(canonical ? { canonical } : {}),
    };
  });
}
