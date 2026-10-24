import { describe, expect, it } from 'vitest';
import { rebasedAnchorOffset, type AnchorOffsetRow } from './anchor-offset-pure';

function row(
  comp: string,
  sep: number | null,
  pa: number | null,
  anchorComp: string | null = 'A',
): AnchorOffsetRow {
  return { comp, anchorComp, anchorSepArcsec: sep, anchorPaDeg: pa };
}

function eastNorth(o: { sepArcsec: number; paDeg: number } | null): [number, number] {
  if (o === null) throw new Error('expected an offset');
  const pa = (o.paDeg * Math.PI) / 180;
  return [o.sepArcsec * Math.sin(pa), o.sepArcsec * Math.cos(pa)];
}

describe('rebasedAnchorOffset', () => {
  it('keeps the Stage 6 offset when promotion anchors on the same letter', () => {
    const out = rebasedAnchorOffset(row('H', 42.1, 269), row('A', null, null));
    expect(out?.sepArcsec).toBeCloseTo(42.1, 9);
    expect(out?.paDeg).toBeCloseTo(269, 9);
  });

  it('re-bases onto a resolvable anchor Stage 6 did not chain from', () => {
    // 00101+3825 shape: A carries no identifier, so promotion anchors on D.
    const [e, n] = eastNorth(
      rebasedAnchorOffset(row('H', 42.1, 269), row('D', 55.5, 259)),
    );
    const rad = Math.PI / 180;
    expect(e).toBeCloseTo(42.1 * Math.sin(269 * rad) - 55.5 * Math.sin(259 * rad), 9);
    expect(n).toBeCloseTo(42.1 * Math.cos(269 * rad) - 55.5 * Math.cos(259 * rad), 9);
  });

  it('never places Stage 6\'s chaining letter itself', () => {
    expect(rebasedAnchorOffset(row('A', null, null), row('D', 55.5, 259))).toBeNull();
  });

  it('refuses when promotion\'s anchor is unreached from the chaining letter', () => {
    expect(rebasedAnchorOffset(row('B', 12.6, 245), row('Ca', null, null))).toBeNull();
  });

  it('keeps the row\'s own offset when the anchor was reached at exactly zero', () => {
    const out = rebasedAnchorOffset(row('E', 100, 90), row('Aa', 0, 0));
    expect(out?.sepArcsec).toBeCloseTo(100, 9);
    expect(out?.paDeg).toBeCloseTo(90, 9);
  });

  it('refuses when the row is unreached', () => {
    expect(rebasedAnchorOffset(row('E', null, null), row('A', null, null))).toBeNull();
  });

  it('refuses a row that re-bases onto the anchor itself', () => {
    expect(rebasedAnchorOffset(row('B', 5, 90), row('C', 5, 90))).toBeNull();
  });

  it('refuses every row of a root Stage 6 anchored nowhere', () => {
    expect(rebasedAnchorOffset(row('B', null, null, null), row('A', null, null, null)))
      .toBeNull();
  });

  it('throws when the two rows name different Stage 6 anchors', () => {
    expect(() => rebasedAnchorOffset(row('B', 5, 90, 'A'), row('A', null, null, 'Aa')))
      .toThrow(/disagree/);
  });
});
