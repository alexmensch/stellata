// Hipparcos CCDM parser plus curated visual-double overrides, feeding
// the chart-mode wings glyph. See /scripts/catalog/multiplicity/README.md#ccdm-double-star-cross-match.
import type { ColumnTable } from '../../util/tsv/table-pure';
import {
  flagGroupPrimaries,
  isOpticalDoubleMember,
  resolveGroups,
  OPTICAL_DOUBLE_MIN_SEP_PC,
  type OpticalDoubleContext,
} from './binary-flags-pure';
import type { MultiplesTsvRow } from '../companions/multiples-row';
import type { Star } from '../parse/stars-parse';
import type { MultiplicityCounts } from './multiplicity-stage-pure';

// Curated visual-double systems that the CCDM+MultFlag filter (see
// parseHipCcdm) drops because Hipparcos's main catalogue modelled
// them as single stars (`MultFlag` blank, `Ncomp=1`). Each entry is a
// system: a list of HIPs (one or more components found in this
// catalog) plus a justification. doublesEvidence appends each as a
// group of its own, so the primary-only flagging in applyDoublesFlag
// picks exactly one component per system.
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

// `MultFlag` (H59) gates CCDM's permissiveness: {C, G, O} are the systems
// Hipparcos itself modelled, and blank / V / X are not.
//
// Expected file: VizieR TSV from
// `asu-tsv?-source=I/239/hip_main&-out=HIP,CCDM,MultFlag&-out.max=unlimited`.
// The parser tolerates VizieR's preamble (`#` comments, header row,
// dash-separator row, then data).
//
// Real CCDM keys only. A HIP the curated list already claims is skipped here
// and unioned in by doublesEvidence instead, so no synthetic key is minted
// that would share a type with a real CCDM ID.
const HIP_CCDM_COLUMNS = ['HIP', 'CCDM', 'MultFlag'] as const;

export function parseHipCcdm(table: ColumnTable): Map<string, number[]> {
  const groups = new Map<string, number[]>();

  let scanned = 0, kept = 0, viaOverride = 0;
  let droppedNoHip = 0, droppedNoCcdm = 0, droppedMultFlag = 0;

  for (const row of table(HIP_CCDM_COLUMNS)) {
    scanned++;
    const hip = row.int('HIP');
    if (hip === null || hip <= 0) { droppedNoHip++; continue; }

    if (KNOWN_VISUAL_DOUBLE_HIPS.has(hip)) {
      viaOverride++;
      continue; // the curated list supplies this system at flag time
    }

    const ccdm = row.text('CCDM');
    if (ccdm === null) { droppedNoCcdm++; continue; }

    const mf = row.text('MultFlag');
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

// Stage 6 drops optical pairs entirely, so a non-standalone row is a
// bound-pair member; standalone rows are single stars carrying no
// boundness evidence.
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

/** The double-star systems both the wings pass and system membership read, with the optical-double gate's context. */
export interface DoublesEvidence {
  /** Each system's catalogue records (resolveGroups): every real CCDM group, then each curated system. */
  readonly groups: readonly (readonly number[])[];
  readonly ccdmGroupCount: number;
  readonly optical: OpticalDoubleContext;
}

// The curated KNOWN_VISUAL_DOUBLES are folded into the physical-evidence set
// so the optical-double gate never fires on them.
export function doublesEvidence(
  ccdmGroups: ReadonlyMap<string, readonly number[]>,
  physical: PhysicalPairKeys,
  hipToIndex: ReadonlyMap<number, number>,
): DoublesEvidence {
  const physicalHips = new Set<number>(physical.hips);
  for (const h of KNOWN_VISUAL_DOUBLE_HIPS) physicalHips.add(h);
  return {
    groups: resolveGroups([...ccdmGroups.values(), ...KNOWN_VISUAL_DOUBLES.map((sys) => sys.components)], hipToIndex),
    ccdmGroupCount: ccdmGroups.size,
    optical: { physicalHips, physicalGaia: physical.gaia, minSepPc: OPTICAL_DOUBLE_MIN_SEP_PC },
  };
}

// Delegates to `flagGroupPrimaries` for the per-group "brightest in-catalog
// component, idempotent with existing flags" logic, vetoing an optical
// double's primary (isOpticalDoubleMember): CCDM keeps a tail of wide
// line-of-sight optical pairs whose brightest member would otherwise get
// spurious chart-mode wings.
export function applyDoublesFlag(
  stars: Star[],
  evidence: DoublesEvidence,
): Pick<MultiplicityCounts, 'ccdmGroups' | 'ccdmResolved' | 'ccdmFlagged' | 'ccdmSuppressedOptical'> {
  const suppress = (primaryIdx: number, memberIndices: readonly number[]): boolean =>
    isOpticalDoubleMember(primaryIdx, memberIndices, stars, evidence.optical);
  const { systems, flagged, suppressed } = flagGroupPrimaries(stars, evidence.groups, suppress);
  return { ccdmGroups: evidence.ccdmGroupCount, ccdmResolved: systems, ccdmFlagged: flagged, ccdmSuppressedOptical: suppressed };
}
