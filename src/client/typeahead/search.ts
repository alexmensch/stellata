import Fuse from 'fuse.js';
import * as THREE from 'three';
import type { Stellata } from '../stellata';
import type { Target } from '../camera/focus/focus-target';
import type { Catalog } from '../loaders/catalog-loader';
import type { CloudCatalog } from '../molecular-clouds/cloud-loader';
import type { LgCatalog } from '../local-group/local-group-loader';
import { SOL_PLANETS } from '../solar-system/planet-system';
import { SEARCH_DEBOUNCE_MS, TYPEAHEAD_MAX_RESULTS } from './typeahead-util';
import { Typeahead, TypeaheadGroup } from './typeahead';
import type { SearchEntry } from '../../../scripts/catalog/catalog-pure';

export type { SearchEntry };

type EntryKind = 'star' | 'cloud' | 'lg' | 'planet';

/** Static dropdown-row distance for a Local Group entry. Fixed units by
 *  scale (kpc / Mpc) rather than the live pc/ly toggle — the corpus is
 *  built once and galaxy distances read naturally in kpc either way. */
export function formatLgSearchDistance(pc: number): string {
  if (pc >= 1_000_000) return `${(pc / 1_000_000).toFixed(2)} Mpc`;
  return `${Math.round(pc / 1000)} kpc`;
}

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

// Canonical Greek letter forms keyed by AT-HYG's 3-letter Latin abbreviation.
const BAYER_FULL: Record<string, string> = {
  Alp: 'Alpha', Bet: 'Beta', Gam: 'Gamma', Del: 'Delta', Eps: 'Epsilon',
  Zet: 'Zeta', Eta: 'Eta', The: 'Theta', Iot: 'Iota', Kap: 'Kappa',
  Lam: 'Lambda', Mu: 'Mu', Nu: 'Nu', Xi: 'Xi', Omi: 'Omicron',
  Pi: 'Pi', Rho: 'Rho', Sig: 'Sigma', Tau: 'Tau', Ups: 'Upsilon',
  Phi: 'Phi', Chi: 'Chi', Psi: 'Psi', Ome: 'Omega',
};
const BAYER_GREEK: Record<string, string> = {
  Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε',
  Zet: 'ζ', Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ',
  Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ', Omi: 'ο',
  Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ',
  Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω',
};

// Returns { letter3, suffix } for a Bayer string like "Alp" or "Alp-2".
// Unknown letter returns null.
export function splitBayer(bayer: string): { letter3: string; suffix: string } | null {
  const m = bayer.match(/^([A-Za-z]+)(?:-(\d))?$/);
  if (!m) return null;
  const letter3 = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  if (!(letter3 in BAYER_FULL)) return null;
  return { letter3, suffix: m[2] ? `-${m[2]}` : '' };
}

// Human-facing Bayer display string, e.g. "α¹ Cen".
export function formatBayerDisplay(bayer: string, conCode: string): string {
  const split = splitBayer(bayer);
  if (!split) return `${bayer} ${conCode}`;
  const greek = BAYER_GREEK[split.letter3];
  const sup = split.suffix ? superscript(split.suffix.slice(1)) : '';
  return `${greek}${sup} ${conCode}`;
}

export function superscript(digit: string): string {
  const map: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return digit.split('').map((d) => map[d] ?? d).join('');
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
// of "Alpha Cen", "Alp Cen", "α Cen", or "Alpha Centaurus" and find it. The
// "-1/-2" superscript from AT-HYG (which distinguishes the A/B components of
// a multiple system) is deliberately NOT in the search labels — users type
// "Alpha Cen" to mean the system, not "Alpha 1 Cen". Both A and B stars emit
// the same labels and will both appear in the results, letting the user pick.
// The superscript DOES show in the display form ("α¹ Cen") to disambiguate.
export function buildBayerLabels(
  bayer: string,
  conCode: string,
  conName: string,
): string[] {
  const split = splitBayer(bayer);
  if (!split) return [`${bayer} ${conCode}`];
  const full = BAYER_FULL[split.letter3];
  const greek = BAYER_GREEK[split.letter3];
  const labels = new Set<string>();
  labels.add(`${full} ${conCode}`);
  labels.add(`${full} ${conName}`);
  labels.add(`${split.letter3} ${conCode}`);
  labels.add(`${greek} ${conCode}`);
  labels.add(`${greek} ${conName}`);
  if (split.letter3 === 'Alp') {
    labels.add(`Alf ${conCode}`);
    labels.add(`Alf ${conName}`);
  }
  return [...labels];
}

// GCVS stores V-number designations zero-padded to four digits
// ("V0645 Cen"); common usage drops the padding ("V645 Cen"), which is
// also what users type. Letter-sequence names (R CrB, VY CMa, RR Lyr)
// carry no numeric run and pass through unchanged.
export function formatGcvsDesignation(raw: string): string {
  return raw.replace(/^V0*(\d)/, 'V$1');
}

// Fuzzy-search labels for a GCVS designation: the designation itself
// (V-number padding stripped) plus a constellation-name-expanded variant
// (trailing IAU abbreviation → full name), mirroring buildBayerLabels so
// "V645 Cen" and "V645 Centaurus" both resolve. Empty conName → just the
// abbreviated form.
export function buildGcvsLabels(designation: string, conName: string): string[] {
  const desig = formatGcvsDesignation(designation);
  const labels = new Set<string>([desig]);
  if (conName) labels.add(desig.replace(/\s+\S+$/, ` ${conName}`));
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
  return [...labels];
}

// Best human-readable label for a star, falling back through identifier
// tiers: proper name → Bayer → Flamsteed → GCVS designation → HIP → HD →
// HR → Gl. For use in the focus display, meta bar, tooltip, and the
// search-box value when a star is picked.
export function buildStarLabels(
  catalog: Catalog,
  raw: SearchEntry[],
): Map<number, string> {
  const labels = new Map<number, string>();
  for (const [idx, name] of catalog.names) labels.set(idx, name);

  for (const entry of raw) {
    if (labels.has(entry.i)) continue;
    const conIdx = entry.c ?? 255;
    const con = conIdx !== 255 ? catalog.constellations[conIdx] : null;
    const conCode = con?.code ?? '';
    if (entry.b && conCode) {
      labels.set(entry.i, formatBayerDisplay(entry.b, conCode));
    } else if (entry.f !== undefined && conCode) {
      labels.set(entry.i, `${entry.f} ${conCode}`);
    } else if (entry.g) {
      labels.set(entry.i, formatGcvsDesignation(entry.g));
    } else if (entry.hip !== undefined) {
      labels.set(entry.i, `HIP ${entry.hip}`);
    } else if (entry.hd !== undefined) {
      labels.set(entry.i, `HD ${entry.hd}`);
    } else if (entry.hr !== undefined) {
      labels.set(entry.i, `HR ${entry.hr}`);
    } else if (entry.gl) {
      labels.set(entry.i, entry.gl);
    }
  }
  return labels;
}

// Map of star index → spectral designation string ("G2 V", "M1.5Iab-b",
// "K0III+K7V", etc.), as carried from the source catalog via search-index.
// Used by the hover tooltip to show full classification info.
export function buildSpectralMap(raw: SearchEntry[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const entry of raw) {
    if (entry.s) out.set(entry.i, entry.s);
  }
  return out;
}

// Every display designation for one star, tier-ordered: proper → Bayer →
// Flamsteed → GCVS → HR → HD → HIP → Gliese → Gaia DR3. The focus card's
// identity line renders this set (minus the display label, which already
// heads the card). Gaia rides in from the catalog because search-index
// entries don't carry the source_id. A GCVS designation in Bayer form
// ("bet Per" for Algol) is skipped — the real Bayer display ("β Per")
// already covers it, and the Latinised abbreviation is a search alias,
// not a display name.
export function starDesignations(
  entry: SearchEntry,
  constellations: { code: string }[],
  gaiaSourceId: bigint,
): string[] {
  const conIdx = entry.c ?? 255;
  const conCode = conIdx !== 255 ? constellations[conIdx]?.code ?? '' : '';
  const out: string[] = [];
  if (entry.p) out.push(entry.p);
  if (entry.b && conCode) out.push(formatBayerDisplay(entry.b, conCode));
  if (entry.f !== undefined && conCode) out.push(`${entry.f} ${conCode}`);
  const gcvsFirst = entry.g?.split(/\s+/)[0] ?? '';
  // Lowercase-start guard: GCVS letter-sequence designations (R, VY, MU)
  // are uppercase; only the lowercase Greek forms are Bayer duplicates.
  if (entry.g && !(/^[a-z]/.test(gcvsFirst) && splitBayer(gcvsFirst))) {
    out.push(formatGcvsDesignation(entry.g));
  }
  if (entry.hr !== undefined) out.push(`HR ${entry.hr}`);
  if (entry.hd !== undefined) out.push(`HD ${entry.hd}`);
  if (entry.hip !== undefined) out.push(`HIP ${entry.hip}`);
  if (entry.gl) out.push(entry.gl);
  if (gaiaSourceId !== 0n) out.push(`Gaia DR3 ${gaiaSourceId}`);
  return out;
}

export interface BayerInfo {
  /** Greek letter glyph, e.g. "α". */
  greek: string;
  /** Optional unicode-superscript suffix for A/B components, e.g. "¹". */
  suffix: string;
  /** Constellation index from the catalog (255 = none). */
  conIdx: number;
}

// Map star idx → its Bayer designation parts. Used by chart mode to render
// Greek-letter labels alongside proper names. Entries without a parseable
// Bayer string or a constellation are skipped — chart labels need both.
export function buildBayerMap(raw: SearchEntry[]): Map<number, BayerInfo> {
  const out = new Map<number, BayerInfo>();
  for (const entry of raw) {
    if (!entry.b) continue;
    if (entry.c === undefined || entry.c === 255) continue;
    const split = splitBayer(entry.b);
    if (!split) continue;
    const greek = BAYER_GREEK[split.letter3];
    const suffix = split.suffix ? superscript(split.suffix.slice(1)) : '';
    out.set(entry.i, { greek, suffix, conIdx: entry.c });
  }
  return out;
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
// callers append cloud entries). The display form is computed once per star
// so every label for it shares the same presentation: "ProperName (α¹ Cen)"
// when both exist, else whichever does. The Bayer portion preserves the
// AT-HYG component suffix as a Unicode superscript to disambiguate A/B pairs
// (even though the search labels drop it — see buildBayerLabels).
export function buildSearchIndex(
  raw: SearchEntry[],
  constellations: { code: string; name: string }[],
): SearchIndex {
  const hipMap = new Map<number, number>();
  const hdMap = new Map<number, number>();
  const hrMap = new Map<number, number>();
  const glMap = new Map<string, number>();
  const flamMap = new Map<string, FuzzyEntry[]>();
  const fuzzyEntries: FuzzyEntry[] = [];

  // Component aliases (below) read the system primary's designation by its
  // record index (SearchEntry.cp), so index the corpus up front.
  const byIndex = new Map<number, SearchEntry>();
  for (const entry of raw) byIndex.set(entry.i, entry);

  const addFlam = (key: string, e: FuzzyEntry) => {
    const arr = flamMap.get(key);
    if (arr) arr.push(e);
    else flamMap.set(key, [e]);
  };

  for (const entry of raw) {
    if (entry.hip !== undefined) hipMap.set(entry.hip, entry.i);
    if (entry.hd !== undefined) hdMap.set(entry.hd, entry.i);
    if (entry.hr !== undefined) hrMap.set(entry.hr, entry.i);
    if (entry.gl !== undefined) {
      const norm = normalizeGlKey(entry.gl);
      if (norm) glMap.set(norm, entry.i);
    }

    const conIdx = entry.c ?? 255;
    const con = conIdx !== 255 ? constellations[conIdx] : null;
    const conCode = con?.code ?? '';
    const conName = con?.name ?? '';

    const isConExpansion = (label: string): boolean =>
      conName !== '' && label.includes(conName);

    const properName = entry.p ?? null;
    const bayerDisplay = entry.b && conCode ? formatBayerDisplay(entry.b, conCode) : null;
    let primary: string | null;
    if (properName && bayerDisplay) primary = `${properName} (${bayerDisplay})`;
    else if (properName) primary = properName;
    else if (bayerDisplay) primary = bayerDisplay;
    else primary = null;
    const displayCon = con?.name ?? '';

    if (primary !== null) {
      if (properName) {
        fuzzyEntries.push({ kind: 'star', index: entry.i, label: properName, primary, displayCon });
      }
      if (entry.b && conCode) {
        for (const label of buildBayerLabels(entry.b, conCode, conName)) {
          fuzzyEntries.push({
            kind: 'star', index: entry.i, label, primary, displayCon,
            conExpansion: isConExpansion(label),
          });
        }
      }
    }

    // GCVS variable-star designations (R CrB, VY CMa, V645 Cen). Emitted for
    // every named variable (~14.1k, a superset of the period-matched set) —
    // many (VY CMa, RR Lyr) carry no proper/Bayer/Flamsteed name and are
    // otherwise findable only by HIP/HD, so the primary line falls back to the
    // designation for those.
    if (entry.g) {
      const gcvsPrimary = primary ?? formatGcvsDesignation(entry.g);
      for (const label of buildGcvsLabels(entry.g, conName)) {
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
      if (primary !== null) {
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

// Build the shared query runner over stars + clouds: direct-lookup maps for
// numeric IDs, fuzzy fallback, within-kind dedup. Every search surface (the
// topbar Focus/To boxes and the `F` find modal) runs the same corpus through
// this, so ranking + ID dispatch never diverge between them.
export function createSearchRunner(
  catalog: Catalog,
  raw: SearchEntry[],
  clouds: CloudCatalog | null,
  lg: LgCatalog | null = null,
): (q: string) => FuzzyEntry[] {
  // Direct-lookup maps for numeric IDs. Prefix form ("HIP 12345", "HD 128620")
  // dispatches here rather than through the fuzzy index.
  const { fuzzyEntries, hipMap, hdMap, hrMap, glMap, flamMap } =
    buildSearchIndex(raw, catalog.constellations);

  // Cloud entries — typed-name match plus a "cloud" badge in the dropdown
  // secondary line so users can distinguish Taurus (the cloud) from Tau
  // (any star labelled "Tau …").
  if (clouds) {
    for (let i = 0; i < clouds.clouds.length; i++) {
      const c = clouds.clouds[i];
      fuzzyEntries.push({
        kind: 'cloud',
        index: i,
        label: c.name,
        primary: c.name,
        displayCon: 'Molecular cloud',
      });
    }
  }

  // Local Group entries — display name plus every catalog cross-ID /
  // common-name alias the build emitted ("Andromeda Galaxy", "NGC 224",
  // "M 110", …), each resolving to the same object. The secondary line
  // carries type + distance so "Sagittarius" disambiguates the 26 kpc
  // dSph from any star row at a glance.
  if (lg) {
    for (let i = 0; i < lg.objects.length; i++) {
      const o = lg.objects[i];
      const displayCon = `${o.type} · ${formatLgSearchDistance(o.distanceFromSol)}`;
      for (const label of [o.name, ...(o.aliases ?? [])]) {
        fuzzyEntries.push({ kind: 'lg', index: i, label, primary: o.name, displayCon });
      }
    }
  }

  // Sol's planets — search-by-planet-name is deliberately Sol-only
  // (bk5 exoplanets are visit-to-discover). Entry index is the
  // SOL_PLANETS index; select handlers resolve it to the body field's
  // flat Target index at pick time via `resolveEntryTarget` (the field
  // attaches on a microtask after boot, so the corpus can't bake flat
  // indices).
  if (catalog.solIndex >= 0) {
    for (let i = 0; i < SOL_PLANETS.length; i++) {
      const p = SOL_PLANETS[i];
      fuzzyEntries.push({
        kind: 'planet',
        index: i,
        label: p.name,
        primary: p.name,
        displayCon: 'Planet · Sol system',
      });
    }
  }

  // Threshold 0.25 trims the long tail of loose matches (e.g. "alpha cen"
  // used to dredge up "Aldebaran" via shared letters). 0.35 was too lenient
  // for short queries against a few-thousand-entry corpus.
  // ignoreFieldNorm: Fuse's token-count norm would outvote the tier
  // re-rank below (a 4-word "Andromeda XIX Dwarf Spheroidal" scores
  // worse than a 2-word expansion label for the same match quality);
  // the tier sort's label-length tiebreak owns that job instead.
  const fuse = new Fuse(fuzzyEntries, {
    keys: ['label'],
    threshold: 0.25,
    ignoreLocation: true,
    ignoreFieldNorm: true,
    includeScore: true,
  });

  const directResult = (idx: number, label: string): FuzzyEntry => {
    const conIdx = catalog.constellation[idx];
    const con = conIdx !== 255 ? catalog.constellations[conIdx] : null;
    const name = catalog.names.get(idx);
    return {
      kind: 'star',
      index: idx,
      label,
      primary: name ? `${name} (${label})` : label,
      displayCon: con?.name ?? '',
    };
  };

  // Run a query, dispatching to direct-lookup maps when the form matches,
  // otherwise falling back to fuzzy search. Deduplicates by star index so the
  // dropdown doesn't show "Alpha Cen", "Alpha Centaurus", "α Cen" for the
  // same star.
  return (q: string): FuzzyEntry[] => {
    const trimmed = q.trim();
    // Fuse v7's `search('')` returns the entire corpus, not nothing — so
    // without this guard, focusing an empty input pops a dropdown with
    // ~10 arbitrary stars. The focus + destination boxes are intended to
    // be silent until the user types (unlike the constellation typeahead,
    // which uses its own runQuery and shows NONE+top9 on empty by design).
    if (!trimmed) return [];

    // Numeric-prefixed ID lookups.
    const idPatterns: Array<{ re: RegExp; map: Map<number, number>; prefix: string }> = [
      { re: /^hip\s*(\d+)$/i, map: hipMap, prefix: 'HIP' },
      { re: /^hd\s*(\d+)$/i, map: hdMap, prefix: 'HD' },
      { re: /^hr\s*(\d+)$/i, map: hrMap, prefix: 'HR' },
    ];
    for (const { re, map, prefix } of idPatterns) {
      const m = trimmed.match(re);
      if (m) {
        const idx = map.get(Number(m[1]));
        return idx !== undefined ? [directResult(idx, `${prefix} ${m[1]}`)] : [];
      }
    }
    // Gliese: "Gl 559A", "GJ 581", "Gliese 411"
    const glMatch = trimmed.match(/^(?:gliese|gj|gl)\s*(\d+\s*[a-z]?)$/i);
    if (glMatch) {
      const idx = glMap.get(normalizeGlKey(glMatch[1]));
      return idx !== undefined ? [directResult(idx, `Gl ${glMatch[1].toUpperCase()}`)] : [];
    }
    // Flamsteed: "58 Ori". Returns every component sharing the number, each
    // with its own display name — not the raw query echoed back.
    const flamMatch = trimmed.match(/^(\d+)\s+([A-Za-z]+)$/);
    if (flamMatch) {
      const key = `${flamMatch[1]} ${flamMatch[2].toLowerCase()}`;
      const hits = flamMap.get(key);
      if (hits) return hits.slice(0, TYPEAHEAD_MAX_RESULTS);
      // Fall through to fuzzy — maybe "58 Ori" is a partial match on a label.
    }

    // No result limit: with ignoreLocation, "andromeda" is a PERFECT
    // match for hundreds of "<designation> Andromeda" expansion labels,
    // and any pre-rank cap ordered by Fuse's score-then-insertion would
    // evict the corpus-tail LG entries (the Andromeda Galaxy) before
    // the tier re-rank below ever sees them. Sorting the full match set
    // costs ms next to the corpus scan itself.
    const res = fuse.search(trimmed);

    // Re-rank at equal Fuse score (bucketed — sub-percent score noise
    // must not outvote the tiers): exact label > query-is-prefix >
    // plain name/alias > constellation-expansion label; then shorter
    // label (higher query coverage — "Andromeda Galaxy" over
    // "Andromeda XIX Dwarf Spheroidal"), then Fuse order.
    const qNorm = trimmed.toLowerCase();
    const tierOf = (e: FuzzyEntry): number => {
      const l = e.label.toLowerCase();
      if (l === qNorm) return 0;
      if (l.startsWith(qNorm)) return 1;
      return e.conExpansion ? 3 : 2;
    };
    const ranked = res
      .map((r, i) => ({
        item: r.item,
        i,
        bucket: Math.round((r.score ?? 0) * 100),
        tier: tierOf(r.item),
      }))
      .sort(
        (a, b) =>
          a.bucket - b.bucket ||
          a.tier - b.tier ||
          a.item.label.length - b.item.label.length ||
          a.i - b.i,
      );

    const seen = new Set<string>();
    const out: FuzzyEntry[] = [];
    for (const r of ranked) {
      // Key by kind+index so a star whose name collides with a cloud name
      // (e.g. "Taurus" the cloud vs. some Tau star) doesn't dedupe across
      // categories. The fuzzy index intentionally carries multiple labels
      // per star, so within-kind dedup is still necessary.
      const key = `${r.item.kind}:${r.item.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r.item);
      if (out.length >= TYPEAHEAD_MAX_RESULTS) break;
    }
    return out;
  };
}

/** FuzzyEntry → kind-tagged Target. Planet entries carry the
 *  SOL_PLANETS index and resolve to the body field's flat instance
 *  index at pick time (null when Sol's system hasn't attached); every
 *  other kind's index IS its Target idx. */
export function resolveEntryTarget(
  stellata: Stellata,
  catalog: Catalog,
  entry: FuzzyEntry,
): Target | null {
  if (entry.kind !== 'planet') return { kind: entry.kind, idx: entry.index };
  const flat = stellata.planetField.instanceIndexOf(catalog.solIndex, entry.index);
  return flat === null ? null : { kind: 'planet', idx: flat };
}

// A dropdown row's primary/sub display. Empty constellation falls back to an
// em-dash so the secondary column never collapses.
const rowFor = (e: FuzzyEntry) => ({ primary: e.primary, sub: e.displayCon || '—' });

export function bindSearch(
  stellata: Stellata,
  catalog: Catalog,
  raw: SearchEntry[],
  starLabels: Map<number, string>,
  clouds: CloudCatalog | null,
  lg: LgCatalog | null = null,
) {
  const runQuery = createSearchRunner(catalog, raw, clouds, lg);

  const resultsEl = document.getElementById('search-results') as HTMLUListElement;
  const focusInput = document.getElementById('search-focus') as HTMLInputElement;
  const focusClear = document.getElementById('search-focus-clear') as HTMLButtonElement;
  const focusTag = document.getElementById('search-focus-tag')!;
  const toInput = document.getElementById('search-to') as HTMLInputElement;
  const toClear = document.getElementById('search-to-clear') as HTMLButtonElement;
  const toRow = document.getElementById('search-to-row')!;

  const describe = (idx: number): string => {
    return starLabels.get(idx) ?? `Unnamed #${idx}`;
  };

  // OBSERVE mode is star-only — clouds aren't valid observation anchors,
  // so they shouldn't appear in the location picker. Wrap the shared query
  // to drop them when observing; the To box still uses the unfiltered
  // runner because the distance vector accepts cloud destinations.
  const focusRunQuery = (q: string): FuzzyEntry[] => {
    const all = runQuery(q);
    if (stellata.getCameraMode() === 'observe') {
      return all.filter((e) => e.kind === 'star');
    }
    return all;
  };

  // Both inputs share the single resultsEl, so they share a group too —
  // the group's "active" slot keeps blur-defer from hiding the dropdown
  // when focus moves between focus + to.
  const group = new TypeaheadGroup();

  // Anchor the floating dropdown under whichever search row triggered
  // it. Both the focus + to inputs share a single absolutely-positioned
  // resultsEl, so its `top` has to be re-computed on every render.
  const positionUnder = (input: HTMLInputElement) => () => {
    const row = input.closest('.search-row') as HTMLElement | null;
    if (row) {
      resultsEl.style.top = row.offsetTop + row.offsetHeight + 'px';
    }
  };

  const focusBox = new Typeahead<FuzzyEntry>({
    input: focusInput,
    resultsEl,
    clearBtn: focusClear,
    runQuery: focusRunQuery,
    rowFor,
    onSelect: (entry) => {
      if (entry.kind === 'star') {
        if (stellata.getCameraMode() === 'observe') {
          // Re-route through warp so the camera flies from the current
          // observation anchor to the new one and re-enters observe on
          // arrival, instead of teleporting via focusStar.
          stellata.warpTo({ kind: 'star', idx: entry.index });
        } else {
          stellata.focusStar(entry.index);
        }
        return;
      }
      const target = resolveEntryTarget(stellata, catalog, entry);
      if (target) stellata.flyTo(target);
    },
    onClear: () => stellata.unfocus(),
    positionResults: positionUnder(focusInput),
    group,
    debounceMs: SEARCH_DEBOUNCE_MS,
  });

  // Distance-vector destination — accepts both star and cloud entries.
  // The pick handler dispatches to the appropriate setter; the two
  // mutually exclude in Stellata, so flipping between a star and a
  // cloud destination clears the previous one.
  const toBox = new Typeahead<FuzzyEntry>({
    input: toInput,
    resultsEl,
    clearBtn: toClear,
    runQuery,
    rowFor,
    onSelect: (entry) => {
      const target = resolveEntryTarget(stellata, catalog, entry);
      if (target) stellata.setVector(target);
    },
    onClear: () => stellata.setVector(null),
    positionResults: positionUnder(toInput),
    group,
    debounceMs: SEARCH_DEBOUNCE_MS,
  });

  // Single sync for both star and cloud focus — the two are mutually
  // exclusive (setting either clears the other in Stellata), so the
  // focus search box renders whichever one is set. The To (distance
  // vector) row is shown whenever a focus is held — clouds participate
  // in the same measurement / warp flow as stars now. OBSERVE mode hides
  // the To row entirely: distance-vector measurement is meaningless from
  // a camera parked on its own anchor, and the underlying setters no-op
  // in that mode anyway.
  // Display names stay a per-kind lookup — the rich star label
  // (describe) lives in the search corpus, cloud / LG names on their
  // catalogs; kind identity itself rides the Target.
  const nameOf = (t: Target): string => {
    if (t.kind === 'star') return describe(t.idx);
    if (t.kind === 'planet') return stellata.planetField.planetAt(t.idx)?.name ?? '';
    if (t.kind === 'cloud') return clouds ? clouds.clouds[t.idx].name : '';
    return lg ? lg.objects[t.idx].name : '';
  };
  const syncFocusUI = () => {
    const focused = stellata.getFocusedTarget();
    const observe = stellata.getCameraMode() === 'observe';
    // OBSERVE makes the focus row read as "where you are observing from"
    // rather than "what you have selected", which is what FOCUS implies in
    // navigate mode. Same field, different mental model.
    focusTag.textContent = observe ? 'Location' : 'Focus';
    if (focused !== null) {
      focusBox.setName(nameOf(focused));
      toRow.hidden = observe;
    } else {
      focusBox.setName('');
      toRow.hidden = true;
      toBox.setName('');
    }
  };
  const syncVectorUI = () => {
    const vec = stellata.getVectorTarget();
    toBox.setName(vec !== null ? nameOf(vec) : '');
  };

  stellata.on('focus', syncFocusUI);
  stellata.on('cameraMode', syncFocusUI);
  stellata.on('vector', syncVectorUI);

  syncFocusUI();
  syncVectorUI();
}

// The `F` find modal: same corpus as the topbar search, but picking an entry
// only points the camera at it (aimAt) — no focus, warp, or travel. Reachable
// in observe mode only (the shortcut gates it): from a navigate-mode focus,
// aiming would just park the target behind the focused star. The widget lives
// hidden in the DOM and is relocated into the shared kb-modal card by the
// keyboard-shortcut handler, exactly like the Go / Constellation pickers.
export function bindFindSearch(
  stellata: Stellata,
  catalog: Catalog,
  raw: SearchEntry[],
  clouds: CloudCatalog | null,
  lg: LgCatalog | null = null,
): void {
  const runQuery = createSearchRunner(catalog, raw, clouds, lg);
  const input = document.getElementById('find-input') as HTMLInputElement;
  const resultsEl = document.getElementById('find-results') as HTMLUListElement;

  new Typeahead<FuzzyEntry>({
    input,
    resultsEl,
    runQuery,
    rowFor,
    onSelect: (entry) => {
      const target = resolveEntryTarget(stellata, catalog, entry);
      if (!target) return;
      const pos = new THREE.Vector3();
      if (stellata.focusables[target.kind].localPositionInto(target.idx, pos)) {
        stellata.aimAt(pos);
      }
    },
    positionResults: () => {
      const row = input.closest('.search-row') as HTMLElement | null;
      if (row) resultsEl.style.top = row.offsetTop + row.offsetHeight + 'px';
    },
    debounceMs: SEARCH_DEBOUNCE_MS,
  });
}
