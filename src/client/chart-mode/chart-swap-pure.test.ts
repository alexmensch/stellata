import { describe, expect, it } from 'vitest';
import { applyChartPaletteSwap } from './chart-swap-pure';

function record(on: boolean): string[] {
  const calls: string[] = [];
  applyChartPaletteSwap(
    on,
    (v) => calls.push(`hdr:${v}`),
    (v) => calls.push(`layers:${v}`),
  );
  return calls;
}

describe('applyChartPaletteSwap', () => {
  it('drops the MRT struct before the chart blend flag goes on', () => {
    expect(record(true)).toEqual(['hdr:true', 'layers:true']);
  });

  // The shipped bug: this ran in the entry order, so leaving chart re-enabled
  // the output struct while the glare material still carried
  // premultipliedAlpha from entry. mrt-material.ts threw, the throw escaped
  // Stellata.setMonochrome, and the caller's remaining steps — the declutter
  // re-derive and the chart-label teardown — never ran.
  it('clears the chart blend flag before the MRT struct comes back', () => {
    expect(record(false)).toEqual(['layers:false', 'hdr:false']);
  });

  it('is not the same order in both directions', () => {
    const enter = record(true).map((c) => c.split(':')[0]);
    const leave = record(false).map((c) => c.split(':')[0]);
    expect(leave).toEqual([...enter].reverse());
  });
});
