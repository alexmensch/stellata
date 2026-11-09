// Tokovinin's Multiple Star Catalogue: its three tables, the label → WDS token map, and the lookups Stages 2/4/6 join on.

import { DAYS_PER_JULIAN_YEAR, J2000_JD } from '../../../src/astro-core/astronomy-constants';
import { readTable } from '../../util/tsv/table-pure';
import type { Declared } from '../../util/sources/source';
import {
  childComponentTokens, componentKey, isComponentToken, tokenLetters, type ComponentKey,
} from '../component-tokens-pure';

export interface MscSystemRow {
  readonly wdsId: string;
  readonly prim: string;
  readonly sec: string;
  readonly parent: string;
  readonly obsType: string;
  readonly vmag1: number | null;
  readonly spt1: string;
  readonly vmag2: number | null;
  readonly spt2: string;
}

/** One MSC orbit. `t0` carries no unit flag: a Besselian year for visual
 *  orbits, JD − 2,400,000 for spectroscopic ones (`mscT0Jd` tells them apart). */
export interface MscOrbitRow {
  readonly wdsId: string;
  /** The pair label, `"Aa,Ab"`. */
  readonly syst: string;
  readonly per: number | null;
  readonly perUnit: string;
  readonly t0: number | null;
  readonly e: number | null;
  readonly aArcsec: number | null;
  readonly nodeDeg: number | null;
  readonly longpDeg: number | null;
  readonly inclDeg: number | null;
  readonly note: string;
}

/** One per-component row; its top-level labels already follow WDS. */
export interface MscComponentRow {
  readonly wdsId: string;
  readonly comp: string;
  readonly spt: string;
  readonly vmag: number | null;
}

/** An MSC orbit set keyed by the WDS tokens of its pair, in the pair's own
 *  (primary, secondary) order. */
export interface MscPairOrbits {
  readonly wdsId: string;
  readonly primary: string;
  readonly secondary: string;
  /** Every edition of the pair's orbit, in file order. */
  readonly rows: readonly MscOrbitRow[];
}

export interface MscPairMags {
  readonly vmagPri: number | null;
  readonly vmagSec: number | null;
}

export interface MscLookup {
  readonly orbitsByPair: ReadonlyMap<MscPairKey, MscPairOrbits>;
  readonly pairMags: ReadonlyMap<MscPairKey, MscPairMags>;
  /** The MK type of one component. */
  readonly spectByComp: ReadonlyMap<ComponentKey, string>;
  readonly nOrbitsUnmapped: number;
}

/** A `parent` with no enclosing component: `*` is the system root; `t` and
 *  `X` mark ties whose sides carry WDS-consistent labels directly. */
export const MSC_ROOT_PARENT_LABELS: ReadonlySet<string> = new Set(['*', 't', 'X', '']);

/** A year reading is at most this; a larger `t0` can only be a truncated JD. */
export const MSC_T0_YEAR_MAX = 3000.0;
export const TRUNCATED_JD_TO_JD_OFFSET = 2400000.0;
/** A fitted periastron epoch outside Besselian ≈1700-2600 is a misread unit. */
export const T0_MIN_PLAUSIBLE_JD = J2000_JD + (1700.0 - 2000.0) * DAYS_PER_JULIAN_YEAR;
export const T0_MAX_PLAUSIBLE_JD = J2000_JD + (2600.0 - 2000.0) * DAYS_PER_JULIAN_YEAR;

declare const MSC_PAIR: unique symbol;
/** An MSC pair by the WDS tokens of its sides, in order. */
export type MscPairKey = string & { readonly [MSC_PAIR]: true };

export function mscPairKey(wdsId: string, primary: string, secondary: string): MscPairKey {
  return `${wdsId}\t${primary}\t${secondary}` as MscPairKey;
}

function orEmpty(v: string | null): string {
  return v ?? '';
}

export function parseMscSystems(text: string, from: Declared): MscSystemRow[] {
  const out: MscSystemRow[] = [];
  const columns = ['wds_id', 'prim', 'sec', 'parent', 'obs_type', 'vmag1', 'spt1', 'vmag2', 'spt2'] as const;
  for (const row of readTable({ ...from, columns }, text)) {
    const wdsId = row.text('wds_id');
    const prim = row.text('prim');
    const sec = row.text('sec');
    if (wdsId === null || prim === null || sec === null) continue;
    out.push({
      wdsId, prim, sec,
      parent: orEmpty(row.text('parent')),
      obsType: orEmpty(row.text('obs_type')),
      vmag1: row.float('vmag1'),
      spt1: orEmpty(row.text('spt1')),
      vmag2: row.float('vmag2'),
      spt2: orEmpty(row.text('spt2')),
    });
  }
  return out;
}

export function parseMscOrbits(text: string, from: Declared): MscOrbitRow[] {
  const out: MscOrbitRow[] = [];
  const columns = [
    'wds_id', 'syst', 'per', 'per_unit', 't0', 'e', 'a_arcsec', 'node_deg', 'longp_deg', 'incl_deg', 'note',
  ] as const;
  for (const row of readTable({ ...from, columns }, text)) {
    const wdsId = row.text('wds_id');
    const syst = row.text('syst');
    if (wdsId === null || syst === null) continue;
    out.push({
      wdsId, syst,
      per: row.float('per'),
      perUnit: orEmpty(row.text('per_unit')),
      t0: row.float('t0'),
      e: row.float('e'),
      aArcsec: row.float('a_arcsec'),
      nodeDeg: row.float('node_deg'),
      longpDeg: row.float('longp_deg'),
      inclDeg: row.float('incl_deg'),
      note: orEmpty(row.text('note')),
    });
  }
  return out;
}

export function parseMscComponents(text: string, from: Declared): MscComponentRow[] {
  const out: MscComponentRow[] = [];
  for (const row of readTable({ ...from, columns: ['wds_id', 'comp', 'spt', 'vmag'] as const }, text)) {
    const wdsId = row.text('wds_id');
    const comp = row.text('comp');
    if (wdsId === null || comp === null) continue;
    out.push({ wdsId, comp, spt: orEmpty(row.text('spt')), vmag: row.float('vmag') });
  }
  return out;
}

/** A label that is a valid WDS token as written: one component (`A`, `Aa`,
 *  `Aa1`) or an all-caps compound (`AB`). A union label like `Aab` is not. */
function isWdsShaped(label: string): boolean {
  return label !== '' && (isComponentToken(label) || (label.length >= 2 && /^[A-Z]+$/.test(label)));
}

function isSubset(inner: ReadonlySet<string>, outer: ReadonlySet<string>): boolean {
  for (const l of inner) if (!outer.has(l)) return false;
  return true;
}

/** One system's MSC label → WDS token map, walked top-down. Root sides map to
 *  themselves; a pair subdividing a mapped component takes that component's
 *  WDS child tokens positionally (`Aab,Ac` under `A` → Aa, Ab); a pair
 *  subdividing a compound keeps sides that are the compound's own letters.
 *  A side no rule fits stays unmapped, and its subtree with it. */
export function mapMscLabels(pairRows: readonly MscSystemRow[]): Map<string, string> {
  const mapping = new Map<string, string>();
  const setDefault = (label: string, token: string): void => {
    if (!mapping.has(label)) mapping.set(label, token);
  };
  let pending = [...pairRows];
  while (pending.length > 0) {
    const remaining: MscSystemRow[] = [];
    let progressed = false;
    for (const row of pending) {
      const base = mapping.get(row.parent);
      if (MSC_ROOT_PARENT_LABELS.has(row.parent)) {
        for (const side of [row.prim, row.sec]) if (isWdsShaped(side)) setDefault(side, side);
      } else if (base !== undefined) {
        if (isComponentToken(base)) {
          const children = childComponentTokens(base);
          if (children !== null) {
            setDefault(row.prim, children[0]);
            setDefault(row.sec, children[1]);
          }
        } else {
          const baseLetters = tokenLetters(base);
          for (const side of [row.prim, row.sec]) {
            if (isWdsShaped(side) && isSubset(tokenLetters(side), baseLetters)) setDefault(side, side);
          }
        }
      } else {
        remaining.push(row);
        continue;
      }
      progressed = true;
    }
    if (!progressed) break;
    pending = remaining;
  }
  return mapping;
}

export function buildMscLookup(
  systems: readonly MscSystemRow[],
  orbits: readonly MscOrbitRow[],
  components: readonly MscComponentRow[],
): MscLookup {
  const systemsByWds = new Map<string, MscSystemRow[]>();
  for (const row of systems) {
    const list = systemsByWds.get(row.wdsId);
    if (list) list.push(row);
    else systemsByWds.set(row.wdsId, [row]);
  }
  const labelMaps = new Map<string, Map<string, string>>();
  for (const [wdsId, rows] of systemsByWds) labelMaps.set(wdsId, mapMscLabels(rows));
  const tokenOf = (wdsId: string, label: string): string | undefined => labelMaps.get(wdsId)?.get(label);

  const orbitsByPair = new Map<MscPairKey, { wdsId: string; primary: string; secondary: string; rows: MscOrbitRow[] }>();
  let nOrbitsUnmapped = 0;
  for (const row of orbits) {
    const parts = row.syst.split(',');
    const primary = parts.length === 2 ? tokenOf(row.wdsId, parts[0].trim()) : undefined;
    const secondary = parts.length === 2 ? tokenOf(row.wdsId, parts[1].trim()) : undefined;
    if (primary === undefined || secondary === undefined || primary === secondary) {
      nOrbitsUnmapped++;
      continue;
    }
    const key = mscPairKey(row.wdsId, primary, secondary);
    const entry = orbitsByPair.get(key);
    if (entry) entry.rows.push(row);
    else orbitsByPair.set(key, { wdsId: row.wdsId, primary, secondary, rows: [row] });
  }

  const pairMags = new Map<MscPairKey, MscPairMags>();
  const spectByComp = new Map<ComponentKey, string>();
  for (const row of systems) {
    const primary = tokenOf(row.wdsId, row.prim);
    const secondary = tokenOf(row.wdsId, row.sec);
    if (primary === undefined || secondary === undefined) continue;
    const key = mscPairKey(row.wdsId, primary, secondary);
    if ((row.vmag1 !== null || row.vmag2 !== null) && !pairMags.has(key)) {
      pairMags.set(key, { vmagPri: row.vmag1, vmagSec: row.vmag2 });
    }
    for (const [token, spt] of [[primary, row.spt1], [secondary, row.spt2]] as const) {
      const compKey = componentKey(row.wdsId, token);
      if (spt && isComponentToken(token) && !spectByComp.has(compKey)) spectByComp.set(compKey, spt);
    }
  }
  for (const row of components) {
    if (row.spt && isComponentToken(row.comp)) spectByComp.set(componentKey(row.wdsId, row.comp), row.spt);
  }
  return { orbitsByPair, pairMags, spectByComp, nOrbitsUnmapped };
}

/** `per` in days; null for an unknown unit or a non-positive period — no
 *  orbit beats one at the wrong time scale. */
export function mscPeriodDays(row: MscOrbitRow): number | null {
  if (row.per === null || row.per <= 0.0) return null;
  if (row.perUnit === 'd') return row.per;
  if (row.perUnit === 'y') return row.per * DAYS_PER_JULIAN_YEAR;
  return null;
}

/** MSC's periastron epoch as an absolute JD: a plausible year through the
 *  J2000 anchor, otherwise a truncated JD; null when neither reading is. */
export function mscT0Jd(t0: number | null): number | null {
  if (t0 === null) return null;
  if (t0 <= MSC_T0_YEAR_MAX) {
    const yearJd = J2000_JD + (t0 - 2000.0) * DAYS_PER_JULIAN_YEAR;
    if (T0_MIN_PLAUSIBLE_JD <= yearJd && yearJd <= T0_MAX_PLAUSIBLE_JD) return yearJd;
  }
  const truncatedJd = t0 + TRUNCATED_JD_TO_JD_OFFSET;
  return T0_MIN_PLAUSIBLE_JD <= truncatedJd && truncatedJd <= T0_MAX_PLAUSIBLE_JD ? truncatedJd : null;
}

/** P, T and e present, and ω unless the fit is exactly circular — the
 *  elements an orbit needs to animate (Stage 6 supplies a circular ω). */
export function mscRenderable(row: MscOrbitRow): boolean {
  return mscPeriodDays(row) !== null
    && mscT0Jd(row.t0) !== null
    && row.e !== null
    && (row.longpDeg !== null || row.e === 0.0);
}
