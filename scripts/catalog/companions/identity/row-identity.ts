// Which record a pair row names: one already held, one minted earlier this build, a refusal, or a new one. See README.md#row-identity.

import type { NamedStar } from '../../parse/stars-parse';
import type { MultiplesTsvRow } from '../multiples-row';
import type { HeldVia, RowOutcome } from '../promotion-outcome';
import { hasIndependentFitRoute } from '../placement/placement';
import { refusalStated, type ParkedRefusals } from './parked-refusals';
import type { SystemIndex } from './system-index';

/** The records promotion minted this build, by the ids they carry. */
export class MintedIds {
  private readonly byGaia = new Map<string, number>();
  private readonly byHip = new Map<number, number>();
  private readonly bySynth = new Map<string, number>();

  register(idx: number, ids: { gaia: string | null; hip: number | null; synth: string | null }): void {
    if (ids.synth !== null) this.bySynth.set(ids.synth, idx);
    if (ids.gaia) this.byGaia.set(ids.gaia, idx);
    if (ids.hip !== null) this.byHip.set(ids.hip, idx);
  }

  onSynth(key: string): number | null {
    return this.bySynth.get(key) ?? null;
  }

  /** A row's earlier mint by its Gaia source, else its HIP. */
  lookup(row: MultiplesTsvRow): number | null {
    const onGaia = row.gaiaSourceId ? this.onGaia(row.gaiaSourceId) : null;
    if (onGaia !== null) return onGaia;
    return row.hip !== null && row.hip > 0 ? this.onHip(row.hip) : null;
  }

  onGaia(sourceId: string): number | null {
    return this.byGaia.get(sourceId) ?? null;
  }

  onHip(hip: number): number | null {
    return this.byHip.get(hip) ?? null;
  }
}

export interface RowAnchor {
  /** The anchor primary's multiples row — the inheritance gates' reference. */
  primaryRow: MultiplesTsvRow;
  star: NamedStar | null;
  catalogIdx: number | null;
}

export interface IdentitySources {
  index: SystemIndex;
  minted: MintedIds;
  parked: ParkedRefusals;
  synthGaiaBridges: ReadonlyMap<string, string>;
}

type DecidedOutcome = Extract<RowOutcome, { reason: 'anchor-is-component' | 'parked-record' } | { via: 'earlier-mint' }>;

export type RowIdentity =
  /** Decided here: a refusal, or an earlier mint. */
  | { kind: 'decided'; outcome: DecidedOutcome }
  /** A record the catalogue already holds IS this component. */
  | { kind: 'held'; idx: number; via: HeldVia }
  /** A new record, carrying the ids that survive the inheritance gates. */
  | {
    kind: 'new';
    gaia: string | null;
    hip: number | null;
    /** Neither id survives: addressed by its synthetic key alone. */
    synthetic: boolean;
    /** README.md#gaia-and-hip-inheritance-gates. */
    idsInheritedFromAnchor: boolean;
  };

export function resolveRowIdentity(
  row: MultiplesTsvRow,
  anchor: RowAnchor,
  canonicalComp: string,
  synthKey: string,
  sources: IdentitySources,
): RowIdentity {
  const { index, minted } = sources;
  const rowHasOwnHip = row.hip !== null && row.hip > 0;
  const inheritedGaia = row.gaiaSourceId !== null
    && (anchor.primaryRow.gaiaSourceId === row.gaiaSourceId
      || (anchor.star !== null && anchor.star.gaiaSourceId === row.gaiaSourceId));
  const gaia = inheritedGaia ? null : row.gaiaSourceId;
  const inheritedHip = rowHasOwnHip
    && (anchor.primaryRow.hip === row.hip
      || (anchor.star !== null && anchor.star.hip === row.hip));
  if (row.gaiaSourceId !== null || rowHasOwnHip) {
    const existingIdx = index.findExisting(row);
    const inheritedIdCollision =
      existingIdx !== null
      && (row.gaiaSourceId === null || inheritedGaia)
      && anchor.catalogIdx !== null
      && existingIdx === anchor.catalogIdx;
    if (existingIdx !== null && !inheritedIdCollision) return { kind: 'held', idx: existingIdx, via: 'own-id' };
    if (inheritedIdCollision && anchor.catalogIdx !== null && anchor.star !== null
        && anchor.star.bayerComponent === canonicalComp) {
      return { kind: 'decided', outcome: { kind: 'dropped', reason: 'anchor-is-component', idx: anchor.catalogIdx } };
    }
    if (existingIdx === null && row.gaiaSourceId !== null && rowHasOwnHip) {
      const hipHit = index.existingOnHip(row.hip as number);
      if (hipHit !== undefined && hipHit !== anchor.catalogIdx) return { kind: 'held', idx: hipHit, via: 'own-hip' };
    }
  }
  const mintedOnGaia = gaia ? minted.onGaia(gaia) : null;
  if (mintedOnGaia !== null) {
    return { kind: 'decided', outcome: { kind: 'adopted', idx: mintedOnGaia, via: 'earlier-mint' } };
  }
  const mintedOnHip = rowHasOwnHip && gaia === null ? minted.onHip(row.hip as number) : null;
  if (mintedOnHip !== null) {
    return { kind: 'decided', outcome: { kind: 'adopted', idx: mintedOnHip, via: 'earlier-mint' } };
  }
  // Before the inheritance gates strip the ids it recognises a sibling by — README.md#refused-parallax-refusal.
  const parked = refusalStated(sources.parked, row);
  if (parked !== null) {
    return {
      kind: 'decided',
      outcome: {
        kind: 'dropped',
        reason: 'parked-record',
        parked,
        viaGaia5p: row.astrometryVia === 'gaia_5p',
        ownedFit: hasIndependentFitRoute(row, anchor.primaryRow.gaiaSourceId, anchor.primaryRow.hip),
      },
    };
  }
  const hip = inheritedHip ? null : row.hip;
  const synthetic = gaia === null && hip === null;
  if (synthetic) {
    const mintedOnSynth = minted.onSynth(synthKey);
    if (mintedOnSynth !== null) {
      return { kind: 'decided', outcome: { kind: 'adopted', idx: mintedOnSynth, via: 'earlier-mint' } };
    }
    const bridged = sources.synthGaiaBridges.get(synthKey);
    const bridgedIdx = bridged === undefined ? undefined : index.existingOnGaia(bridged);
    if (bridgedIdx !== undefined) return { kind: 'held', idx: bridgedIdx, via: 'sameas-bridge' };
  }
  return { kind: 'new', gaia, hip, synthetic, idsInheritedFromAnchor: inheritedGaia || inheritedHip };
}
