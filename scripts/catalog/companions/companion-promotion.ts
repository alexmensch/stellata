// Reads data/binaries/multiples.tsv and promotes physical-pair
// secondaries not in AT-HYG into first-class catalog.bin records.
// See ./README.md#companion-promotion-from-databinariesmultiplestsv `data/binaries/multiples.tsv`.

import {
  FLAG_BINARY_COMPANION_ONLY,
  FLAG_BINARY_COMPANION_SYNTHETIC,
} from '../../../src/catalog-format/record/catalog-pure';
import { absoluteMagnitude } from '../../../src/astro-core/perceptual-magnitude';
import {
  SPECTRAL_UNKNOWN,
  type SpectralInfo,
  classifyFromSimbad,
  resolveSpectDisplay,
} from '../../../src/catalog-format/spectral/spectral-classify';
import {
  absmagFromSpectral,
  physicalRadius,
  spectralClassCi,
  spectralClassColorIsDerivable,
  spectralFromAbsmag,
  type RadiusResolution,
} from '../../../src/catalog-format/spectral/physical-radius';
import { avSolToStar, type DustGrid } from '../distance/dust/dust-deextinction-pure';
import { R_V } from '../../../src/astro-core/extinction/dust-raymarch-pure';
import type { PhotometryVia } from '../../binaries/multiples-record-pure';
import { canonicalCompLetter, composeSyntheticId, wdsRootOf } from '../../binaries/component-tokens-pure';
import { hasRenderableOrbit } from '../../../src/catalog-format/binaries/binaries-format';
import { fold } from '../../util/counts/tally-pure';
import { promotionOriginKey } from './promotion-lineage-pure';
import { companionAbsmagIsObserved, companionCiIsObservedVia } from './companion-dust-pure';
import type { ConstellationAssignment } from '../parse/constellations/constellations';
import type { Star } from '../parse/stars-parse';
import { inheritedDesignationCon, NO_DESIGNATION_CON } from '../classic-ids/designation-constellation-pure';
import type { GaiaAstrometryRow } from '../sources/gaia-astrometry-source';
import { isCoherenceAnchorGrade } from '../multiplicity/anchor-grade-pure';
import { snapPhotometry } from '../multiplicity/system-coherence';
import { rebasedAnchorOffset } from './placement/anchor-offset-pure';
import type { MultiplesTsvRow } from './multiples-row';
import {
  adjustMinted, type CompanionAbsmagSource, type CompanionCiVia, type HeldRecordBrightness, type MintedBrightness,
  type PromotedRow, type PromotionStats, type RecordRewrite, type RecuratedBrightness, type RowOutcome, type SizingPass,
} from './promotion-outcome';
import {
  hasIndependentFitRoute, resolveEscapePosition, resolvePosition, type CompanionPlacement, type ProjectionAnchor,
} from './placement/placement';
import { SystemIndex, type PairCursor, type SystemAnchor } from './identity/system-index';
import { MintedIds, resolveRowIdentity } from './identity/row-identity';
import type { ParkedRefusals } from './identity/parked-refusals';
import { recordSpectralInfo, starDistPc } from './post-passes/held-record';
import { splitBlends, type BlendSplitCandidate } from './post-passes/blend-split';
import { SystemicGroups } from './post-passes/systemic-velocity';
import { ComponentSlots, reHomeInnerPairs } from './post-passes/inner-rehome';
import {
  ANCHOR_DIM_VERDICTS, anchorMagIsCatalogued, componentDepth, dimAnchors, type AnchorDimCandidate, type AnchorDimVerdict,
} from './post-passes/anchor-dim';


export const PHOTOMETRY_VIA_OWN = 'athyg_own' satisfies PhotometryVia;
export const PHOTOMETRY_VIA_SYSTEM_INHERITED = 'athyg_system_inherited' satisfies PhotometryVia;
export const PHOTOMETRY_VIA_GAIA = 'gaia_photometry' satisfies PhotometryVia;
export const PHOTOMETRY_VIA_NONE = 'none' satisfies PhotometryVia;

/** spect_via values whose `spect` string genuinely describes THIS
 *  component rather than the whole system: Stage 6's curated-override
 *  tier and the SIMBAD per-component join. `athyg` is the system
 *  primary's string inherited by every component. */
export const PER_COMPONENT_SPECT_VIA: ReadonlySet<string> = new Set([
  'curated',
  'simbad',
]);

/** True when the row's `ci` is its OWN observed B−V (dust-reddened), so
 *  build-time de-extinction must de-redden it. False when the row's ci is
 *  inherited from the system primary (Sirius B's row carrying Sirius A's
 *  0.009 white) or absent, and companionCi derives an intrinsic B−V from spectral type or the solar fallback —
 *  those are already extinction-free and must not be de-reddened. */
export function companionCiIsObserved(secondary: MultiplesTsvRow): boolean {
  return secondary.ci !== null
    && secondary.photometryVia !== PHOTOMETRY_VIA_SYSTEM_INHERITED;
}

export interface CompanionCi {
  value: number;
  via: CompanionCiVia;
}

/** The B−V a companion ships, de-reddened by `av` only where it is observed. */
export function companionCi(
  secondary: MultiplesTsvRow,
  spectralInfo: SpectralInfo,
  av: number,
): CompanionCi {
  const via: CompanionCiVia = companionCiIsObserved(secondary) ? 'own'
    : spectralClassColorIsDerivable(spectralInfo) ? 'spectral_derived' : 'none';
  const value = via === 'own' ? secondary.ci as number : spectralClassCi(spectralInfo);
  return { value: companionCiIsObservedVia(via) ? value - av / R_V : value, via };
}


export interface CompanionAbsmag {
  absmag: number;
  source: CompanionAbsmagSource;
}

/** Absmag sources that measure THIS component's own light — the gate for
 *  the MS-from-own-absmag spectral re-derivation. `inherited_twin` and
 *  `anchor_collocated` reproduce the anchor's brightness, so deriving a
 *  type from them would just re-mint the primary; `spectral` is itself
 *  type-derived and would be circular. */
export const OWN_BRIGHTNESS_ABSMAG_SOURCES: ReadonlySet<CompanionAbsmagSource> =
  new Set(['dmag_imputed', 'own', 'wds_mag']);

// Null means no honest brightness source, and the caller drops the row —
// except where the pair has a renderable orbit binaries.bin must keep
// addressing, which keeps the inherited twin and tags it.
//
// anchorDmagApplies is false for a pair-row-primary escape: that row's Δmag
// spans the SUB-pair it heads, not the anchor→row separation.
// ownPhotometryIsAnchorBlend is true when the escape row's only ids were
// inherited, so its "own" photometry was reached through the anchor's
// identifier and IS the anchor's blend.
function rowOwnWdsMag(row: MultiplesTsvRow): number | null {
  return row.orbitRole === 'primary' ? row.magPri : row.magSec;
}

export function imputeCompanionAbsmag(
  secondary: MultiplesTsvRow,
  primary: MultiplesTsvRow | null,
  spectral: SpectralInfo,
  anchorDmagApplies = true,
  ownPhotometryIsAnchorBlend = false,
): CompanionAbsmag | null {
  const primaryAbsmag = primary?.absmag ?? null;
  const dmag = secondary.dmag;
  const inheritedPhotometry =
    secondary.photometryVia === PHOTOMETRY_VIA_SYSTEM_INHERITED;

  if (anchorDmagApplies && inheritedPhotometry
      && primaryAbsmag !== null && dmag !== null) {
    return { absmag: primaryAbsmag + dmag, source: 'dmag_imputed' };
  }
  if (!inheritedPhotometry && !ownPhotometryIsAnchorBlend
      && secondary.absmag !== null) {
    return { absmag: secondary.absmag, source: 'own' };
  }
  if (anchorDmagApplies && primaryAbsmag !== null && dmag !== null) {
    return { absmag: primaryAbsmag + dmag, source: 'dmag_imputed' };
  }
  const ownWdsMag = rowOwnWdsMag(secondary);
  const distPc = secondary.distPc ?? primary?.distPc ?? null;
  if (ownWdsMag !== null && distPc !== null && distPc > 0) {
    return {
      absmag: absoluteMagnitude(ownWdsMag, distPc),
      source: 'wds_mag',
    };
  }
  if (PER_COMPONENT_SPECT_VIA.has(secondary.spectVia)) {
    const mv = absmagFromSpectral(spectral);
    if (mv !== null) return { absmag: mv, source: 'spectral' };
  }
  if (inheritedPhotometry && secondary.absmag !== null
      && hasRenderableOrbit(secondary)) {
    return { absmag: secondary.absmag, source: 'inherited_twin' };
  }
  if (!anchorDmagApplies && primaryAbsmag !== null) {
    return { absmag: primaryAbsmag, source: 'anchor_collocated' };
  }
  return null;
}

/** The observed-frame geometry a dim candidate is judged on: which WDS magnitude
 *  is the member's own and which the anchor's, how deep the letter that anchor
 *  magnitude describes sits, and the pair's separation. A pair-row-primary
 *  escape heads its own sub-pair, so its `mag_pri` IS the member's light and its
 *  offset from the anchor is the Stage-6 root composition rather than the row's
 *  own sep. */
function anchorDimGeometry(row: MultiplesTsvRow, anchorRow: MultiplesTsvRow): {
  memberWdsMag: number | null;
  anchorWdsMag: number | null;
  anchorDepth: number;
  sepArcsec: number | null;
} {
  const isPairRowPrimary = row.orbitRole === 'primary';
  return {
    memberWdsMag: isPairRowPrimary ? row.magPri : row.magSec,
    anchorWdsMag: isPairRowPrimary ? null : row.magPri,
    anchorDepth: componentDepth(anchorRow.comp),
    sepArcsec: isPairRowPrimary
      ? rebasedAnchorOffset(row, anchorRow)?.sepArcsec ?? null
      : row.sepArcsec,
  };
}

function resolveCompanionSpectral(row: MultiplesTsvRow): {
  info: SpectralInfo;
  display: string | null;
} {
  const raw = row.spect.trim();
  if (raw) {
    const parsed = classifyFromSimbad(raw);
    if (parsed) {
      const display = resolveSpectDisplay(raw, raw);
      return { info: parsed, display };
    }
  }
  return { info: SPECTRAL_UNKNOWN, display: null };
}

/** Not display names — the ladder composes those from structure
 *  (`../naming/README.md`). These probe AT-HYG's OWN convention, a name cell
 *  or the anchor's name with the component letter appended, and the index they
 *  hit holds the manifest's `proper` cells alone, so a base composed off a
 *  Bayer or catalogue designation could never match one. */
function athygDoubleProbeNames(
  ctx: PromoteRowContext,
  anchorStar: Star | null,
): string[] {
  const { row, anchorPrimaryRow, systemAnchorStar, canonicalComp } = ctx;
  if (!canonicalComp) return [];
  const bases = [
    row.name, anchorPrimaryRow.name, anchorStar?.proper ?? '',
    systemAnchorStar?.proper ?? '',
  ].map((b) => b.trim()).filter((b) => b !== '');
  return [...new Set(bases.map((base) => `${base} ${canonicalComp}`))];
}

/** True when a single-letter cursor-primary comp is DISJOINT from the
 *  anchor's comp token — not the same letter, not an ancestor/descendant,
 *  not contained in a compound anchor token. A disjoint letter resolving
 *  onto the anchor's record is a blended identifier, never a legitimate
 *  photocentre for that letter. */
export function isDisjointSingleLetter(
  comp: string,
  anchorComp: string,
): boolean {
  if (!/^[A-Z]$/.test(comp)) return false;
  const anchorLetters: string[] = anchorComp.match(/[A-Z]/g) ?? [];
  return !anchorLetters.includes(comp);
}

interface PromoteRowContext {
  row: MultiplesTsvRow;
  /** Multiples row of the anchor primary — drives the inherited-HIP gate.
   *  For the secondary loop this is cursor.primary; for the pair-row-primary
   *  escape this is the WDS-root system anchor's primary row. Must be the SAME
   *  row the caller resolved `position` against: `promotion.fit.owned`
   *  asks {@link hasIndependentFitRoute} what an id shared with it means, and a
   *  different row there makes the count answer about a different pairing. */
  anchorPrimaryRow: MultiplesTsvRow;
  /** Catalog Star of the local anchor primary; null when it never made it
   *  into the catalog. */
  anchorStar: Star | null;
  /** Catalog Star of the WDS-root system primary — the inheritance source
   *  when the local anchor is unresolved (δ Vel CD's local primary C never
   *  promotes). */
  systemAnchorStar: Star | null;
  /** Catalog index of the anchor primary — used by the inherited-HIP
   *  collision escape so the row's HIP-match-against-anchor doesn't
   *  classify as promotion.adopted.*. */
  anchorCatalogIdx: number | null;
  /** Pre-computed position for the row. Caller is responsible for
   *  resolving it (resolvePosition for secondaries; collocate-on-anchor
   *  for pair-row primaries). Null signals the position couldn't be
   *  resolved — drop with promotion.dropped.no-position. */
  position: CompanionPlacement | null;
  /** Canonical comp letter for the row — the composer's component letter post-sort. */
  canonicalComp: string;
  /** `composeSyntheticId` of the row over `canonicalComp`: the key a mint
   *  carries, and the one its PromotedRow records. */
  synthKey: string;
  /** True when this row is a pair-row-primary escape (the cursor primary
   *  itself, promoted as a companion of the WDS-root anchor); drives
   *  anchorDmagApplies=false in imputeCompanionAbsmag. */
  isPairRowPrimary: boolean;
}

type DimCandidate = AnchorDimCandidate & {
  /** Null for a member already in the catalogue. */
  minted: MintedBrightness | null;
};

type SplitCandidate = BlendSplitCandidate & { brightness: MintedBrightness };

interface PromotionState {
  index: SystemIndex;
  parked: ParkedRefusals;
  existingStars: Star[];
  existingStarsLength: number;
  newStars: Star[];
  readonly conAssignment: ConstellationAssignment;
  readonly dustGrid: DustGrid;
  minted: MintedIds;
  /** Records whose absmag came from a component's own Gaia photometry
   *  (`gaia_photometry`), keyed by the BACKING source_id (`row.gaiaSourceId`
   *  before any inherited-id strip). A source backing ≥2 of these is an
   *  unresolved blend whose combined light the post-pass splits. */
  gaiaPhotometryByBackingSource: Map<string, SplitCandidate[]>;
  /** See post-passes/README.md#anchor-flux-conservation. */
  anchorDimCandidates: DimCandidate[];
  /** `<anchorIdx> <memberIdx>` pairs already registered off an existing catalog
   *  record, so a member reached from two cursors subtracts its flux once. */
  existingDimMembers: Set<string>;
  gaiaAstrometry: Map<string, GaiaAstrometryRow>;
  synthGaiaBridges: Map<string, string>;
  /** Members already re-curated this run and where their brightness came
   *  from, so a member reached from two cursors is repositioned once and
   *  every registration of it reads the same source. */
  recuratedMembers: Map<number, RecuratedBrightness>;
  rewrites: Map<Star, RecordRewrite>;
}

function recordRewrite(
  state: PromotionState, star: Star, pass: SizingPass, radius: RadiusResolution, brightness?: HeldRecordBrightness,
): void {
  const held = state.rewrites.get(star);
  if (held === undefined) {
    state.rewrites.set(star, { sizing: { pass, radius }, brightness: brightness === undefined ? [] : [brightness] });
    return;
  }
  held.sizing = { pass, radius };
  if (brightness !== undefined) held.brightness.push(brightness);
}

/** post-passes/README.md#registration. */
function registerExistingMemberForAnchorDim(
  ctx: PromoteRowContext,
  state: PromotionState,
  memberIdx: number,
  recurated: RecuratedBrightness | null,
): void {
  const { row, anchorPrimaryRow, anchorStar, anchorCatalogIdx } = ctx;
  if (recurated === 'spectral') return;
  if (anchorCatalogIdx === null || anchorStar === null
      || memberIdx === anchorCatalogIdx
      || !anchorMagIsCatalogued(anchorStar)) {
    return;
  }
  const pairKey = `${anchorCatalogIdx} ${memberIdx}`;
  if (state.existingDimMembers.has(pairKey)) return;
  state.existingDimMembers.add(pairKey);
  const member = state.existingStars[memberIdx];
  state.anchorDimCandidates.push({
    anchorIdx: anchorCatalogIdx,
    member,
    memberSpectral: recordSpectralInfo(member),
    source: recurated === null || recurated === 'held' ? 'own' : recurated,
    dmag: row.dmag,
    // post-passes/README.md#the-separation-gate: never structural.
    structural: false,
    ...anchorDimGeometry(row, anchorPrimaryRow),
    av: avSolToStar(state.dustGrid, member.x, member.y, member.z),
    minted: null,
  });
}

function deExtinctCompanionAbsmag(imputed: CompanionAbsmag, av: number): number {
  return companionAbsmagIsObserved(imputed.source) ? imputed.absmag - av : imputed.absmag;
}

/** The two tiers that place a record ON its own Gaia 5p solution. */
const DIST_VIA_OWN_GAIA_FIT: ReadonlySet<string> = new Set([
  'bailer_jones', 'gaia_dr3_inversion',
]);

/** See README.md#re-curation-of-an-already-in-catalog-member. */
function ownFitFailsAnchorGrade(
  star: Star, gaiaAstrometry: Map<string, GaiaAstrometryRow>,
): boolean {
  if (star.gaiaSourceId === null) return false;
  if (star.distVia === null || !DIST_VIA_OWN_GAIA_FIT.has(star.distVia)) {
    return false;
  }
  const g = gaiaAstrometry.get(star.gaiaSourceId);
  return g !== undefined && !isCoherenceAnchorGrade(g);
}

function isCuratedRecurationSource(
  source: CompanionAbsmag['source'],
): source is Exclude<RecuratedBrightness, 'held'> {
  return source === 'dmag_imputed' || source === 'wds_mag'
    || source === 'spectral';
}

/** Applied in place, so this adds no star and retires none.
 *  See README.md#re-curation-of-an-already-in-catalog-member. */
function recurateExistingMember(
  ctx: PromoteRowContext,
  state: PromotionState,
  memberIdx: number,
): RecuratedBrightness | null {
  const prior = state.recuratedMembers.get(memberIdx);
  if (prior !== undefined) return prior;
  const { row, anchorPrimaryRow, anchorStar, systemAnchorStar, position,
          isPairRowPrimary } = ctx;
  if (isPairRowPrimary || position === null) return null;
  if (hasIndependentFitRoute(
    row, anchorPrimaryRow.gaiaSourceId, anchorPrimaryRow.hip,
  )) {
    return null;
  }
  const member = state.existingStars[memberIdx];
  if (!ownFitFailsAnchorGrade(member, state.gaiaAstrometry)) return null;

  const avAt = (s: { x: number; y: number; z: number }): number =>
    avSolToStar(state.dustGrid, s.x, s.y, s.z);
  const dOld = starDistPc(member);
  const avOld = avAt(member);
  const dNew = starDistPc(position);
  const avNew = avAt(position);

  member.x = position.x;
  member.y = position.y;
  member.z = position.z;
  member.conIndex = state.conAssignment.indexAt(position.x, position.y, position.z);
  const inheritAnchor = anchorStar ?? systemAnchorStar;
  if (inheritAnchor !== null) {
    member.vx = inheritAnchor.vx;
    member.vy = inheritAnchor.vy;
    member.vz = inheritAnchor.vz;
  }
  member.distVia = inheritAnchor?.distVia ?? null;
  const spectral = recordSpectralInfo(member);
  const imputed = imputeCompanionAbsmag(row, anchorPrimaryRow, spectral);
  let change: HeldRecordBrightness;
  if (imputed !== null && isCuratedRecurationSource(imputed.source)) {
    const source = imputed.source;
    const wdsMag = rowOwnWdsMag(row);
    const absmag = source === 'wds_mag' && wdsMag !== null
      ? absoluteMagnitude(wdsMag, dNew) : imputed.absmag;
    member.absmag = deExtinctCompanionAbsmag({ absmag, source }, avNew);
    const ci = companionCi(row, spectral, avNew);
    member.ci = ci.value;
    change = { pass: 'recurated', source, absmag: member.absmag, av: avNew, ci: ci.via };
  } else {
    if (dOld > 0 && dNew > 0) {
      member.absmag = snapPhotometry(member.absmag, { pc: dOld, av: avOld }, { pc: dNew, av: avNew }).toAbsmag;
    }
    change = {
      pass: 'recurated', source: 'held', absmag: member.absmag, fromPc: dOld, toPc: dNew, avFrom: avOld, avTo: avNew,
    };
  }
  const radius = physicalRadius(member.absmag, spectral);
  member.physicalRadius = radius.rSun;
  recordRewrite(state, member, 'recurated', radius, change);
  state.recuratedMembers.set(memberIdx, change.source);
  return change.source;
}

/** Every route by which a pair row resolves to a record the catalogue
 *  already holds ends here, so each gets the same treatment. */
function adoptExistingMember(
  ctx: PromoteRowContext,
  state: PromotionState,
  memberIdx: number,
  via: 'own-id' | 'own-hip' | 'sameas-bridge',
): RowOutcome {
  const desigConFromAnchor = inheritAnchorDesignationCon(
    state.existingStars[memberIdx], ctx.anchorStar ?? ctx.systemAnchorStar,
  );
  const recurated = recurateExistingMember(ctx, state, memberIdx);
  registerExistingMemberForAnchorDim(ctx, state, memberIdx, recurated);
  return { kind: 'adopted', idx: memberIdx, via, desigConFromAnchor, recurated };
}

/** A record a pair row resolves to displays a name composed off the anchor
 *  ("Fomalhaut C"), so it is named for the ANCHOR's designation whatever its
 *  own position says — the same rule the mint path applies. It reaches
 *  existing records only since the primaries began admitting components in
 *  their own right: Fomalhaut C arrives as CNS5's GJ 13282, sits in Aquarius,
 *  and is α PsA C. Only fills an empty value, so a record IV/27A or the naming
 *  ladder already answered for keeps its own. */
function inheritAnchorDesignationCon(
  member: Star,
  anchor: Star | null,
): boolean {
  if (anchor === null || member.desigCon.via !== 'none') return false;
  member.desigCon = inheritedDesignationCon(anchor.desigCon);
  return member.desigCon.via !== 'none';
}

/** Shared by the secondary loop and the pair-row-primary escape; only the
 *  position and anchor sources differ between them. */
function promoteRow(
  ctx: PromoteRowContext,
  state: PromotionState,
): RowOutcome {
  const { row, anchorPrimaryRow, anchorStar, systemAnchorStar, anchorCatalogIdx,
          position, canonicalComp, isPairRowPrimary, synthKey: synthId } = ctx;
  const identity = resolveRowIdentity(
    row, { primaryRow: anchorPrimaryRow, star: anchorStar, catalogIdx: anchorCatalogIdx }, canonicalComp, synthId, state,
  );
  if (identity.kind === 'decided') return identity.outcome;
  if (identity.kind === 'held') return adoptExistingMember(ctx, state, identity.idx, identity.via);
  const { gaia: companionGaia, hip: companionHip, synthetic: usesSynth, idsInheritedFromAnchor } = identity;
  if (position === null) {
    return { kind: 'dropped', reason: 'no-position' };
  }
  let spectral = resolveCompanionSpectral(row);
  const imputed = imputeCompanionAbsmag(
    row, anchorPrimaryRow, spectral.info, !isPairRowPrimary,
    isPairRowPrimary && idsInheritedFromAnchor,
  );
  if (imputed === null) {
    return { kind: 'dropped', reason: 'no-absmag' };
  }
  let absmag = imputed.absmag;
  // Runs before the MS re-derivation below, whose MV_MS_TABLE calibration
  // is intrinsic M_V.
  const av = avSolToStar(state.dustGrid, position.x, position.y, position.z);
  absmag = deExtinctCompanionAbsmag(imputed, av);
  const spectMsFromOwnAbsmag = !PER_COMPONENT_SPECT_VIA.has(row.spectVia)
    && OWN_BRIGHTNESS_ABSMAG_SOURCES.has(imputed.source);
  if (spectMsFromOwnAbsmag) {
    spectral = { info: spectralFromAbsmag(absmag), display: null };
  }
  const ci = companionCi(row, spectral.info, av);
  const brightness: MintedBrightness = {
    source: imputed.source, spectMsFromOwnAbsmag, ci: ci.via, av, adjustment: null,
  };
  // README.md#promoted-companion-field-inheritance.
  const inheritAnchor = anchorStar ?? systemAnchorStar;
  const anchorVel = inheritAnchor
    ? { x: inheritAnchor.vx, y: inheritAnchor.vy, z: inheritAnchor.vz }
    : { x: 0, y: 0, z: 0 };
  if (anchorStar !== null && anchorCatalogIdx !== null) {
    for (const probe of athygDoubleProbeNames(ctx, anchorStar)) {
      const dupIdx = state.index.existingOnProper(probe);
      if (dupIdx === undefined || dupIdx === anchorCatalogIdx) continue;
      const dup = state.existingStars[dupIdx];
      if (dup.x === anchorStar.x && dup.y === anchorStar.y && dup.z === anchorStar.z) {
        throw new Error(
          `${row.systemId} ${row.comp}: ${dup.originKey} ("${probe}") sits bit-identically on its anchor `
            + `${anchorStar.originKey}, reached by name alone — a membership record for this component `
            + 'with no identifier the row resolves (README.md#collocated-double-refusal)',
        );
      }
    }
  }
  let flags = FLAG_BINARY_COMPANION_ONLY;
  if (usesSynth) flags |= FLAG_BINARY_COMPANION_SYNTHETIC;

  const conIndex = state.conAssignment.indexAt(position.x, position.y, position.z);
  const desigCon = inheritAnchor === undefined || inheritAnchor === null
    ? NO_DESIGNATION_CON : inheritedDesignationCon(inheritAnchor.desigCon);

  const mintRadius = physicalRadius(absmag, spectral.info);
  state.newStars.push({
    x: position.x, y: position.y, z: position.z,
    vx: anchorVel.x, vy: anchorVel.y, vz: anchorVel.z,
    absmag, ci: ci.value,
    spectral: spectral.info,
    physicalRadius: mintRadius.rSun,
    conIndex,
    desigCon,
    flags,
    proper: null,
    iauName: null,
    eponym: null,
    bayer: null,
    bayerSup: null,
    bayerComponent: null,
    gould: null,
    gouldHalf: null,
    aliases: [],
    hip: companionHip,
    hd: null,
    hr: null,
    hdAlt: [],
    hrAlt: [],
    flam: null,
    gl: null,
    tyc: null,
    gaiaSourceId: companionGaia,
    spectDisplay: spectral.display,
    companionIdx: -1,
    periodDays: 0,
    amplitudeMag: 0,
    varType: 0,
    gcvsName: null,
    plxDistPc: null,
    plxVia: null,
    distVia: inheritAnchor?.distVia ?? null,
    vVia: null,
    syntheticId: usesSynth ? synthId : null,
    originKey: promotionOriginKey(row),
  });
  const newIdx = state.existingStarsLength + state.newStars.length - 1;
  recordRewrite(state, state.newStars[state.newStars.length - 1], 'mint', mintRadius);
  // post-passes/README.md#anchor-flux-conservation.
  if (OWN_BRIGHTNESS_ABSMAG_SOURCES.has(imputed.source)
      && anchorCatalogIdx !== null && anchorStar !== null
      && anchorMagIsCatalogued(anchorStar)) {
    state.anchorDimCandidates.push({
      anchorIdx: anchorCatalogIdx,
      member: state.newStars[state.newStars.length - 1],
      memberSpectral: spectral.info,
      source: imputed.source as 'wds_mag' | 'dmag_imputed' | 'own',
      dmag: row.dmag,
      structural: idsInheritedFromAnchor,
      ...anchorDimGeometry(row, anchorPrimaryRow),
      av,
      minted: brightness,
    });
  }
  // post-passes/README.md#blend-split: keyed on the source before the strip.
  if (imputed.source === 'own' && row.photometryVia === PHOTOMETRY_VIA_GAIA
      && row.gaiaSourceId !== null) {
    const bucket = state.gaiaPhotometryByBackingSource.get(row.gaiaSourceId);
    const cand: SplitCandidate = {
      star: state.newStars[state.newStars.length - 1],
      spectral: spectral.info,
      brightness,
    };
    if (bucket) bucket.push(cand);
    else state.gaiaPhotometryByBackingSource.set(row.gaiaSourceId, [cand]);
  }
  state.minted.register(newIdx, { gaia: companionGaia, hip: companionHip, synth: usesSynth ? synthId : null });
  return {
    kind: 'minted',
    idx: newIdx,
    synthetic: usesSynth,
    brightness,
    constellationSplit: inheritAnchor !== null && conIndex !== inheritAnchor.conIndex,
  };
}

export interface PromotionInputs {
  conAssignment: ConstellationAssignment;
  dustGrid: DustGrid;
  parked: ParkedRefusals;
  gaiaAstrometry: Map<string, GaiaAstrometryRow>;
  synthGaiaBridges: Map<string, string>;
}

export function promoteCompanions(
  multiplesRows: MultiplesTsvRow[],
  existingStars: Star[],
  inputs: PromotionInputs,
): {
  newStars: Star[]; stats: PromotionStats; rows: PromotedRow[];
  rewrites: ReadonlyMap<Star, Readonly<RecordRewrite>>;
} {
  const index = new SystemIndex(multiplesRows, existingStars);
  const state: PromotionState = {
    ...inputs,
    index,
    existingStars,
    existingStarsLength: existingStars.length,
    newStars: [],
    minted: new MintedIds(),
    gaiaPhotometryByBackingSource: new Map(),
    anchorDimCandidates: [],
    existingDimMembers: new Set(),
    recuratedMembers: new Map(),
    rewrites: new Map(),
  };
  const starAt = (idx: number): Star =>
    idx < existingStars.length ? existingStars[idx] : state.newStars[idx - existingStars.length];

  const { promoted, slots, systemic } = walkCursors(index, state, starAt);

  const reHomed = reHomeInnerPairs(index.groups.values(), slots, state.minted, starAt);
  systemic.reconcile(starAt);
  for (const { cand, n, radius } of splitBlends(state.gaiaPhotometryByBackingSource.values())) {
    adjustMinted(cand.brightness, { pass: 'blend-split', n });
    recordRewrite(state, cand.star, 'blend-split', radius);
  }
  const dimmed = dimAnchors(state.anchorDimCandidates, starAt);
  for (const { anchor, anchorAbsmag, anchorRadius, reSplit, members } of dimmed.dims) {
    for (const { cand, absmag, radius } of reSplit) {
      if (cand.minted !== null) adjustMinted(cand.minted, { pass: 'anchor-re-split', anchorIdx: cand.anchorIdx });
      recordRewrite(state, cand.member, 'anchor-re-split', radius, cand.minted === null
        ? { pass: 'anchor-re-split', anchorIdx: cand.anchorIdx, absmag } : undefined);
    }
    recordRewrite(state, anchor, 'anchor-dimmed', anchorRadius, { pass: 'anchor-dimmed', absmag: anchorAbsmag, members });
  }

  const rows = multiplesRows.map((row) => {
    const r = promoted.get(row);
    if (r === undefined) throw new Error(`promotion recorded no outcome for ${row.systemId}/${row.comp}`);
    return r;
  });
  return {
    newStars: state.newStars, stats: promotionStats(reHomed, dimmed.verdicts), rows, rewrites: state.rewrites,
  };
}

function promotionStats(reHomed: readonly Star[], dimVerdicts: readonly { verdict: AnchorDimVerdict }[]): PromotionStats {
  const dim = fold(ANCHOR_DIM_VERDICTS, dimVerdicts, (v) => v.verdict);
  return {
    companionRepositionedInnerToParent: reHomed.length,
    companionBlendDimSkipped: dim.skipped,
    companionBlendDimUnfit: dim.unfit,
    companionBlendDimOutside: dim.outside,
    companionBlendDimGaiaResolved: dim['gaia-resolved'],
    companionBlendDimBeyondSeparation: dim['beyond-separation'],
    companionBlendDimMisfit: dim.misfit,
  };
}

/** The cursor walk: every row's outcome, plus what the post-passes read off it. */
function walkCursors(
  index: SystemIndex,
  state: PromotionState,
  starAt: (idx: number) => Star,
): { promoted: Map<MultiplesTsvRow, PromotedRow>; slots: ComponentSlots; systemic: SystemicGroups } {
  const promoted = new Map<MultiplesTsvRow, PromotedRow>();
  const record = (r: PromotedRow): void => {
    if (promoted.has(r.row)) throw new Error(`promotion decided ${r.row.systemId}/${r.row.comp} twice`);
    promoted.set(r.row, r);
  };
  const slots = new ComponentSlots();
  const systemic = new SystemicGroups();
  const keyAt = (idx: number | null): string | null => (idx === null ? null : starAt(idx).originKey);
  const unpaired = (row: MultiplesTsvRow): PromotedRow => (
    {
      row, via: 'unpaired', outcome: { kind: 'unpaired' }, anchor: null, systemAnchor: null,
      synthKey: composeSyntheticId(row.systemId, row.comp),
    }
  );
  const escaped = new Set<MultiplesTsvRow>();
  const escapeCursorPrimary = (cursor: PairCursor): number | null => {
    const anchor = escapeAnchorOf(cursor, index);
    if (anchor === null) return null;
    const synthKey = composeSyntheticId(anchor.primary.systemId, anchor.primary.comp);
    const outcome = promoteCursorPrimary(anchor.primary, anchor.system, synthKey, state);
    const systemKey = anchor.system.star.originKey;
    record({ row: anchor.primary, via: 'escape', outcome, anchor: systemKey, systemAnchor: systemKey, synthKey });
    escaped.add(anchor.primary);
    return placedRecordIdx(outcome);
  };

  for (const cursor of index.groups.values()) {
    // A standalone row is no side of a WDS pair, so it has no pair geometry to promote on.
    if (cursor.primary === null) {
      for (const row of cursor.secondaries) record(unpaired(row));
      continue;
    }

    // Existing records first, then previously-promoted ones — 40 Eri B is
    // promoted in the BC group and reused as the anchor for BD.
    let primaryCatalogIdx = index.findExistingPrimary(cursor.primary);
    const primarySynthKey = composeSyntheticId(cursor.primary.systemId, cursor.primary.comp);
    const cursorRoot = wdsRootOf(cursor.primary.systemId);
    const rootAnchor = index.rootAnchor(cursorRoot);
    if (
      primaryCatalogIdx !== null && rootAnchor !== undefined
      && primaryCatalogIdx === rootAnchor.catalogIdx
      && cursor.primary !== rootAnchor.primaryRow
      && isDisjointSingleLetter(cursor.primary.comp, rootAnchor.primaryRow.comp)
    ) {
      // README.md#blended-identifier-escape.
      const escapedIdx =
        state.minted.onSynth(primarySynthKey) ?? escapeCursorPrimary(cursor);
      if (escapedIdx !== null && escapedIdx !== undefined) {
        primaryCatalogIdx = escapedIdx;
      }
    }
    if (primaryCatalogIdx === null) {
      primaryCatalogIdx = state.minted.lookup(cursor.primary);
    }
    if (primaryCatalogIdx === null) {
      // Pair-row-primary escape: 40 Eri B is a primary in BC/BD/BE but never a
      // secondary of A, so the secondary loop never reaches it.
      primaryCatalogIdx = escapeCursorPrimary(cursor);
    }
    const anchorStar = primaryCatalogIdx !== null ? starAt(primaryCatalogIdx) : null;
    const anchor: ProjectionAnchor | null = anchorStar !== null
      ? { x: anchorStar.x, y: anchorStar.y, z: anchorStar.z } : null;

    const anchorKey = keyAt(primaryCatalogIdx);
    const systemAnchorKey = rootAnchor?.star.originKey ?? null;
    if (!escaped.has(cursor.primary)) {
      record({
        row: cursor.primary,
        via: 'primary',
        outcome: { kind: primaryCatalogIdx === null ? 'primary-unresolved' : 'pair-anchor' },
        anchor: anchorKey, systemAnchor: systemAnchorKey,
        synthKey: primarySynthKey,
      });
    }
    if (primaryCatalogIdx !== null) slots.claimByPrimary(cursorRoot, cursor.primary.comp, primaryCatalogIdx);

    for (const row of cursor.secondaries) {
      if (row.orbitRole !== 'secondary') {
        record(unpaired(row));
        continue;
      }
      const canonicalComp = canonicalCompLetter(cursor.primary.comp, row.comp);
      const synthKey = composeSyntheticId(row.systemId, canonicalComp);
      const decided = (outcome: RowOutcome): PromotedRow => ({
        row, via: 'secondary', outcome, anchor: anchorKey, systemAnchor: systemAnchorKey, synthKey,
      });
      const wdsRoot = wdsRootOf(row.systemId);
      if (wdsRoot !== null && index.isUnresolvedCompound(row.comp, wdsRoot)) {
        record(decided({ kind: 'dropped', reason: 'compound-comp' }));
        continue;
      }
      const resolved = resolvePosition(row, cursor.primary, anchor);
      if (resolved === 'beyond-tidal') {
        record(decided({ kind: 'dropped', reason: 'beyond-tidal-limit' }));
        continue;
      }
      const outcome = promoteRow(
        {
          row,
          anchorPrimaryRow: cursor.primary,
          anchorStar,
          systemAnchorStar: rootAnchor?.star ?? null,
          anchorCatalogIdx: primaryCatalogIdx,
          position: resolved,
          canonicalComp,
          synthKey,
          isPairRowPrimary: false,
        },
        state,
      );
      record(decided(outcome));
      const promotedIdx = placedRecordIdx(outcome);
      if (promotedIdx !== null) slots.claimBySecondary(wdsRoot, canonicalComp, promotedIdx);
      // post-passes/README.md#systemic-velocity.
      if (hasRenderableOrbit(row) && primaryCatalogIdx !== null) {
        const secIdx = promotedIdx
          ?? (row.gaiaSourceId !== null || (row.hip !== null && row.hip > 0)
            ? index.findExisting(row) : null);
        if (secIdx !== null && secIdx !== primaryCatalogIdx) {
          const root = wdsRoot ?? row.systemId;
          systemic.add(root, index.rootAnchor(root)?.catalogIdx ?? primaryCatalogIdx, primaryCatalogIdx, secIdx, row.q);
        }
      }
    }
  }
  return { promoted, slots, systemic };
}

interface EscapeAnchor {
  primary: MultiplesTsvRow;
  system: SystemAnchor;
}

function escapeAnchorOf(
  cursor: PairCursor,
  index: SystemIndex,
): EscapeAnchor | null {
  const primary = cursor.primary;
  if (primary === null) return null;
  // No own-identifier requirement: an id-less row mints an addressable
  // synth-<wds>-<comp> slot like any identifier-less secondary, and the gates
  // in promoteCursorPrimary are position and brightness rather than identity.
  const wdsRoot = wdsRootOf(primary.systemId);
  if (wdsRoot === null) return null;
  const system = index.rootAnchor(wdsRoot);
  if (!system) return null;
  if (system.primaryRow === primary) return null;  // would self-promote
  return { primary, system };
}

function promoteCursorPrimary(
  primary: MultiplesTsvRow,
  anchor: SystemAnchor,
  synthKey: string,
  state: PromotionState,
): RowOutcome {
  const position = resolveEscapePosition(primary, anchor.primaryRow, anchor.star);
  if (position === 'beyond-tidal') return { kind: 'dropped', reason: 'beyond-tidal-limit' };
  if (position === null) return { kind: 'dropped', reason: 'collocated-primary' };
  return promoteRow(
    {
      row: primary,
      anchorPrimaryRow: anchor.primaryRow,
      anchorStar: anchor.star,
      systemAnchorStar: anchor.star,
      anchorCatalogIdx: anchor.catalogIdx,
      position,
      canonicalComp: primary.comp,
      synthKey,
      isPairRowPrimary: true,
    },
    state,
  );
}

/** The record a row minted. */
function placedRecordIdx(outcome: RowOutcome): number | null {
  return outcome.kind === 'minted' ? outcome.idx : null;
}
