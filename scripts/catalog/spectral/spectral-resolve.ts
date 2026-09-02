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
} from '../catalog-pure';
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
}

/** SIMBAD sp_type under all four namespaces. The HIP index carries the
 *  Gaia-saturated bright stars (Algol, Alsephina, ~700 others) whose SIMBAD
 *  row has a valid sp_type but no source_id; TYC is the only namespace
 *  reaching an object SIMBAD holds no Gaia id for at all. */
export type SimbadSpectralIndex = SimbadNamespaceIndex<SimbadSpectralRow>;

export function emptySimbadSpectralIndex(): SimbadSpectralIndex {
  return emptySimbadNamespaceIndex<SimbadSpectralRow>();
}

/** Parse the TSV produced by `scripts/refresh/refresh-simbad-sptype.py`
 *  into a `SimbadSpectralIndex`. source_id is kept as a string for the
 *  same > Number.MAX_SAFE_INTEGER reason that `parseGaiaApsisTsv` uses.
 *  A row is indexed under every namespace it carries; the 1,107 rows the
 *  pull enumerated by SIMBAD oid alone carry none and index nowhere. */
export function parseSimbadSptypeTsv(text: string): SimbadSpectralIndex {
  const index = emptySimbadSpectralIndex();
  const lines = text.split(/\r?\n/);
  const header = lines[0].split('\t').map((h) => h.trim());
  const idIdx = header.indexOf('source_id');
  const hipIdx = header.indexOf('hip');
  const tycIdx = header.indexOf('tyc');
  const gjIdx = header.indexOf('gj');
  const spTypeIdx = header.indexOf('sp_type');
  const spQualIdx = header.indexOf('sp_qual');
  const otypeIdx = header.indexOf('otype');
  const missing: string[] = [];
  if (idIdx < 0) missing.push('source_id');
  if (spTypeIdx < 0) missing.push('sp_type');
  if (missing.length) {
    throw new Error(
      `SIMBAD sptype TSV missing required columns: ${missing.join(', ')}. ` +
        `Re-run scripts/refresh/refresh-simbad-sptype.py.`,
    );
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const hipRaw = hipIdx >= 0 ? (cells[hipIdx] ?? '').trim() : '';
    const spType = (cells[spTypeIdx] ?? '').trim() || null;
    const spQual = spQualIdx >= 0 ? ((cells[spQualIdx] ?? '').trim() || null) : null;
    const otype = otypeIdx >= 0 ? ((cells[otypeIdx] ?? '').trim() || null) : null;
    const keys: SimbadRecordKeys = {
      sourceId: (cells[idIdx] ?? '').trim() || null,
      hip: hipRaw ? Number(hipRaw) : null,
      tyc: tycIdx >= 0 ? ((cells[tycIdx] ?? '').trim() || null) : null,
      gl: gjIdx >= 0 ? ((cells[gjIdx] ?? '').trim() || null) : null,
    };
    indexSimbadRow(
      index, keys, { spType, spQual, otype },
      // The pull unions namespaces, so one HIP or TYC reaches two SIMBAD
      // objects — a component-lettered entry carrying no sp_type beside the
      // star's own entry carrying the type. The row with the value wins,
      // which is the read side of "merge on non-empty value"
      // (scripts/refresh/simbad/README.md § The union asks every namespace a
      // record reaches). Two rows both stating a type cannot be ordered, and
      // that is a curation fault rather than a shape the union produces.
      (namespace, key, incumbent, candidate) => {
        if (incumbent.spType === null) return candidate;
        if (candidate.spType === null) return incumbent;
        throw new Error(
          `data/simbad/simbad_sptype.tsv has two rows keyed ${namespace}=${key}, `
            + `both stating a spectral type (${incumbent.spType} / `
            + `${candidate.spType}). Curate the pair or re-run `
            + `scripts/refresh/refresh-simbad-sptype.py.`,
        );
      },
    );
  }
  return index;
}

function matchSimbadRow(
  row: SimbadSpectralRow,
): { info: SpectralInfo; spectDisplay: string } | null {
  if (!row.spType) return null;
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
  // Castor A (α Gem) — SIMBAD * alf Gem A sp_type=A1.5IV+ (Gray+ 2003).
  [36850, 'A1.5IV'],
]);

export type SpectralSource = 'curated' | 'simbad' | 'gspspec' | 'fallback';

/** Seven-tier spectral resolver: a curated HIP override, the four SIMBAD
 *  namespaces in ladder order, Gaia DR3 GSP-Spec, then SPECTRAL_UNKNOWN.
 *  Which tier exists for which population is in `./README.md`
 *  § The resolver and the radius chain. */
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
  const hit = walkSimbadNamespaces(simbad, keys, matchSimbadRow);
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
