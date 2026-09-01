import { describe, it, expect } from 'vitest';

import {
  applyBindingGate,
  bindingEvidence,
  buildClassicIdOverlay,
  glieseNumber,
  parseOverlayTsv,
  serializeOverlay,
  type OverlayInput,
} from './classic-id-overlay-pure';
import { cns5Row } from './cns5-fixture';

const VEGA_SRC = '2101372160809792';
const SIRIUS_SRC = '2947050466531873024';

/** No printed V and no G, so every row is unvettable and the gate is inert —
 *  the baseline for the join assertions below. Gate behaviour gets its own
 *  block with real photometry. */
const NO_EVIDENCE = bindingEvidence(new Map(), new Map(), null);

function input(overrides: Partial<OverlayInput> = {}): OverlayInput {
  return {
    tyc2Hd: [
      { tyc: '3105-2070-1', hd: 172167, nHd: 1, nTyc: 1 },
      { tyc: '5949-2777-1', hd: 48915, nHd: 1, nTyc: 1 },
    ],
    crossIndex: [
      { hd: 172167, hip: 91262, bayer: 'alf', flamsteed: 3, cst: 'Lyr' },
      { hd: 48915, hip: 32349, bayer: 'alf', flamsteed: 9, cst: 'CMa' },
    ],
    bsc5: [
      { hr: 7001, hd: 172167, name: '3Alp Lyr' },
      { hr: 2491, hd: 48915, name: '9Alp CMa' },
    ],
    cns5: [],
    tycToSource: new Map([
      ['3105-2070-1', VEGA_SRC],
      ['5949-2777-1', SIRIUS_SRC],
    ]),
    hipToSource: new Map([[91262, VEGA_SRC]]),
    evidence: NO_EVIDENCE,
    ...overrides,
  };
}

describe('buildClassicIdOverlay', () => {
  it('keys every identifier on the source_id the HD→TYC route resolves', () => {
    const { overlay } = buildClassicIdOverlay(input());
    expect(overlay.get(VEGA_SRC)).toEqual({
      hd: [172167],
      hr: [7001],
      hip: [91262],
      gj: [],
      bayer: ['alf Lyr'],
      flamsteed: ['3 Lyr'],
    });
  });

  it('leaves a source with no resolvable TYC out of the overlay entirely', () => {
    // Gaia saturates near G=3, so the brightest stars are absent from both
    // cross-walks — no overlay row, labels come from the inherited spine.
    const { overlay, counts } = buildClassicIdOverlay(
      input({ tycToSource: new Map([['3105-2070-1', VEGA_SRC]]) }),
    );
    expect(overlay.has(SIRIUS_SRC)).toBe(false);
    expect(counts.bsc5HrUnkeyed).toBe(1);
    expect(counts.crossIndexBayerUnkeyed).toBe(1);
    expect(counts.crossIndexFlamsteedUnkeyed).toBe(1);
  });

  it('attaches an ambiguous designation to every matching record', () => {
    const { overlay, counts } = buildClassicIdOverlay(
      input({
        tyc2Hd: [
          { tyc: '3105-2070-1', hd: 172167, nHd: 1, nTyc: 2 },
          { tyc: '5949-2777-1', hd: 172167, nHd: 1, nTyc: 2 },
        ],
      }),
    );
    expect(overlay.get(VEGA_SRC)!.hd).toEqual([172167]);
    expect(overlay.get(SIRIUS_SRC)!.hd).toEqual([172167]);
    expect(counts.hdOnMultipleSources).toBe(1);
    expect(counts.tyc2HdAmbiguousRows).toBe(2);
  });

  it('records a HIP-route disagreement instead of overriding the HD route', () => {
    const other = '9999999999999999';
    const { overlay, counts, disagreements } = buildClassicIdOverlay(
      input({ hipToSource: new Map([[91262, other]]) }),
    );
    expect(counts.hdHipRouteDisagree).toBe(1);
    expect(counts.hdHipRouteAgree).toBe(0);
    expect(disagreements[0]).toEqual({
      hd: 172167, hip: 91262, hdRouteSourceIds: [VEGA_SRC], hipRouteSourceId: other,
    });
    // The HD route still owns the label; the HIP-route source keeps only the
    // HIP the cross-walk gave it.
    expect(overlay.get(VEGA_SRC)!.bayer).toEqual(['alf Lyr']);
    expect(overlay.get(other)).toEqual({
      hd: [], hr: [], hip: [91262], gj: [], bayer: [], flamsteed: [],
    });
  });

  it('routes a CNS5 row with no EDR3 id through its HIP', () => {
    const { overlay, counts } = buildClassicIdOverlay(
      input({
        cns5: [cns5Row({ gj: '721', hip: 91262 })],
      }),
    );
    expect(overlay.get(VEGA_SRC)!.gj).toEqual(['721']);
    expect(counts.cns5GjViaHip).toBe(1);
    expect(counts.cns5GjUnkeyed).toBe(0);
  });

  it('counts a CNS5 row reachable by neither route as unkeyed', () => {
    const { counts } = buildClassicIdOverlay(
      input({
        cns5: [cns5Row({ gj: '9848' })],
      }),
    );
    expect(counts.cns5GjUnkeyed).toBe(1);
  });
});

describe('applyBindingGate', () => {
  // The real α Cen B case: both best-neighbour walks land on the G=20.95
  // background source beside the saturated star, so the overlay would key
  // HD 128621 / HR 5460 / HIP 71681 / "alf Cen" on a 20th-magnitude star.
  const TOLIMAN_BAD_SRC = '5877748442128924544';
  const TOLIMAN_HIP = 71681;

  function tolimanOverlay(evidenceOverride?: Parameters<typeof applyBindingGate>[1]) {
    return buildClassicIdOverlay(input({
      tyc2Hd: [{ tyc: '9007-5849-1', hd: 128621, nHd: 1, nTyc: 1 }],
      crossIndex: [{ hd: 128621, hip: TOLIMAN_HIP, bayer: 'alf', flamsteed: null, cst: 'Cen' }],
      bsc5: [{ hr: 5460, hd: 128621, name: 'Alp2Cen' }],
      tycToSource: new Map([['9007-5849-1', TOLIMAN_BAD_SRC]]),
      hipToSource: new Map([[TOLIMAN_HIP, TOLIMAN_BAD_SRC]]),
      evidence: evidenceOverride ?? bindingEvidence(
        new Map([[TOLIMAN_BAD_SRC, 20.95]]),
        new Map([[TOLIMAN_HIP, 1.33]]),
        null,
      ),
    }));
  }

  it('drops the whole row, not just its hip, when G−V rejects the binding', () => {
    const { overlay, counts, rejectedBindings } = tolimanOverlay();
    expect(overlay.has(TOLIMAN_BAD_SRC)).toBe(false);
    expect(counts.overlayRows).toBe(0);
    expect(counts.gateRejectedMag).toBe(1);
    expect(counts.gateRejectedSibling).toBe(0);
    expect(rejectedBindings).toEqual([{
      sourceId: TOLIMAN_BAD_SRC,
      hip: TOLIMAN_HIP,
      vMag: 1.33,
      gMag: 20.95,
      reason: 'mag',
      designations: 'HD 128621 · HR 5460 · alf Cen',
    }]);
  });

  it('keeps the row when the bound source matches the star it names', () => {
    const { overlay, counts } = tolimanOverlay(bindingEvidence(
      new Map([[TOLIMAN_BAD_SRC, 1.7]]),
      new Map([[TOLIMAN_HIP, 1.33]]),
      null,
    ));
    expect(overlay.has(TOLIMAN_BAD_SRC)).toBe(true);
    expect(counts.gateRejectedMag).toBe(0);
  });

  it('prunes hdOnMultipleSources so the count describes the gated artifact', () => {
    // One HD reaching two sources, one of which the gate rejects: what ships
    // is an unambiguous HD, so the ambiguity count must not still claim two.
    const good = '111111111111111111';
    const bad = '222222222222222222';
    const { counts } = buildClassicIdOverlay(input({
      tyc2Hd: [
        { tyc: 'a-1-1', hd: 99, nHd: 1, nTyc: 2 },
        { tyc: 'b-1-1', hd: 99, nHd: 1, nTyc: 2 },
      ],
      crossIndex: [],
      bsc5: [],
      tycToSource: new Map([['a-1-1', good], ['b-1-1', bad]]),
      hipToSource: new Map([[7, good], [8, bad]]),
      evidence: bindingEvidence(
        new Map([[good, 5.1], [bad, 19.0]]),
        new Map([[7, 5.0], [8, 5.0]]),
        null,
      ),
    }));
    expect(counts.gateRejectedMag).toBe(1);
    expect(counts.hdOnMultipleSources).toBe(0);
    expect(counts.overlayHd).toBe(1);
  });

  it('counts a row with no printed V as unvettable rather than passing it', () => {
    const { counts } = tolimanOverlay(bindingEvidence(
      new Map([[TOLIMAN_BAD_SRC, 20.95]]),
      new Map(),
      null,
    ));
    expect(counts.gateRejectedMag).toBe(0);
    expect(counts.gateSkippedNoHipVMag).toBe(1);
    expect(counts.gateSkippedNoGMag).toBe(0);
  });

  // The fault the union request exists to prevent: no G means the magnitude
  // check has nothing to compare and PASSES, so the binding ships unvetted.
  // gateSkippedNoGMag is the only signal that happened — pinned at 0 on the
  // real build, where it says the pull still covers every candidate.
  it('counts a candidate absent from the pull as silently accepted, not rejected', () => {
    const { overlay, counts } = tolimanOverlay(bindingEvidence(
      new Map(),
      new Map([[TOLIMAN_HIP, 1.33]]),
      null,
    ));
    expect(overlay.has(TOLIMAN_BAD_SRC)).toBe(true);
    expect(counts.gateRejectedMag).toBe(0);
    expect(counts.gateSkippedNoHipVMag).toBe(0);
    expect(counts.gateSkippedNoGMag).toBe(1);
    expect(counts.gateSkippedNullGMag).toBe(0);
  });

  // Same pass-by-default, different cause and different remedy: the pull has
  // the row, Gaia just publishes no G. Splitting them is what keeps the
  // request-coverage count pinnable at zero.
  it('separates a pulled row with a null G from one the pull never returned', () => {
    const { counts } = tolimanOverlay(bindingEvidence(
      new Map(),
      new Map([[TOLIMAN_HIP, 1.33]]),
      null,
      new Set([TOLIMAN_BAD_SRC]),
    ));
    expect(counts.gateSkippedNoGMag).toBe(0);
    expect(counts.gateSkippedNullGMag).toBe(1);
  });

  it('rejects a similar-brightness sibling the G−V gate cannot see', () => {
    // HIP 41098's cell holds HD 70492 B's source: same brightness, so only
    // SIMBAD's per-component attribution refutes it.
    const src = '663434291018997248';
    const hip = 41098;
    const overlay = new Map([[src, {
      hd: [70492], hr: [], hip: [hip], gj: [], bayer: [], flamsteed: [],
    }]]);
    const { rejected } = applyBindingGate(overlay, bindingEvidence(
      new Map([[src, 5.9]]),
      new Map([[hip, 5.7]]),
      {
        bySource: new Map([[src, [{ wdsId: '08236-2439', component: 'B' }]]]),
        byHip: new Map([[hip, [{ wdsId: '08236-2439', component: 'A' }]]]),
        primarySourceLetterByWds: new Map([['08236-2439', 'B']]),
      },
    ));
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe('sibling');
    expect(overlay.has(src)).toBe(false);
  });
});

describe('serializeOverlay', () => {
  it('sorts rows by numeric source_id and pipe-joins multi-values', () => {
    const { overlay } = buildClassicIdOverlay(
      input({
        tyc2Hd: [
          { tyc: '3105-2070-1', hd: 172167, nHd: 2, nTyc: 1 },
          { tyc: '3105-2070-1', hd: 172168, nHd: 2, nTyc: 1 },
          { tyc: '5949-2777-1', hd: 48915, nHd: 1, nTyc: 1 },
        ],
      }),
    );
    const lines = serializeOverlay(overlay).trimEnd().split('\n');
    expect(lines[0]).toBe('gaia_source_id\thd\thr\thip\tgj\tbayer\tflamsteed');
    // VEGA_SRC is 16 digits, SIRIUS_SRC 19 — a lexicographic sort would
    // misorder them.
    expect(lines[1].startsWith(`${VEGA_SRC}\t172167|172168\t`)).toBe(true);
    expect(lines[2].startsWith(`${SIRIUS_SRC}\t`)).toBe(true);
  });
});

describe('glieseNumber', () => {
  it('reduces both prefixes and the component suffix to the bare number', () => {
    expect(glieseNumber('Gl 914B')).toBe('914');
    expect(glieseNumber('GJ 914')).toBe('914');
    expect(glieseNumber('Gl 4.1A')).toBe('4.1');
    // CNS5 prints whole numbers with a trailing .0; the supplement's genuinely
    // fractional entries keep theirs.
    expect(glieseNumber('914.0')).toBe('914');
    expect(glieseNumber('17.1')).toBe('17.1');
    expect(glieseNumber('NN 3001')).toBeNull();
  });
});

describe('parseOverlayTsv', () => {
  it('round-trips the serialized artifact, multi-values included', () => {
    const { overlay } = buildClassicIdOverlay(
      input({
        tyc2Hd: [
          { tyc: '3105-2070-1', hd: 172167, nHd: 2, nTyc: 1 },
          { tyc: '3105-2070-1', hd: 172168, nHd: 2, nTyc: 1 },
          { tyc: '5949-2777-1', hd: 48915, nHd: 1, nTyc: 1 },
        ],
        cns5: [cns5Row({ gj: '721', gjComp: 'A', gaiaSourceId: VEGA_SRC })],
      }),
    );
    expect(parseOverlayTsv(serializeOverlay(overlay))).toEqual(overlay);
  });

  it('rejects a header that is not the column list byte for byte', () => {
    expect(() => parseOverlayTsv('gaia_source_id\thd\n1\t2\n'))
      .toThrow(/header/);
  });
});
