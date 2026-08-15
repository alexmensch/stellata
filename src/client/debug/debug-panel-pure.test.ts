import { describe, it, expect } from 'vitest';
import {
  type ContainsNode,
  PANEL_WIDTH,
  clampToViewport,
  hexToRgb,
  parsePosition,
  rgbToHex,
  selectionTouches,
} from './debug-panel-pure';

describe('debug-panel-pure / clampToViewport', () => {
  it('clamps below-margin on all four edges', () => {
    expect(clampToViewport(-50, -50, 1024, 768)).toEqual({ x: 8, y: 8 });
    expect(clampToViewport(99999, 99999, 1024, 768)).toEqual({
      x: 1024 - PANEL_WIDTH - 8,
      y: 768 - 80,
    });
  });

  it('passes through positions already in bounds', () => {
    expect(clampToViewport(100, 200, 1024, 768)).toEqual({ x: 100, y: 200 });
  });

  it('falls back to margin when viewport is smaller than the panel', () => {
    // A 200×100 viewport can't fit the 300px-wide panel: x clamp lower
    // bound (margin=8) wins over the negative upper bound.
    expect(clampToViewport(0, 0, 200, 100)).toEqual({ x: 8, y: 8 });
    expect(clampToViewport(500, 500, 200, 100)).toEqual({ x: 8, y: 20 });
  });
});

describe('debug-panel-pure / rgbToHex + hexToRgb', () => {
  it('round-trips standard colours', () => {
    const cases = [
      { r: 0, g: 0, b: 0, hex: '#000000' },
      { r: 1, g: 1, b: 1, hex: '#ffffff' },
      { r: 1, g: 0, b: 0, hex: '#ff0000' },
      { r: 0, g: 1, b: 0, hex: '#00ff00' },
      { r: 0, g: 0, b: 1, hex: '#0000ff' },
    ];
    for (const c of cases) {
      expect(rgbToHex(c.r, c.g, c.b)).toBe(c.hex);
      const rt = hexToRgb(c.hex);
      expect(rt.r).toBeCloseTo(c.r, 2);
      expect(rt.g).toBeCloseTo(c.g, 2);
      expect(rt.b).toBeCloseTo(c.b, 2);
    }
  });

  it('clamps out-of-range channels at encode time', () => {
    expect(rgbToHex(-0.5, 0.5, 1.5)).toBe('#0080ff');
  });

  it('pads single-digit channels', () => {
    // 0.05 * 255 ≈ 13 = 0x0d
    expect(rgbToHex(0.05, 0, 0)).toBe('#0d0000');
  });
});

describe('debug-panel-pure / selectionTouches', () => {
  // A tree standing in for two readouts under one panel body. `contains`
  // is inclusive of the node itself, as Node.contains is.
  interface IdNode extends ContainsNode { id: string }

  function node(...descendants: string[]): IdNode {
    return {
      id: descendants[0] ?? '',
      contains: (other: ContainsNode | null) =>
        other !== null && descendants.includes((other as IdNode).id),
    };
  }

  const exposure = node('exposure', 'exposure-text');
  const perf = node('perf', 'perf-text');
  const panel = node('panel', 'exposure', 'exposure-text', 'perf', 'perf-text');

  it('holds for a selection dragged inside the readout', () => {
    expect(selectionTouches(exposure, [{ commonAncestorContainer: node('exposure-text') }]))
      .toBe(true);
  });

  it('holds for a selection spanning the whole panel', () => {
    // Drag across two sections and the common ancestor sits ABOVE the
    // readout, so the inside-out test alone would miss it and the readout
    // would keep rewriting mid-drag.
    expect(selectionTouches(exposure, [{ commonAncestorContainer: panel }])).toBe(true);
    expect(selectionTouches(perf, [{ commonAncestorContainer: panel }])).toBe(true);
  });

  it('releases a readout the selection does not reach', () => {
    expect(selectionTouches(exposure, [{ commonAncestorContainer: node('perf-text') }]))
      .toBe(false);
  });

  it('releases when there is no range at all', () => {
    expect(selectionTouches(exposure, [])).toBe(false);
  });

  it('holds when any one of several ranges touches', () => {
    expect(selectionTouches(exposure, [
      { commonAncestorContainer: node('perf-text') },
      { commonAncestorContainer: node('exposure-text') },
    ])).toBe(true);
  });
});

describe('debug-panel-pure / parsePosition', () => {
  it('returns null for null input', () => {
    expect(parsePosition(null)).toBeNull();
  });

  it('parses well-formed positions', () => {
    expect(parsePosition('{"x":42,"y":99}')).toEqual({ x: 42, y: 99 });
  });

  it('rejects NaN-shaped JSON (would clamp to corner)', () => {
    // typeof NaN === 'number' but Number.isFinite(NaN) === false. The
    // old `typeof === 'number'` check let a saved NaN through; once
    // clamped, the panel would re-render at (8, 8) forever.
    expect(parsePosition('{"x":null,"y":99}')).toBeNull();
    // JSON.parse turns the literal NaN token into a syntax error, but
    // a stored `Infinity` string round-trips as `null`, so the explicit
    // isFinite check is the load-bearing guard here.
    expect(parsePosition('{"x":"foo","y":3}')).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(parsePosition('not json')).toBeNull();
    expect(parsePosition('{')).toBeNull();
  });

  it('rejects partial shape', () => {
    expect(parsePosition('{"x":1}')).toBeNull();
    expect(parsePosition('{}')).toBeNull();
  });
});
