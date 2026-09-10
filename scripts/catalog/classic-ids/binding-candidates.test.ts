import { describe, expect, it } from 'vitest';

import { bindingCandidateSourceIds, type BindingCandidateEvidence } from './binding-candidates';
import {
  bindingEvidence,
  buildClassicIdOverlay,
  type OverlayInput,
} from './classic-id-overlay-pure';
import { cns5Row } from './cns5-fixture';
import { printedVOf } from '../photometry/photometry-fixture';

const HIP_SRC = '111111111111111111';
const TYC_ONLY_SRC = '222222222222222222';
const CNS5_SRC = '333333333333333333';
const GLIESE_SRC = '444444444444444444';
const UNGATEABLE_SRC = '555555555555555555';

const IV25_TYC = '1-1-1';
const UNGATEABLE_TYC = '2-2-2';

/** Every tier at once, so the candidate set has to discriminate between them:
 *  one source reached by HIP, one only by TYC→HD but carrying a Tycho-2 V, one
 *  by a CNS5 row's own source_id, one reachable by its GJ cell alone, and one
 *  no printed tier answers for. */
const HIP_VMAG = new Map([[10, 5.0], [30, 6.0]]);
const PRINTED_V = printedVOf({ [IV25_TYC]: 7.0 }, { 9999: 8.0 });

const TYC2_HD = [
  { tyc: IV25_TYC, hd: 111, nHd: 1, nTyc: 1 },
  { tyc: UNGATEABLE_TYC, hd: 222, nHd: 1, nTyc: 1 },
];

const TYC_TO_SOURCE = new Map([
  [IV25_TYC, TYC_ONLY_SRC],
  [UNGATEABLE_TYC, UNGATEABLE_SRC],
]);

function walks() {
  return {
    cns5: [
      cns5Row({ gj: '9998', hip: 30, gaiaSourceId: CNS5_SRC }),
      cns5Row({ gj: '9999', hip: null, gaiaSourceId: GLIESE_SRC }),
    ],
    hipToSource: new Map([[10, HIP_SRC]]),
  };
}

function evidence(): BindingCandidateEvidence {
  return {
    inputs: walks(),
    hipVMag: HIP_VMAG,
    printedV: PRINTED_V,
    tycToSource: TYC_TO_SOURCE,
    tyc2Hd: TYC2_HD,
  };
}

/** Records every source_id whose `G` the gate asked for. `applyBindingGate`
 *  reads a G exactly once per row it can weigh and never for one it skips, so
 *  this is the gate's own reach observed rather than restated — the point of
 *  the correspondence assertion below. */
class RecordingGMags extends Map<string, number> {
  readonly asked = new Set<string>();

  get(sourceId: string): number | undefined {
    this.asked.add(sourceId);
    return super.get(sourceId);
  }
}

function overlayInput(gMags: Map<string, number>): OverlayInput {
  return {
    tyc2Hd: TYC2_HD,
    crossIndex: [],
    bsc5: [],
    ...walks(),
    tycToSource: TYC_TO_SOURCE,
    evidence: bindingEvidence(gMags, HIP_VMAG, null, PRINTED_V),
  };
}

describe('bindingCandidateSourceIds', () => {
  it('covers every printed tier the gate can weigh a source through', () => {
    expect([...bindingCandidateSourceIds(evidence())].sort())
      .toEqual([HIP_SRC, TYC_ONLY_SRC, CNS5_SRC, GLIESE_SRC].sort());
  });

  it('includes a source only the TYC→HD route reaches, on its Tycho-2 V', () => {
    // The HIP-only gate skipped these unweighed: the route attaches no `hip`.
    // They are the population the lower tiers made gateable, and the request
    // has to carry a G for each or the gate is back to passing by default.
    expect(bindingCandidateSourceIds(evidence()).has(TYC_ONLY_SRC)).toBe(true);
  });

  it('includes a CNS5 source with no HIP, on its GJ cell', () => {
    expect(bindingCandidateSourceIds(evidence()).has(GLIESE_SRC)).toBe(true);
  });

  it('excludes a source no printed tier answers for — a G for it decides nothing', () => {
    expect(bindingCandidateSourceIds(evidence()).has(UNGATEABLE_SRC)).toBe(false);
  });

  // The invariant the astrometry request rests on: the pull has to carry a G
  // for every source applyBindingGate will weigh, because a missing G is a
  // silent PASS. Derived from what the gate ASKED for rather than from a second
  // statement of the candidate rule — the two producers of a row's printed V
  // are free to change, and this fails when they do.
  it('covers every source the gate actually weighs on a built overlay', () => {
    const gMags = new RecordingGMags([
      [HIP_SRC, 5.0], [TYC_ONLY_SRC, 7.0], [CNS5_SRC, 6.0], [GLIESE_SRC, 8.0],
      [UNGATEABLE_SRC, 19.0],
    ]);
    const { counts } = buildClassicIdOverlay(overlayInput(gMags));
    const candidates = bindingCandidateSourceIds(evidence());

    expect(counts.gateableVia).toEqual({ hip: 2, tycho2: 1, gliese: 1 });
    expect(gMags.asked.size).toBeGreaterThan(0);
    for (const sourceId of gMags.asked) expect(candidates.has(sourceId)).toBe(true);
  });

  it('leaves the source no tier reaches out, and the gate never weighs it', () => {
    const gMags = new RecordingGMags([[UNGATEABLE_SRC, 19.0]]);
    const { counts } = buildClassicIdOverlay(overlayInput(gMags));

    expect(counts.gateSkippedNoPrintedV).toBe(1);
    expect(gMags.asked.has(UNGATEABLE_SRC)).toBe(false);
    expect(bindingCandidateSourceIds(evidence()).has(UNGATEABLE_SRC)).toBe(false);
  });
});
