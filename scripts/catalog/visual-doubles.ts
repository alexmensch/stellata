// Hipparcos CCDM parser plus curated visual-double overrides, feeding
// the chart-mode wings glyph. See scripts/catalog/README.md § CCDM
// double-star cross-match.
import { existsSync, readFileSync } from 'node:fs';

import {
  applyDoublesFlag as applyDoublesFlagPure,
  isOpticalDoublePrimary,
  OPTICAL_DOUBLE_MIN_SEP_PC,
  type OpticalDoubleContext,
} from './catalog-pure';
import type { MultiplesTsvRow } from './companion-promotion';
import type { Star } from './stars-parse';

// Curated visual-double systems that the CCDM+MultFlag filter (see
// parseHipCcdm) drops because Hipparcos's main catalogue modelled
// them as single stars (`MultFlag` blank, `Ncomp=1`). Each entry is a
// system: a list of HIPs (one or more components found in this
// catalog) plus a justification. parseHipCcdm groups these as
// synthetic CCDM systems so the primary-only flagging in
// applyDoublesFlag picks exactly one component per system.
//
// Visual review of new chart-mode renders may surface more — extend
// conservatively, only for systems where the pair is canonical enough
// to expect wings on the chart.
export interface VisualDoubleSystem {
  components: number[]; // HIPs of components present in our catalog
  reason: string;
}

export const KNOWN_VISUAL_DOUBLES: VisualDoubleSystem[] = [
  {
    components: [11767],
    reason: 'Polaris (α UMi) — Polaris B at sep ≈ 18″ is a real companion; Hipparcos modelled as Ncomp=1',
  },
  {
    components: [91971],
    reason: 'ε¹ Lyr — inner pair Aa+Ab at sep ≈ 2.4″; ε² Lyr (HIP 91926) carries MultFlag=C as the analogue',
  },
  {
    components: [104214, 104217],
    reason: '61 Cyg A/B — famous nearby K-dwarf pair at sep ≈ 30″ between HIP 104214 (A) and HIP 104217 (B)',
  },
];

// HIPs that appear anywhere in KNOWN_VISUAL_DOUBLES; pre-built once
// for fast membership checks during the CCDM file scan.
export const KNOWN_VISUAL_DOUBLE_HIPS: Set<number> = new Set(
  KNOWN_VISUAL_DOUBLES.flatMap((s) => s.components),
);

// Hipparcos main catalogue carries a CCDM cross-reference per star: the
// `CCDM` column is non-blank when the star is a component of a system in
// the Catalog of the Components of Double and Multiple stars (Dommanget &
// Nys 1994), the curated pre-WDS reference for visual doubles. CCDM alone
// is too permissive — it lumps physical doubles together with wide
// line-of-sight optical pairs (so Vega and Pollux end up tagged) — so we
// gate it with Hipparcos's own `MultFlag` column (H59):
//
//   C = component star in a Hipparcos-resolved system
//   G = double resolved within the Hipparcos field
//   O = orbit known (spectroscopic / astrometric)
//   blank, V, X = unconfirmed by Hipparcos's own astrometry
//
// Keeping `{C, G, O}` removes the bulk of CCDM optical pairs while
// preserving real binaries Hipparcos modelled. A handful of canonical
// visual doubles are still dropped this way (Polaris, ε¹ Lyr, 61 Cyg —
// wide pairs Hipparcos treated as single stars); KNOWN_VISUAL_DOUBLES
// recovers them.
//
// Expected file: VizieR TSV from
// `asu-tsv?-source=I/239/hip_main&-out=HIP,CCDM,MultFlag&-out.max=unlimited`.
// The parser tolerates VizieR's preamble (`#` comments, header row,
// dash-separator row, then data).

// Returns a map from CCDM_ID → list of component HIPs. Curated visual
// doubles are NOT included here — they live in KNOWN_VISUAL_DOUBLES and
// applyDoublesFlag unions both sources at flag time. Keeping them
// separate avoids minting synthetic CCDM keys that share a type with
// real CCDM IDs.
// Components in the same group are siblings of one system —
// applyDoublesFlag picks the brightest as the primary.
export function parseHipCcdm(srcPath: string): Map<string, number[]> {
  const groups = new Map<string, number[]>();

  if (!existsSync(srcPath)) return groups;

  const text = readFileSync(srcPath, 'utf8');
  const rawLines = text.split(/\r?\n/);

  let header: string[] | null = null;
  let hipIdx = -1, ccdmIdx = -1, mfIdx = -1;
  let scanned = 0, kept = 0, viaOverride = 0;
  let droppedNoHip = 0, droppedNoCcdm = 0, droppedMultFlag = 0;

  for (const line of rawLines) {
    if (!line || !line.trim()) continue;
    if (line.startsWith('#')) continue;

    const cols = line.split('\t');
    // VizieR TSVs include a dash-separator row right after the header.
    if (cols.every((c) => /^[-\s]+$/.test(c) && c.includes('-'))) continue;

    if (!header) {
      header = cols.map((c) => c.trim());
      hipIdx = header.indexOf('HIP');
      ccdmIdx = header.indexOf('CCDM');
      mfIdx = header.indexOf('MultFlag');
      const missing: string[] = [];
      if (hipIdx < 0) missing.push('HIP');
      if (ccdmIdx < 0) missing.push('CCDM');
      if (mfIdx < 0) missing.push('MultFlag');
      if (missing.length) {
        throw new Error(
          `Hipparcos CCDM TSV is missing required columns: ${missing.join(', ')}.\n` +
            `  Header was: ${header.map((h) => JSON.stringify(h)).join(', ')}\n` +
            `  Re-fetch from VizieR with -out=HIP,CCDM,MultFlag.`,
        );
      }
      continue;
    }

    scanned++;
    const hipStr = (cols[hipIdx] ?? '').trim();
    if (!hipStr) { droppedNoHip++; continue; }
    const hip = parseInt(hipStr, 10);
    if (!Number.isFinite(hip) || hip <= 0) { droppedNoHip++; continue; }

    if (KNOWN_VISUAL_DOUBLE_HIPS.has(hip)) {
      viaOverride++;
      continue; // already in an OVERRIDE-* group
    }

    const ccdm = (cols[ccdmIdx] ?? '').trim();
    if (!ccdm) { droppedNoCcdm++; continue; }

    const mf = (cols[mfIdx] ?? '').trim();
    if (mf !== 'C' && mf !== 'G' && mf !== 'O') {
      droppedMultFlag++;
      continue;
    }

    const list = groups.get(ccdm);
    if (list) list.push(hip);
    else groups.set(ccdm, [hip]);
    kept++;
  }

  console.log(
    `  ${kept} HIPs via CCDM+MultFlag(C/G/O); ` +
      `${groups.size} systems total; ` +
      `${scanned} scanned, dropped ${droppedNoHip} no-HIP, ${droppedNoCcdm} blank CCDM, ${droppedMultFlag} unconfirmed MultFlag, ${viaOverride} skipped(in-override)`,
  );
  return groups;
}

// Components of kept physical pairs in data/binaries/multiples.tsv — the
// binaries pipeline's Stage-5 optical filter already classified these
// bound. A CCDM primary matching either set has independent physical
// evidence and keeps its wings past the optical-double gate.
export interface PhysicalPairKeys {
  hips: ReadonlySet<number>;
  gaia: ReadonlySet<string>;
}

// Collect the HIP / Gaia source_id keys of every kept physical-pair
// component from multiples.tsv. Stage 6 drops optical pairs entirely, so a
// non-standalone row is a bound-pair member; standalone rows are single
// stars carrying no boundness evidence.
export function collectPhysicalPairKeys(
  rows: readonly MultiplesTsvRow[] | null,
): PhysicalPairKeys {
  const hips = new Set<number>();
  const gaia = new Set<string>();
  for (const r of rows ?? []) {
    if (r.orbitRole === 'standalone') continue;
    if (r.hip !== null) hips.add(r.hip);
    if (r.gaiaSourceId !== null) gaia.add(r.gaiaSourceId);
  }
  return { hips, gaia };
}

// Build the union of CCDM groups (parsed from Hipparcos) and the curated
// KNOWN_VISUAL_DOUBLES overrides, then delegate to the pure
// `applyDoublesFlag` helper. The pure helper handles the per-group
// "brightest in-catalog component, idempotent with existing flags" logic
// — see catalog-pure.ts for the contract.
//
// `physical` gates the optical-double suppression (isOpticalDoublePrimary):
// CCDM keeps a tail of wide line-of-sight optical pairs whose brightest
// member would otherwise get spurious chart-mode wings. The curated
// KNOWN_VISUAL_DOUBLES are folded into the physical-evidence set so they
// are never suppressed.
export function applyDoublesFlag(
  stars: Star[],
  ccdmGroups: Map<string, number[]>,
  hipToIndex: Map<number, number>,
  physical: PhysicalPairKeys,
): { systems: number; flagged: number; suppressed: number } {
  const allGroups: Iterable<Iterable<number>> = (function* () {
    yield* ccdmGroups.values();
    for (const sys of KNOWN_VISUAL_DOUBLES) yield sys.components;
  })();
  const physicalHips = new Set<number>(physical.hips);
  for (const h of KNOWN_VISUAL_DOUBLE_HIPS) physicalHips.add(h);
  const ctx: OpticalDoubleContext = {
    physicalHips,
    physicalGaia: physical.gaia,
    minSepPc: OPTICAL_DOUBLE_MIN_SEP_PC,
  };
  const suppress = (primaryIdx: number, memberIndices: number[]): boolean =>
    isOpticalDoublePrimary(primaryIdx, memberIndices, stars, ctx);
  return applyDoublesFlagPure(stars, allGroups, hipToIndex, suppress);
}
