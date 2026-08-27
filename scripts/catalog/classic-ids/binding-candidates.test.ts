import { describe, expect, it } from 'vitest';

import { bindingCandidateSourceIds } from './binding-candidates';
import {
  bindingEvidence,
  buildClassicIdOverlay,
  type OverlayInput,
} from './classic-id-overlay-pure';
import { cns5Row } from './cns5-fixture';

const HIP_SRC = '111111111111111111';
const TYC_ONLY_SRC = '222222222222222222';
const CNS5_SRC = '333333333333333333';
const NO_VMAG_SRC = '444444444444444444';

/** Every route at once, so the candidate set has to discriminate between them:
 *  one source reached by HIP, one only by TYC→HD, one by a CNS5 row's own
 *  source_id, and one by HIP but with no printed V to weigh it against. */
const HIP_VMAG = new Map([[10, 5.0], [30, 6.0], [50, 7.0]]);

function walks() {
  return {
    cns5: [cns5Row({ gj: '9999', hip: 30, gaiaSourceId: CNS5_SRC })],
    hipToSource: new Map([[10, HIP_SRC], [70, NO_VMAG_SRC]]),
  };
}

function overlayInput(): OverlayInput {
  return {
    tyc2Hd: [{ tyc: '1-1-1', hd: 111, nHd: 1, nTyc: 1 }],
    crossIndex: [],
    bsc5: [],
    ...walks(),
    tycToSource: new Map([['1-1-1', TYC_ONLY_SRC]]),
    evidence: bindingEvidence(new Map(), HIP_VMAG, null),
  };
}

describe('bindingCandidateSourceIds', () => {
  it('covers the HIP cross-walk and the source a CNS5 row names itself', () => {
    const ids = bindingCandidateSourceIds(walks(), HIP_VMAG);
    expect([...ids].sort()).toEqual([HIP_SRC, CNS5_SRC].sort());
  });

  it('excludes a source only the TYC→HD route reaches — no hip, so ungateable', () => {
    expect(bindingCandidateSourceIds(walks(), HIP_VMAG).has(TYC_ONLY_SRC)).toBe(false);
  });

  it('excludes a HIP with no printed V — a G for it would decide nothing', () => {
    expect(bindingCandidateSourceIds(walks(), HIP_VMAG).has(NO_VMAG_SRC)).toBe(false);
  });

  // The invariant the astrometry request rests on: the pull has to carry a G for
  // every source applyBindingGate will weigh, because a missing G is a silent
  // PASS. Deriving the expectation from a built overlay rather than restating
  // the candidate rule is the point — the two producers of entry.hip are free
  // to change, and this fails when they do.
  it('covers every source the gate actually weighs on a built overlay', () => {
    const { overlay } = buildClassicIdOverlay(overlayInput());
    const candidates = bindingCandidateSourceIds(walks(), HIP_VMAG);

    const weighed = [...overlay]
      .filter(([, entry]) => entry.hip.some((hip) => HIP_VMAG.has(hip)))
      .map(([sourceId]) => sourceId);

    expect(weighed.length).toBeGreaterThan(0);
    for (const sourceId of weighed) expect(candidates.has(sourceId)).toBe(true);
  });

  it('leaves the ungateable overlay rows out, so the request stays small', () => {
    const { overlay } = buildClassicIdOverlay(overlayInput());
    const candidates = bindingCandidateSourceIds(walks(), HIP_VMAG);
    const ungateable = [...overlay]
      .filter(([, entry]) => !entry.hip.some((hip) => HIP_VMAG.has(hip)))
      .map(([sourceId]) => sourceId);

    expect(ungateable).toContain(TYC_ONLY_SRC);
    for (const sourceId of ungateable) expect(candidates.has(sourceId)).toBe(false);
  });
});
