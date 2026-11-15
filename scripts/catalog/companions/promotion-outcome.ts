// What companion promotion decides per row and per record, and the counts it keeps beyond its lineage. See README.md#companion-promotion-from-databinariesmultiplestsv.

import type { RadiusResolution } from '../../../src/catalog-format/spectral/physical-radius';
import type { Star } from '../parse/stars-parse';
import type { MultiplesTsvRow } from './multiples-row';

/** How a pair row reached a record the catalogue already held — identity/README.md#row-identity. */
export type HeldVia = 'own-id' | 'own-hip' | 'sameas-bridge';

/** One pair row's promotion decision, serialised by promotion-lineage/promotion-lineage-pure.ts. */
export type RowOutcome =
  | {
    kind: 'dropped';
    reason: 'compound-comp' | 'beyond-tidal-limit' | 'collocated-primary'
      | 'no-position' | 'no-absmag';
  }
  | { kind: 'dropped'; reason: 'anchor-is-component'; idx: number }
  | { kind: 'dropped'; reason: 'parked-record'; parked: string; viaGaia5p: boolean; ownedFit: boolean }
  | { kind: 'adopted'; idx: number; via: 'earlier-mint' }
  | {
    kind: 'adopted';
    idx: number;
    via: HeldVia;
    desigConFromAnchor: boolean;
    recurated: RecuratedBrightness | null;
  }
  | {
    kind: 'minted';
    idx: number;
    synthetic: boolean;
    brightness: MintedBrightness;
    constellationSplit: boolean;
  }
  | { kind: 'primary-unresolved' }
  | { kind: 'unpaired' }
  | { kind: 'pair-anchor' };

export interface MintedBrightness {
  source: CompanionAbsmagSource;
  spectMsFromOwnAbsmag: boolean;
  ci: CompanionCiVia;
  /** The Sol-to-star A_V at the minted position, whether or not either value took it. */
  av: number;
  /** The post-pass that changed the minted absmag, if one did. */
  adjustment: MintedAdjustment | null;
}

export type MintedAdjustment =
  | { pass: 'blend-split'; n: number }
  | { pass: 'anchor-re-split'; anchorIdx: number };

export type SizingPass = 'mint' | 'recurated' | 'blend-split' | 'anchor-dimmed' | 'anchor-re-split';

/** A change promotion made to the brightness of a record the catalogue already held. */
export type HeldRecordBrightness =
  | {
    pass: 'recurated'; source: Exclude<RecuratedBrightness, 'held'>;
    absmag: number; av: number; ci: CompanionCiVia;
  }
  | { pass: 'recurated'; source: 'held'; absmag: number; fromPc: number; toPc: number; avFrom: number; avTo: number }
  | { pass: 'anchor-dimmed'; absmag: number; members: readonly string[] }
  | { pass: 'anchor-re-split'; anchorIdx: number; absmag: number };

/** See promotion-lineage/README.md. */
export interface RecordRewrite {
  sizing: { pass: SizingPass; radius: RadiusResolution };
  brightness: HeldRecordBrightness[];
}

/** The held records promotion re-curated onto their anchor's position. */
export function recuratedRecords(rewrites: ReadonlyMap<Star, Readonly<RecordRewrite>>): Star[] {
  return [...rewrites].flatMap(([star, r]) => (r.brightness.some((b) => b.pass === 'recurated') ? [star] : []));
}

/** Blend split takes only `own` mints and the anchor re-split only `dmag_imputed` ones, so a second pass is a bug. */
export function adjustMinted(b: MintedBrightness, a: MintedAdjustment): void {
  if (b.adjustment !== null) {
    throw new Error(`minted record adjusted by ${a.pass} after ${b.adjustment.pass}`);
  }
  b.adjustment = a;
}


/** See promotion-lineage/README.md. */
export interface PromotedRow {
  row: MultiplesTsvRow;
  via: 'secondary' | 'escape' | 'primary' | 'unpaired';
  outcome: RowOutcome;
  anchor: string | null;
  systemAnchor: string | null;
  /** The synthetic key a mint from this row would carry, whether or not it minted. */
  synthKey: string;
}

/** What promoteCompanions tallies beyond its lineage; field names are snapshot keys in promotion-derived.
 *  Each folds from a post-pass's outcomes — post-passes/README.md. */
export type PromotionStats = {
  companionRepositionedInnerToParent: number;
  companionBlendDimSkipped: number;
  companionBlendDimUnfit: number;
  companionBlendDimOutside: number;
  companionBlendDimGaiaResolved: number;
  companionBlendDimBeyondSeparation: number;
  companionBlendDimMisfit: number;
};

/** `own` = the row's observed B−V; `spectral_derived` = its class's
 *  intrinsic colour; `none` = no derivable class, so the solar B−V. */
export type CompanionCiVia = 'own' | 'spectral_derived' | 'none';

/** `dmag_imputed` = primary + WDS Δmag; `own` = the row's own
 *  (non-inherited) photometry;
 *  `wds_mag` = the row's own WDS apparent magnitude at the system
 *  distance (M = m − 5·log₁₀(d/10)) — fires when both Δmag paths are
 *  unavailable, ahead of the spectral calibration;
 *  `spectral` = class→M_V from the row's per-component spectral type;
 *  `inherited_twin` = the inherited primary absmag kept ONLY because
 *  the pair has a renderable orbit (dropping the record would also
 *  drop its orbit/eclipse from binaries.bin) and no honest brightness
 *  source exists yet; `anchor_collocated` = a pair-row-primary escape
 *  falling back to the anchor's brightness (see imputeCompanionAbsmag). */
export type CompanionAbsmagSource =
  | 'dmag_imputed'
  | 'own'
  | 'wds_mag'
  | 'spectral'
  | 'inherited_twin'
  | 'anchor_collocated';

/** Where a re-curated member's brightness came from: a curated source, or
 *  `held` — its own apparent brightness, carried across the move. */
export type RecuratedBrightness = 'dmag_imputed' | 'wds_mag' | 'spectral' | 'held';
