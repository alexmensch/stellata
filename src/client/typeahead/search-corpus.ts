// The fuzzy corpus and the exact-match identifier maps behind star search.
// A leaf module: no THREE, no Stellata, so the build's parity gate can
// import it. See README.md § Star search.

import {
  buildAliasedIdIndex,
  designationConIndex,
  NO_CONSTELLATION_INDEX,
  type SearchEntry,
} from '../../../scripts/catalog/catalog-pure';
import { GREEK_SPELLINGS } from '../../../scripts/catalog/naming/greek-forms';
import {
  bayerDesignation,
  displayNamesFromSearchIndex,
  gouldDesignation,
} from '../../../scripts/catalog/naming/star-naming-pure';
import { formatGcvsDesignation } from './star-designations';
import type { TargetKind } from '../camera/focus/focus-target';

type EntryKind = TargetKind;

export interface FuzzyEntry {
  kind: EntryKind;
  index: number;
  label: string;        // what Fuse matches on
  primary: string;      // shown in dropdown primary line
  displayCon: string;   // shown in dropdown secondary line
  /** Label is a constellation-name expansion ("Gamma Andromeda",
   *  "V366 Andromeda", "20 Andromeda") — kept fuzzy-searchable but
   *  ranked below plain names/aliases at equal score, so a query that
   *  IS a constellation name surfaces the objects named for it (the
   *  Andromeda Galaxy) above every star in the constellation. */
  conExpansion?: boolean;
}

// Canonical Gliese lookup key: strip a leading Gl/GJ/Gliese prefix and all
// whitespace, lowercase. "Gliese" precedes "Gl" in the alternation so it
// isn't clipped to a stray "iese". Shared by the index builder (keys the
// map from the stored `gl` field) and the query dispatcher (keys the typed
// query) so "Gl 551" / "GJ 551" / "Gliese 551" all resolve one star.
export function normalizeGlKey(raw: string): string {
  return raw.replace(/^\s*(?:Gliese|GJ|Gl)\s*/i, '').replace(/\s+/g, '').toLowerCase();
}

// Each Bayer'd star gets several fuzzy-index entries so the user can type any
// of "Alpha Cen", "Alp Cen", "Alf Cen", "α Cen", or "Alpha Centaurus" and
// find the star. Every spelling is DERIVED from the glyph the wire carries
// (docs/star-naming.md § 5) — `GREEK_SPELLINGS` is the one table, shared
// with the build's normalisers, so a convention added for either side
// reaches both. The Latin overflow series (p Eri, A Aqr) has no ASCII
// alternative and emits the letter alone.
//
// The superscript is deliberately NOT in the search labels — users type
// "Alpha Cen" to mean the system, not "Alpha 1 Cen". Both α¹ and α² emit the
// same labels and both appear in the results, letting the user pick; the
// display form keeps the superscript to disambiguate.
export function buildBayerLabels(
  glyph: string,
  conCode: string,
  conName: string,
): string[] {
  const labels = new Set<string>([`${glyph} ${conCode}`, `${glyph} ${conName}`]);
  const spellings = GREEK_SPELLINGS[glyph];
  if (spellings === undefined) return [...labels];
  labels.add(`${spellings.full} ${conCode}`);
  labels.add(`${spellings.full} ${conName}`);
  labels.add(`${spellings.abbr} ${conCode}`);
  for (const variant of spellings.variants) {
    const titled = variant.charAt(0).toUpperCase() + variant.slice(1);
    labels.add(`${titled} ${conCode}`);
    labels.add(`${titled} ${conName}`);
  }
  return [...labels];
}

// Fuzzy-search labels for a GCVS designation: the designation itself
// (V-number padding stripped) plus a constellation-name-expanded variant
// (trailing IAU abbreviation → full name), mirroring buildBayerLabels so
// "V645 Cen" and "V645 Centaurus" both resolve.
//
// The expansion is gated on the trailing token actually BEING this entry's
// constellation abbreviation, not on the entry having a constellation at all.
// 6,079 of the 14,148 GCVS-named entries end in something else — NSV serials
// ("NSV 04199") and Magellanic field numbers ("LMC V0471") — and rewriting
// that token invented "NSV Lupus" and "LMC Dorado": a designation that does
// not exist, in a constellation the number has nothing to do with.
export function buildGcvsLabels(
  designation: string,
  conCode: string,
  conName: string,
): string[] {
  const desig = formatGcvsDesignation(designation);
  const labels = new Set<string>([desig]);
  const trailing = desig.split(/\s+/).pop() ?? '';
  if (conCode && conName && trailing.toLowerCase() === conCode.toLowerCase()) {
    labels.add(desig.replace(/\s+\S+$/, ` ${conName}`));
  }
  return [...labels];
}

// Search labels for a multiple-star component: "<system designation> <letter>"
// across every Bayer variant of the SYSTEM PRIMARY ("α Cen C", "Alpha Cen C",
// "Alf Cen C", …) plus the Flamsteed form, so "Alpha Centauri C" focuses
// Proxima. The base is the primary's designation because a component often
// carries none of its own (Proxima has no Bayer). Proper names are excluded
// on purpose: the primary's proper (Rigil Kentaurus) names component A, not
// the system, so "Rigil Kentaurus C" would be wrong.
export function buildComponentLabels(
  primary: SearchEntry,
  conCode: string,
  conName: string,
  comp: string,
): string[] {
  const labels = new Set<string>();
  if (primary.b && conCode) {
    for (const base of buildBayerLabels(primary.b, conCode, conName)) {
      labels.add(`${base} ${comp}`);
    }
  }
  if (primary.f !== undefined && conCode) {
    labels.add(`${primary.f} ${conCode} ${comp}`);
    labels.add(`${primary.f} ${conName} ${comp}`);
  }
  if (primary.gd !== undefined && conCode) {
    labels.add(`${gouldDesignation(primary.gd, primary.gh, conCode)} ${comp}`);
  }
  return [...labels];
}

export interface SearchIndex {
  fuzzyEntries: FuzzyEntry[];
  hipMap: Map<number, number>;
  hdMap: Map<number, number>;
  hrMap: Map<number, number>;
  glMap: Map<string, number>;
  // Flamsteed keys map to every component sharing that number+constellation,
  // so an exact "61 Cyg" query returns each of A/B/C… rather than collapsing
  // to whichever star was indexed last.
  flamMap: Map<string, FuzzyEntry[]>;
}

// Build the direct-lookup maps + the fuzzy-search corpus (star entries only;
// callers append cloud entries). The display form is the display-name
// composer's, so a dropdown row reads exactly what the focus card and the
// chart label read; where a star carries both a name and a Bayer
// designation the row shows "ProperName (α¹ Cen)". The Bayer portion keeps
// its superscript to disambiguate α¹ / α² even though the search labels
// drop it (see buildBayerLabels).
export function buildSearchIndex(
  raw: SearchEntry[],
  constellations: { code: string; name: string }[],
): SearchIndex {
  const hipMap = new Map<number, number>();
  // HD and HR are the two identifiers a record can answer to under more than
  // one number, so they carry a precedence rule the other maps do not need.
  const hdMap = buildAliasedIdIndex(raw, (e) => e.hd, (e) => e.hda);
  const hrMap = buildAliasedIdIndex(raw, (e) => e.hr, (e) => e.hra);
  const glMap = new Map<string, number>();
  const flamMap = new Map<string, FuzzyEntry[]>();
  const fuzzyEntries: FuzzyEntry[] = [];

  // Component aliases (below) read the system primary's designation by its
  // record index (SearchEntry.cp), so index the corpus up front.
  const byIndex = new Map<number, SearchEntry>();
  for (const entry of raw) byIndex.set(entry.i, entry);

  // One composer pass over the corpus: a component borrows its WDS root
  // anchor's base and a letter is appended only where the designation fails
  // to single the star out, so both rules need every entry in hand
  // (docs/star-naming.md § 6).
  const composed = displayNamesFromSearchIndex(raw, constellations);

  const addFlam = (key: string, e: FuzzyEntry) => {
    const arr = flamMap.get(key);
    if (arr) arr.push(e);
    else flamMap.set(key, [e]);
  };

  for (const entry of raw) {
    if (entry.hip !== undefined) hipMap.set(entry.hip, entry.i);
    if (entry.gl !== undefined) {
      const norm = normalizeGlKey(entry.gl);
      if (norm) glMap.set(norm, entry.i);
    }

    // Every alias below is a DESIGNATION, so it is built against the
    // designation's constellation; `displayCon` is the dropdown's context
    // line and stays positional. The two differ only where a boundary has
    // moved past a named star (ρ Aql reads Delphinus, searches as 67 Aql).
    const desigConIdx = designationConIndex(entry.dc, entry.c);
    const con = desigConIdx !== NO_CONSTELLATION_INDEX ? constellations[desigConIdx] : null;
    const conCode = con?.code ?? '';
    const conName = con?.name ?? '';
    const posConIdx = entry.c ?? NO_CONSTELLATION_INDEX;
    const displayCon = posConIdx !== NO_CONSTELLATION_INDEX
      ? constellations[posConIdx]?.name ?? '' : '';

    const isConExpansion = (label: string): boolean =>
      conName !== '' && label.includes(conName);

    const properName = entry.p ?? null;
    const bayerDisplay = entry.b && conCode
      ? bayerDesignation(entry.b, entry.bx, conCode) : null;
    const display = composed.get(entry.i);
    const primary = properName !== null && bayerDisplay !== null
      ? `${properName} (${bayerDisplay})`
      : display?.label ?? null;
    // The composed label is fuzzy-indexed only where no other path emits
    // it: a NAME, or a component composite ("θ¹ Ori C", "HIP 82676 Ab")
    // that exists nowhere else. Every bare designation is already reached
    // by its own tier's derived labels or its exact-match map, and
    // fuzzy-indexing 300k catalogue numbers would only dilute the corpus.
    const indexDisplay = display !== undefined
      && (properName !== null || display.lettered || display.borrowed);
    const hasNamedDisplay = properName !== null || bayerDisplay !== null;

    if (primary !== null) {
      if (indexDisplay) {
        fuzzyEntries.push({
          kind: 'star', index: entry.i, label: display!.label, primary, displayCon,
        });
      }
      // Published spellings the ladder displaced. Only strings no structure
      // implies reach the wire; every derivable form is derived below.
      for (const alias of entry.al ?? []) {
        fuzzyEntries.push({ kind: 'star', index: entry.i, label: alias, primary, displayCon });
      }
      if (entry.b && conCode) {
        for (const label of buildBayerLabels(entry.b, conCode, conName)) {
          fuzzyEntries.push({
            kind: 'star', index: entry.i, label, primary, displayCon,
            conExpansion: isConExpansion(label),
          });
        }
      }
      if (entry.gd !== undefined && conCode) {
        fuzzyEntries.push({
          kind: 'star', index: entry.i, primary, displayCon,
          label: gouldDesignation(entry.gd, entry.gh, conCode),
        });
      }
    }

    // GCVS variable-star designations (R CrB, VY CMa, V645 Cen). Emitted for
    // every named variable (~14.1k, a superset of the period-matched set) —
    // many (VY CMa, RR Lyr) carry no proper/Bayer/Flamsteed name and are
    // otherwise findable only by HIP/HD, so the primary line falls back to the
    // designation for those.
    if (entry.g) {
      const gcvsPrimary = primary ?? formatGcvsDesignation(entry.g);
      for (const label of buildGcvsLabels(entry.g, conCode, conName)) {
        fuzzyEntries.push({
          kind: 'star', index: entry.i, label, primary: gcvsPrimary, displayCon,
          conExpansion: isConExpansion(label),
        });
      }
    }

    // Multiple-star component aliases: "<system> <letter>" → this component.
    // Base designation comes from the system primary (entry.cp); the labels
    // fall through to the component's own display, or the first alias when it
    // is otherwise anonymous.
    if (entry.cl && entry.cp !== undefined) {
      const primaryEntry = byIndex.get(entry.cp);
      if (primaryEntry) {
        const labels = buildComponentLabels(primaryEntry, conCode, conName, entry.cl);
        if (labels.length > 0) {
          const compDisplay = primary ?? labels[0];
          for (const label of labels) {
            fuzzyEntries.push({
              kind: 'star', index: entry.i, label, primary: compDisplay, displayCon,
              conExpansion: isConExpansion(label),
            });
          }
        }
      }
    }

    // Flamsteed is keyed by number+constellation (the same number recurs
    // across constellations), under both the 3-letter code and full name.
    // Anonymous Flamsteed stars (no proper, no Bayer) fall back to the
    // canonical "<num> <Con>" designation as their display, so they stay
    // findable without echoing the raw query.
    if (entry.f !== undefined && conCode) {
      const desig = `${entry.f} ${conCode}`;
      const flamEntry: FuzzyEntry = {
        kind: 'star', index: entry.i, label: desig, primary: primary ?? desig, displayCon,
      };
      addFlam(`${entry.f} ${conCode.toLowerCase()}`, flamEntry);
      addFlam(`${entry.f} ${conName.toLowerCase()}`, flamEntry);
      if (hasNamedDisplay) {
        fuzzyEntries.push(flamEntry);
        fuzzyEntries.push({
          ...flamEntry,
          label: `${entry.f} ${conName}`,
          conExpansion: conName !== '',
        });
      }
    }
  }

  return { fuzzyEntries, hipMap, hdMap, hrMap, glMap, flamMap };
}
