// A WDS pair row's magnitudes: its own, else the MSC's pair-side V, and their difference.

import type { WdsPair } from '../../wds/wds-pure';
import { mscPairKey, type MscLookup } from '../load/msc-pure';

/** `magSec − magPri`; both components sit at one distance, so it is the absolute Δmag too. */
export function wdsDmag(magPri: number | null, magSec: number | null): number | null {
  return magPri === null || magSec === null ? null : magSec - magPri;
}

export interface PairMagnitudes {
  readonly magPri: number | null;
  readonly magSec: number | null;
  readonly source: 'wds' | 'msc';
}

/** `sTok` is the secondary with its WDS truncation re-anchored. */
export function pairMagnitudes(pair: WdsPair, pTok: string, sTok: string, msc: MscLookup): PairMagnitudes {
  if (pair.magPri === null && pair.magSec === null) {
    const filled = msc.pairMags.get(mscPairKey(pair.wdsId, pTok, sTok));
    if (filled !== undefined) return { magPri: filled.vmagPri, magSec: filled.vmagSec, source: 'msc' };
  }
  return { magPri: pair.magPri, magSec: pair.magSec, source: 'wds' };
}
