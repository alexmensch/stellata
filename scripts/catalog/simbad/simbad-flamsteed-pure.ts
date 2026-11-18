// Which of SIMBAD's `* NN Con` numbers count as Flamsteed numbers, held against IV/27A. See README.md#which-simbad-numbers-are-flamsteed-numbers.

import { CON_INDEX } from '../parse/constellations/constellations';
import type { CrossIndexRow } from '../classic-ids/classic-ids-parse';

/** One object of data/simbad/simbad_idents.tsv, as the Flamsteed rule reads it. */
export interface SimbadIdentsObject {
  readonly oid: number;
  readonly hips: readonly number[];
  readonly hds: readonly number[];
  readonly sourceIds: readonly string[];
  readonly idents: readonly string[];
}

export interface FlamsteedDesignation {
  readonly number: number;
  /** IAU abbreviation as SIMBAD spells it (`UMa`). */
  readonly con: string;
  /** In the `CONSTELLATIONS` index space. */
  readonly conIndex: number;
}

export const FLAMSTEED_REFUSALS = ['beyond_iv27a_range', 'iv27a_names_another_star'] as const;
export type FlamsteedRefusalReason = (typeof FLAMSTEED_REFUSALS)[number];

export interface FlamsteedRefusal {
  readonly object: SimbadIdentsObject;
  readonly designation: FlamsteedDesignation;
  readonly reason: FlamsteedRefusalReason;
  /** What IV/27A says against it, in words a ledger row carries. */
  readonly evidence: string;
}

export interface SimbadFlamsteed {
  /** Accepted designations by the object's own HIP / HD. */
  readonly byHip: ReadonlyMap<number, readonly FlamsteedDesignation[]>;
  readonly byHd: ReadonlyMap<number, readonly FlamsteedDesignation[]>;
  readonly refused: readonly FlamsteedRefusal[];
}

const NUMBERED = /^\* (\d+) ([A-Z][A-Za-z]{2})$/;

/** A `* NN Con` ident as a number and an IAU-88 constellation, or null for any other `*` ident (a Bayer letter). */
export function numberedDesignation(ident: string): FlamsteedDesignation | null {
  const m = NUMBERED.exec(ident);
  if (m === null) return null;
  const conIndex = CON_INDEX.get(m[2].toLowerCase());
  if (conIndex === undefined) throw new Error(`SIMBAD ident ${JSON.stringify(ident)} names no IAU-88 constellation`);
  return { number: Number(m[1]), con: m[2], conIndex };
}

export const designationText = (d: FlamsteedDesignation): string => `${d.number} ${d.con}`;

interface Iv27aFlamsteed {
  /** Highest Flamsteed number IV/27A publishes per constellation (lowercase abbreviation). */
  readonly maxByCon: ReadonlyMap<string, number>;
  /** `<number> <con lowercase>` → the IV/27A rows carrying it. */
  readonly holders: ReadonlyMap<string, readonly CrossIndexRow[]>;
}

const holderKey = (number: number, con: string): string => `${number} ${con.toLowerCase()}`;

function iv27aFlamsteed(rows: readonly CrossIndexRow[]): Iv27aFlamsteed {
  const maxByCon = new Map<string, number>();
  const holders = new Map<string, CrossIndexRow[]>();
  for (const row of rows) {
    if (row.flamsteed === null || row.cst === null) continue;
    const con = row.cst.toLowerCase();
    maxByCon.set(con, Math.max(maxByCon.get(con) ?? 0, row.flamsteed));
    const key = holderKey(row.flamsteed, con);
    holders.set(key, [...(holders.get(key) ?? []), row]);
  }
  return { maxByCon, holders };
}

function verdict(object: SimbadIdentsObject, d: FlamsteedDesignation, iv27a: Iv27aFlamsteed): Omit<FlamsteedRefusal, 'object' | 'designation'> | null {
  const max = iv27a.maxByCon.get(d.con.toLowerCase());
  if (max === undefined) return { reason: 'beyond_iv27a_range', evidence: `IV/27A publishes no Flamsteed number in ${d.con}` };
  if (d.number > max) return { reason: 'beyond_iv27a_range', evidence: `IV/27A's highest ${d.con} Flamsteed number is ${max}` };
  const holders = iv27a.holders.get(holderKey(d.number, d.con)) ?? [];
  const other = holders.find((r) => !object.hds.includes(r.hd) && (r.hip === null || !object.hips.includes(r.hip)));
  const own = holders.some((r) => object.hds.includes(r.hd) || (r.hip !== null && object.hips.includes(r.hip)));
  return other !== undefined && !own ? { reason: 'iv27a_names_another_star', evidence: `IV/27A gives ${designationText(d)} to HD ${other.hd}` } : null;
}

function push<K>(into: Map<K, FlamsteedDesignation[]>, key: K, d: FlamsteedDesignation): void {
  const held = into.get(key);
  if (held === undefined) into.set(key, [d]);
  else if (!held.some((h) => h.number === d.number && h.conIndex === d.conIndex)) held.push(d);
}

export function classifySimbadFlamsteed(objects: Iterable<SimbadIdentsObject>, crossIndex: readonly CrossIndexRow[]): SimbadFlamsteed {
  const iv27a = iv27aFlamsteed(crossIndex);
  const byHip = new Map<number, FlamsteedDesignation[]>();
  const byHd = new Map<number, FlamsteedDesignation[]>();
  const refused: FlamsteedRefusal[] = [];
  for (const object of objects) {
    for (const ident of object.idents) {
      const designation = numberedDesignation(ident);
      if (designation === null) continue;
      const refusal = verdict(object, designation, iv27a);
      if (refusal !== null) {
        refused.push({ object, designation, ...refusal });
        continue;
      }
      for (const hip of object.hips) push(byHip, hip, designation);
      for (const hd of object.hds) push(byHd, hd, designation);
    }
  }
  return { byHip, byHd, refused };
}

/** The accepted designation numbered `number` SIMBAD gives the star by its HD, else by its HIP. */
export function acceptedFlamsteed(index: SimbadFlamsteed, hd: number | null, hip: number | null, number: number): FlamsteedDesignation | undefined {
  const numbered = (ds: readonly FlamsteedDesignation[] | undefined) => ds?.find((d) => d.number === number);
  return (hd === null ? undefined : numbered(index.byHd.get(hd))) ?? (hip === null ? undefined : numbered(index.byHip.get(hip)));
}
