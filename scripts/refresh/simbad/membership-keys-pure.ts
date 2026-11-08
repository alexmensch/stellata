// The manifest's rows as SIMBAD request keys, and the per-field value cohort that narrows them. See README.md.

import type { GaiaAstrometryCatalogRow } from '../../catalog/sources/gaia-astrometry-source';
import type { ManifestRecord } from '../../catalog/membership/membership-manifest-tsv';
import { GAIA_DR3, WIDENING_LADDER, type LadderName } from './simbad-specs-pure';

export type Designations = Partial<Record<LadderName, string>>;

/** Manifest rows by the namespace each is looked up under: one key per row, so the lists plus `keyless` sum to the rows. */
export interface MembershipKeys {
  readonly sourceIds: readonly string[];
  readonly byNamespace: Readonly<Record<LadderName, readonly string[]>>;
  /** Each source_id-keyed row's other designations: its widening keys, read in the same pass so the two cover one cohort. */
  readonly designations: ReadonlyMap<string, Designations>;
  readonly keyless: number;
}

export type RowFilter = (record: ManifestRecord) => boolean;

/** The designation part of a manifest `gl` cell: `Gl 165A` and `GJ 165A` both give `165A`, which SIMBAD holds as `GJ 165A`. */
export function glSuffix(cell: string | null): string | null {
  const text = (cell ?? '').trim();
  const space = text.indexOf(' ');
  const word = space < 0 ? text : text.slice(0, space);
  if (word === 'GJ' || word === 'Gl') return text.slice(word.length).trim() || null;
  return text || null;
}

/** Every widening namespace the row carries a key for. Covers the whole ladder, or a rung finds no candidates and fails silently. */
export function rowDesignations(record: ManifestRecord): Designations {
  const out: Designations = {};
  if (record.hip !== null) out.hip = String(record.hip);
  const tyc = record.tyc?.trim();
  if (tyc) out.tyc = tyc;
  const gj = glSuffix(record.gl);
  if (gj !== null) out.gj = gj;
  return out;
}

/** A row with a `gaia_source_id` keys on it; the rest fall through `WIDENING_LADDER`, so the no-Gaia tier and the widening cannot disagree on order. */
export function membershipKeys(records: Iterable<ManifestRecord>, keep?: RowFilter): MembershipKeys {
  const sourceIds: string[] = [];
  const byNamespace: Record<LadderName, string[]> = { hip: [], tyc: [], gj: [] };
  const designations = new Map<string, Designations>();
  let keyless = 0;
  for (const record of records) {
    if (keep !== undefined && !keep(record)) continue;
    const own = rowDesignations(record);
    if (record.gaiaSourceId !== null) {
      sourceIds.push(record.gaiaSourceId);
      if (Object.keys(own).length > 0) designations.set(record.gaiaSourceId, own);
      continue;
    }
    const rung = WIDENING_LADDER.find((ns) => own[ns.name] !== undefined);
    if (rung === undefined) keyless++;
    else byNamespace[rung.name].push(own[rung.name] as string);
  }
  return { sourceIds, byNamespace, designations, keyless };
}

export const keyedRows = (keys: MembershipKeys): number => keys.sourceIds.length
  + Object.values(keys.byNamespace).reduce((n, list) => n + list.length, 0);

/** Every key the partition asks SIMBAD under, one line each: the projection of the manifest the pull's request hash covers. */
export function requestLines(keys: MembershipKeys): string[] {
  const lines = keys.sourceIds.map((sid) => {
    const own = keys.designations.get(sid) ?? {};
    const rest = (Object.keys(own) as LadderName[]).sort().map((name) => `${name}:${own[name]}`);
    return [`${GAIA_DR3.name}:${sid}`, ...rest].join(' ');
  });
  for (const ns of WIDENING_LADDER) for (const key of keys.byNamespace[ns.name]) lines.push(`${ns.name}:${key}`);
  return lines;
}

/** The binding a raw cross-walk reproduces (../../catalog/membership/README.md#the-spine-side). */
export const GATE_REPRODUCED_BINDING = 'crosswalk_gated';
/** The magnitude term's binding: the row is Gaia's own source. */
export const GAIA_NATIVE_BINDING = 'gaia_native';

/** Source_ids Gaia's 5p table states a parallax, both proper-motion components and a radial velocity for. */
export function gaiaCompleteSourceIds(catalog: ReadonlyMap<string, GaiaAstrometryCatalogRow>): Set<string> {
  const complete = new Set<string>();
  for (const [sourceId, row] of catalog) {
    if ([row.parallaxMas, row.pmraMasyr, row.pmdecMasyr, row.radialVelocityKmS].every((v) => v !== null)) complete.add(sourceId);
  }
  return complete;
}

const firstHandIdentity = (record: ManifestRecord): boolean => record.binding === GAIA_NATIVE_BINDING
  || (record.binding === GATE_REPRODUCED_BINDING && (record.tyc !== null || record.hip !== null));

/** In unless both halves of the first-hand claim hold: README.md#the-cohort-is-two-questions-and-the-manifest-answers-one. */
export function valueCohort(gaiaComplete: ReadonlySet<string>): RowFilter {
  return (record) => record.gaiaSourceId === null || !gaiaComplete.has(record.gaiaSourceId) || !firstHandIdentity(record);
}
