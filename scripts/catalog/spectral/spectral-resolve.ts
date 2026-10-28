// The seven-tier spectral resolver and the SIMBAD sp_type index it walks.
// See README.md.

import {
  emptySimbadNamespaceIndex,
  indexSimbadRow,
  simbadHipKey,
  walkSimbadNamespaces,
  type ApsisRow,
  type SimbadNamespace,
  type SimbadNamespaceIndex,
  type SimbadRecordKeys,
} from '../record/catalog-pure';
import type { SimbadXids } from '../spine/primaries-audit-pure';
import type { Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import {
  classifyFromGspspec,
  classifyFromSimbad,
  SPECTRAL_UNKNOWN,
  type SpectralInfo,
} from './spectral-classify';

/** Per-source SIMBAD spectral-classification row from
 *  `data/simbad/simbad_sptype.tsv`. `spType` is the canonical
 *  Morgan-Keenan string (free of variability-type contamination by
 *  SIMBAD's schema split). `spQual` is the per-row quality letter
 *  (A=best, … E=worst); `otype` is SIMBAD's object-type classification
 *  (separate column — never bleeds into sp_type). Both carried for
 *  display + future filtering, but the spectral resolver consumes only
 *  spType. */
export interface SimbadSpectralRow {
  spType: string | null;
  spQual: string | null;
  otype: string | null;
  /** SIMBAD's own Gaia DR3 id for the object. A designation tier reaching a
   *  row that states a DIFFERENT one has reached another star — see
   *  README.md#a-stated-gaia-id-the-record-contradicts-ends-the-walk. */
  sourceId: string | null;
}

/** SIMBAD sp_type under all four namespaces. */
export type SimbadSpectralIndex = SimbadNamespaceIndex<SimbadSpectralRow>;

export function emptySimbadSpectralIndex(): SimbadSpectralIndex {
  return emptySimbadNamespaceIndex<SimbadSpectralRow>();
}

/** Parses the TSV `scripts/refresh/refresh-simbad-sptype.py` produces.
 *  source_id is kept as a string for the same > Number.MAX_SAFE_INTEGER
 *  reason `parseGaiaApsisTsv` uses. A row is indexed under every namespace it
 *  carries; the rows the pull enumerated by SIMBAD oid alone carry none and
 *  index nowhere. */
const SPTYPE_TABLE_COLUMNS = ['source_id', 'sp_type', 'hip', 'tyc', 'gj', 'sp_qual', 'otype'] as const;

export interface SimbadSptype {
  spectral: SimbadSpectralIndex;
  xids: Map<string, SimbadXids>;
}

export function parseSimbadSptypeTsv(text: string, from: Declared): SimbadSptype {
  const index = emptySimbadSpectralIndex();
  const xids = new Map<string, SimbadXids>();
  for (const row of readTable({ ...from, columns: SPTYPE_TABLE_COLUMNS }, text)) {
    const spType = row.text('sp_type');
    const spQual = row.text('sp_qual');
    const otype = row.text('otype');
    const keys: SimbadRecordKeys = {
      sourceId: row.sourceId('source_id'),
      hip: row.int('hip'),
      tyc: row.text('tyc'),
      gl: row.text('gj'),
    };
    indexSimbadRow(
      index, keys, { spType, spQual, otype, sourceId: keys.sourceId },
      // No key repeats in the committed file (../naming/README.md#the-union-policy
      // adds rows,
      // never a second row under one key). On a designation key the row stating
      // a type is the verdict a pull that did emit two would need; two rows both
      // stating one cannot be ordered here and are a curation fault.
      (namespace, key, incumbent, candidate) => {
        if (namespace === 'source_id') {
          throw new Error(`${from.file} has two rows keyed source_id=${key}. ${from.hint}`);
        }
        if (incumbent.spType === null) return candidate;
        if (candidate.spType === null) return incumbent;
        throw new Error(
          `${from.file} has two rows keyed ${namespace}=${key}, `
            + `both stating a spectral type (${incumbent.spType} / `
            + `${candidate.spType}). Curate the pair or ${from.hint}`,
        );
      },
    );
    if (keys.sourceId !== null) {
      xids.set(keys.sourceId, { hip: keys.hip, tyc: row.raw('tyc') || null, gj: row.raw('gj') || null });
    }
  }
  return { spectral: index, xids };
}

/** A row is this record's only while nothing in it says otherwise. Both ids
 *  present and differing is SIMBAD stating they are separate stars, so the
 *  match is refused and the walk continues — the read side of the pull's
 *  corroboration rule (README.md#a-stated-gaia-id-the-record-contradicts-ends-the-walk).
 * On the source_id tier the two are equal by construction. */
function matchSimbadRow(
  row: SimbadSpectralRow,
  recordSourceId: string | null,
): { info: SpectralInfo; spectDisplay: string } | null {
  if (!row.spType) return null;
  if (recordSourceId && row.sourceId && row.sourceId !== recordSourceId) return null;
  const info = classifyFromSimbad(row.spType);
  return info ? { info, spectDisplay: row.spType } : null;
}

/** Curated HIP → MK type for saturated stars whose SIMBAD entry is a
 *  component-lettered main_id ("* alf Gem A") carrying neither hip nor
 *  source_id, so both machine tiers miss and the record would fall to
 *  the 5000 K unknown class (inflating physicalRadius ~3×). Mirrors the
 *  binaries pipeline's component_sptype_overrides.tsv curated tier;
 *  literature citation per entry. */
export const CURATED_SPTYPE_BY_HIP: ReadonlyMap<number, string> = new Map([
  // Castor A (α Gem) — SIMBAD * alf Gem A sp_type=A1.5IV+ (Gray 2003
  // (/data/papers/index.md#gray2003)).
  [36850, 'A1.5IV+'],
]);

export type SpectralSource = 'curated' | 'simbad' | 'gspspec' | 'fallback';

/** Seven-tier spectral resolver: a curated HIP override, the four SIMBAD
 *  namespaces in ladder order, Gaia DR3 GSP-Spec, then SPECTRAL_UNKNOWN.
 *  Which tier exists for which population is in `./README.md#the-resolver-and-the-radius-chain`.
 * */
export function resolveSpectralInfo(
  keys: SimbadRecordKeys,
  simbad: SimbadSpectralIndex,
  apsisMap: Map<string, ApsisRow>,
): {
  info: SpectralInfo;
  source: SpectralSource;
  spectDisplay: string | null;
  simbadKey?: SimbadNamespace;
} {
  const hip = simbadHipKey(keys.hip);
  if (hip !== null) {
    const curated = CURATED_SPTYPE_BY_HIP.get(hip);
    const info = curated ? classifyFromSimbad(curated) : null;
    if (curated && info) {
      return { info, source: 'curated', spectDisplay: curated };
    }
  }
  const hit = walkSimbadNamespaces(
    simbad, keys, (row) => matchSimbadRow(row, keys.sourceId),
  );
  if (hit) {
    return { ...hit.value, source: 'simbad', simbadKey: hit.namespace };
  }
  if (keys.sourceId) {
    const apsis = apsisMap.get(keys.sourceId);
    if (apsis?.spectraltypeEsphs) {
      const info = classifyFromGspspec(apsis.spectraltypeEsphs);
      if (info) return { info, source: 'gspspec', spectDisplay: apsis.spectraltypeEsphs };
    }
  }
  return { info: SPECTRAL_UNKNOWN, source: 'fallback', spectDisplay: null };
}
