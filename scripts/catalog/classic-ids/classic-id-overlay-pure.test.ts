import { describe, it, expect } from 'vitest';

import {
  athygIdOrNull,
  buildClassicIdOverlay,
  glieseNumber,
  measureAthygLabelParity,
  serializeOverlay,
  type AthygLabelRow,
  type OverlayInput,
} from './classic-id-overlay-pure';

const VEGA_SRC = '2101372160809792';
const SIRIUS_SRC = '2947050466531873024';

function input(overrides: Partial<OverlayInput> = {}): OverlayInput {
  return {
    tyc2Hd: [
      { tyc: '3105-2070-1', hd: 172167, nHd: 1, nTyc: 1 },
      { tyc: '5949-2777-1', hd: 48915, nHd: 1, nTyc: 1 },
    ],
    crossIndex: [
      { hd: 172167, hr: 7001, hip: 91262, bayer: 'alf', flamsteed: 3, cst: 'Lyr' },
      { hd: 48915, hr: 2491, hip: 32349, bayer: 'alf', flamsteed: 9, cst: 'CMa' },
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
        cns5: [{ cns5: 1, gj: '721', gjComp: null, gaiaSourceId: null, hip: 91262 }],
      }),
    );
    expect(overlay.get(VEGA_SRC)!.gj).toEqual(['721']);
    expect(counts.cns5GjViaHip).toBe(1);
    expect(counts.cns5GjUnkeyed).toBe(0);
  });

  it('counts a CNS5 row reachable by neither route as unkeyed', () => {
    const { counts } = buildClassicIdOverlay(
      input({
        cns5: [{ cns5: 1, gj: '9848', gjComp: null, gaiaSourceId: null, hip: null }],
      }),
    );
    expect(counts.cns5GjUnkeyed).toBe(1);
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

describe('athygIdOrNull', () => {
  it('treats AT-HYG\'s empty and "0" sentinels as missing', () => {
    expect(athygIdOrNull('')).toBeNull();
    expect(athygIdOrNull('0')).toBeNull();
    expect(athygIdOrNull(undefined)).toBeNull();
    expect(athygIdOrNull('91262')).toBe(91262);
  });
});

describe('glieseNumber', () => {
  it('reduces both prefixes and the component suffix to the bare number', () => {
    expect(glieseNumber('Gl 914B')).toBe('914');
    expect(glieseNumber('GJ 914')).toBe('914');
    expect(glieseNumber('Gl 4.1A')).toBe('4.1');
    expect(glieseNumber('NN 3001')).toBeNull();
  });
});

describe('measureAthygLabelParity', () => {
  const row = (over: Partial<AthygLabelRow>): AthygLabelRow => ({
    sourceId: VEGA_SRC, mag: 5, hd: null, hip: null, hr: null,
    gl: null, bayer: null, flam: null, ...over,
  });

  it('scores a reproduced identifier as covered and a missing one as keyed only', () => {
    const { overlay } = buildClassicIdOverlay(input());
    const result = measureAthygLabelParity(
      [row({ hd: 172167, hr: 7001 }), row({ hd: 999999 })],
      overlay,
    );
    expect(result.parity.hdKeyed).toBe(2);
    expect(result.parity.hdCovered).toBe(1);
    expect(result.parity.hrKeyed).toBe(1);
    expect(result.parity.hrCovered).toBe(1);
  });

  it('scores bayer on presence, since IV/27A spells it "alf" and AT-HYG "Alp"', () => {
    const { overlay } = buildClassicIdOverlay(input());
    const result = measureAthygLabelParity([row({ bayer: 'Alp' })], overlay);
    expect(result.parity.bayerCovered).toBe(1);
  });

  it('scores gl on its GJ number, ignoring prefix and component letter', () => {
    const { overlay } = buildClassicIdOverlay(
      input({
        cns5: [{ cns5: 1, gj: '721', gjComp: 'A', gaiaSourceId: VEGA_SRC, hip: null }],
      }),
    );
    const result = measureAthygLabelParity([row({ gl: 'Gl 721B' })], overlay);
    expect(result.parity.glCovered).toBe(1);
  });

  it('counts rows the overlay cannot key, and the bright tier among them', () => {
    const { overlay } = buildClassicIdOverlay(input());
    const result = measureAthygLabelParity(
      [
        row({ sourceId: null, mag: 0.03, hd: 172167 }),
        row({ sourceId: 'not-in-overlay', mag: -1.44, hd: 48915 }),
        row({ mag: 5, hd: 172167 }),
      ],
      overlay,
    );
    expect(result.rows).toBe(3);
    expect(result.rowsWithoutSourceId).toBe(1);
    expect(result.rowsWithoutOverlayEntry).toBe(2);
    expect(result.brightRows).toBe(2);
    expect(result.brightRowsWithoutOverlayEntry).toBe(2);
  });
});
