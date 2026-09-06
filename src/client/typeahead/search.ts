import Fuse from 'fuse.js';
import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { isHardTarget, type Target } from '../camera/focus/focus-target';
import type { Catalog } from '../loaders/catalog-loader';
import { displayNameOf, KIND_ROSTER, type KindModules } from '../kinds/kind-modules';
import { SEARCH_DEBOUNCE_MS, TYPEAHEAD_MAX_RESULTS } from './typeahead-util';
import { Typeahead, TypeaheadGroup } from './typeahead';
import {
  NO_CONSTELLATION_INDEX,
  type SearchEntry,
} from '../../../scripts/catalog/catalog-pure';
import { buildSearchIndex, normalizeGlKey } from './search-corpus';

export type { SearchEntry };
export type { FuzzyEntry, SearchIndex } from './search-corpus';
export {
  buildBayerLabels,
  buildComponentLabels,
  buildGcvsLabels,
  buildSearchIndex,
  normalizeGlKey,
} from './search-corpus';
export {
  bayerDesignation,
  gouldDesignation,
  superscript,
} from '../../../scripts/catalog/naming/star-naming-pure';
export {
  designationSetOfEntry,
  formatGcvsDesignation,
  starDesignations,
} from './star-designations';
export type { BayerInfo } from './star-name-tables';
export {
  buildBayerMap,
  buildSpectralMap,
  buildStarLabels,
} from './star-name-tables';

import type { FuzzyEntry } from './search-corpus';

// Build the shared query runner: direct-lookup maps for numeric IDs, the
// star fuzzy corpus, kind-module rows via the roster, within-kind dedup.
// Every search surface (the topbar Focus/To boxes and the `F` find modal)
// runs the same corpus through this, so ranking + ID dispatch never
// diverge between them.
export function createSearchRunner(
  catalog: Catalog,
  raw: SearchEntry[],
  kinds: KindModules | null = null,
): (q: string) => FuzzyEntry[] {
  // Direct-lookup maps for numeric IDs. Prefix form ("HIP 12345", "HD 128620")
  // dispatches here rather than through the fuzzy index.
  const { fuzzyEntries, hipMap, hdMap, hrMap, glMap, flamMap } =
    buildSearchIndex(raw, catalog.constellations);

  // Kind-module corpus rows. Each entry's index is its kind's Target idx
  // by the module contract, so a missing artifact leaves an object out
  // of the corpus rather than shifting the others. Planet rows carry the
  // body field's flat index, so the runner is built after boot's
  // `kinds.planet.systemsReady` await.
  if (kinds) {
    for (const kind of KIND_ROSTER) {
      const m = kinds[kind];
      if (!m) continue;
      for (const e of m.searchEntries()) fuzzyEntries.push({ kind, ...e });
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

  // Gaia / SID lookup maps, built lazily on the first matching query —
  // they cover the full 380k-row catalog (unlike the search-index maps
  // above), and most sessions never type either form.
  let gaiaMap: Map<bigint, number> | null = null;
  const gaiaLookup = (id: bigint): number | undefined => {
    if (!gaiaMap) {
      gaiaMap = new Map();
      for (let i = 0; i < catalog.count; i++) {
        const g = catalog.gaiaSourceId[i];
        if (g !== 0n && !gaiaMap.has(g)) gaiaMap.set(g, i);
      }
    }
    return gaiaMap.get(id);
  };
  let sidMap: Map<number, number> | null = null;
  const sidLookup = (sidVal: number): number | undefined => {
    if (!sidMap) {
      sidMap = new Map();
      for (let i = 0; i < catalog.count; i++) {
        const v = catalog.sid[i];
        if (v !== 0 && !sidMap.has(v)) sidMap.set(v, i);
      }
    }
    return sidMap.get(sidVal);
  };

  const directResult = (idx: number, label: string): FuzzyEntry => {
    const conIdx = catalog.constellation[idx];
    const con = conIdx !== NO_CONSTELLATION_INDEX ? catalog.constellations[conIdx] : null;
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
    // Gaia: "Gaia 4472…", "Gaia DR3 4472…", or a bare 19-digit source_id
    // (Gaia DR3 ids are 19 digits; no other numeric form is that long).
    const gaiaMatch =
      trimmed.match(/^gaia\s*(?:dr\s*3\s*)?(\d+)$/i) ?? trimmed.match(/^(\d{19})$/);
    if (gaiaMatch) {
      const idx = gaiaLookup(BigInt(gaiaMatch[1]));
      return idx !== undefined ? [directResult(idx, `Gaia DR3 ${gaiaMatch[1]}`)] : [];
    }
    // Stellata ID: "SID 216867" / "SID #216867" — the frozen fallback
    // identifier every card can display (docs/sid.md).
    const sidMatch = trimmed.match(/^sid\s*#?\s*(\d+)$/i);
    if (sidMatch) {
      const idx = sidLookup(Number(sidMatch[1]));
      return idx !== undefined ? [directResult(idx, `SID #${sidMatch[1]}`)] : [];
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

/** FuzzyEntry → kind-tagged Target. Every kind's index IS its Target
 *  idx — planet rows bake the body field's flat instance index at
 *  corpus build (createSearchRunner). */
export function resolveEntryTarget(entry: FuzzyEntry): Target {
  return { kind: entry.kind, idx: entry.index };
}

// A dropdown row's primary/sub display. Empty constellation falls back to an
// em-dash so the secondary column never collapses.
const rowFor = (e: FuzzyEntry) => ({ primary: e.primary, sub: e.displayCon || '—' });

export function bindSearch(
  stellata: Stellata,
  catalog: Catalog,
  raw: SearchEntry[],
) {
  const runQuery = createSearchRunner(catalog, raw, stellata.kinds);

  const resultsEl = document.getElementById('search-results') as HTMLUListElement;
  const focusInput = document.getElementById('search-focus') as HTMLInputElement;
  const focusClear = document.getElementById('search-focus-clear') as HTMLButtonElement;
  const focusTag = document.getElementById('search-focus-tag')!;
  const toInput = document.getElementById('search-to') as HTMLInputElement;
  const toClear = document.getElementById('search-to-clear') as HTMLButtonElement;
  const toRow = document.getElementById('search-to-row')!;

  // OBSERVE anchors are hard-kind objects (star / planet / probe) — soft
  // kinds (clouds, LG, shells) don't recentre the floating origin, so
  // they shouldn't appear in the location picker. Wrap the shared query
  // to drop them when observing; the To box still uses the unfiltered
  // runner because the distance vector accepts any-kind destinations.
  const focusRunQuery = (q: string): FuzzyEntry[] => {
    const all = runQuery(q);
    if (stellata.focus.getCameraMode() === 'observe') {
      return all.filter((e) => isHardTarget({ kind: e.kind, idx: e.index }));
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
      const target = resolveEntryTarget(entry);
      if (stellata.focus.getCameraMode() === 'observe' && isHardTarget(target)) {
        // Re-route through warp so the camera flies from the current
        // observation anchor to the new one and re-enters observe on
        // arrival, instead of teleporting via flyTo.
        stellata.warp.warpTo(target);
        return;
      }
      stellata.focus.flyTo(target);
    },
    onClear: () => stellata.focus.unfocus(),
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
      stellata.focus.setVector(resolveEntryTarget(entry));
    },
    onClear: () => stellata.focus.setVector(null),
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
  const nameOf = (t: Target): string => displayNameOf(stellata.kinds, t);
  const syncFocusUI = () => {
    const focused = stellata.focus.getFocusedTarget();
    const observe = stellata.focus.getCameraMode() === 'observe';
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
    const vec = stellata.focus.getVectorTarget();
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
): void {
  const runQuery = createSearchRunner(catalog, raw, stellata.kinds);
  const input = document.getElementById('find-input') as HTMLInputElement;
  const resultsEl = document.getElementById('find-results') as HTMLUListElement;

  new Typeahead<FuzzyEntry>({
    input,
    resultsEl,
    runQuery,
    rowFor,
    onSelect: (entry) => {
      const target = resolveEntryTarget(entry);
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
