import { describe, expect, it } from 'vitest';
import {
  STUCK_TAIL_MS,
  bindingSourceLabel,
  classifyHealth,
  classifyRenderWatch,
  hudContainerCss,
  medianOf,
  type RenderWatchSample,
} from './render-watch-pure';
import { SETTLE_MS } from '../../render-gate/render-gate-pure';
import {
  CADENCE_CAP_SIM_S,
  CADENCE_MIN_IDLE_GAP_REAL_S,
} from '../../render-gate/clock-cadence-pure';

const base: RenderWatchSample = {
  holds: 0,
  clockRate: 1,
  budgetSimS: 30,
  msSinceWake: 1e9,
  tailHeldMs: 0,
  gapsMs: [30_000, 30_010, 29_990],
  rideMoved: false,
};
const at = (patch: Partial<RenderWatchSample>) => classifyRenderWatch({ ...base, ...patch });

describe('hudContainerCss', () => {
  it('is selectable, and absorbs pointer events rather than passing them through', () => {
    const css = hudContainerCss();
    // `none` would let every pointer move in this corner reach the canvas,
    // whose wake listeners would then invalidate the gate being watched.
    expect(css).toContain('pointer-events:auto');
    expect(css).toContain('user-select:text');
    // Safari does not reliably inherit it — styles.css says so explicitly.
    expect(css).toContain('-webkit-user-select:text');
    expect(css).not.toContain('pointer-events:none');
  });
});

describe('bindingSourceLabel', () => {
  it('names whichever source Math.min would have picked', () => {
    expect(bindingSourceLabel(Number.POSITIVE_INFINITY, 32.4)).toBe('the 30s cap');
    expect(bindingSourceLabel(0.04, 32.4)).toBe('a scene layer');
    expect(bindingSourceLabel(Number.POSITIVE_INFINITY, 12)).toBe('the pulsation bound');
    // Ties resolve the way Math.min does, so the label cannot contradict
    // the number printed beside it.
    expect(bindingSourceLabel(12, 12)).toBe('a scene layer');
    expect(bindingSourceLabel(Number.POSITIVE_INFINITY, CADENCE_CAP_SIM_S))
      .toBe('the pulsation bound');
  });
});

describe('medianOf', () => {
  it('sorts before picking, and answers NaN for nothing', () => {
    expect(medianOf([30, 10, 20])).toBe(20);
    expect(medianOf([])).toBeNaN();
  });
});

describe('classifyRenderWatch', () => {
  it('the default Sol view at live rate reads as idling', () => {
    const v = at({});
    expect(v.tone).toBe('idling');
    expect(v.expectedGapMs).toBe(30_000);
  });

  it('a hold outranks every other cause', () => {
    // Mirrors decideRender's priority: holds win, so the readout must not
    // blame the cadence for frames a panel is forcing.
    expect(at({ holds: 1, clockRate: 0, budgetSimS: 0.1 }).tone).toBe('held');
  });

  it('a paused clock is not the cadence idling', () => {
    expect(at({ clockRate: 0 }).tone).toBe('as-designed');
    expect(at({ clockRate: 0 }).expectedGapMs).toBeNaN();
  });

  it('past live rate, and under the idle floor, are both as designed', () => {
    expect(at({ clockRate: 64, gapsMs: [16, 17] }).tone).toBe('as-designed');
    expect(at({ clockRate: -64, gapsMs: [16, 17] }).tone).toBe('as-designed');
    // 50 000 km from Earth at live rate — the vantage that prompted this.
    const near = at({ budgetSimS: 0.1, gapsMs: [16, 17] });
    expect(near.tone).toBe('as-designed');
    expect(near.reason).toContain('idle floor');
  });

  it('the floor boundary belongs to the idling side, matching clockFrameDue', () => {
    expect(at({ budgetSimS: CADENCE_MIN_IDLE_GAP_REAL_S, gapsMs: [2000, 2010] }).tone)
      .toBe('idling');
    expect(at({ budgetSimS: CADENCE_MIN_IDLE_GAP_REAL_S - 0.01, gapsMs: [16, 17] }).tone)
      .toBe('as-designed');
  });

  it('a fresh tail is transient; one that never expires is a bug', () => {
    expect(at({ msSinceWake: 200, tailHeldMs: 200 }).tone).toBe('transient');
    // The focal-ride loop presented exactly this way for minutes.
    const stuck = at({ msSinceWake: 200, tailHeldMs: STUCK_TAIL_MS });
    expect(stuck.tone).toBe('wrong');
    expect(stuck.reason).toContain('NEVER EXPIRES');
  });

  it('STUCK_TAIL_MS is three settle tails', () => {
    expect(STUCK_TAIL_MS).toBe(SETTLE_MS * 3);
  });

  it('too few gaps is unknown, not a verdict', () => {
    expect(at({ gapsMs: [] }).tone).toBe('unknown');
    expect(at({ gapsMs: [30_000] }).tone).toBe('unknown');
  });

  it('gaps far short of the budget are wrong', () => {
    const v = at({ gapsMs: [16, 17, 16] });
    expect(v.tone).toBe('wrong');
    expect(v.reason).toContain('NOT IDLING');
  });

  it('the ride note rides along wherever it is relevant', () => {
    expect(at({ rideMoved: true }).reason).toContain('focal ride');
    // Not on a paused clock — no ride steps with a stopped clock.
    expect(at({ rideMoved: true, clockRate: 0 }).reason).not.toContain('focal ride');
  });
});

describe('classifyHealth', () => {
  it('separates expensive frames from a deferred loop by the skip ratio', () => {
    expect(classifyHealth({ tickHz: 15, skipRatio: 0, hitches: 0, worstGapMs: 0 }))
      .toBe('cost: ~67ms frames, not the gate');
    expect(classifyHealth({ tickHz: 15, skipRatio: 0.99, hitches: 0, worstGapMs: 0 }))
      .toContain('deferring');
  });

  it('a healthy loop says nothing, and hitches always report', () => {
    expect(classifyHealth({ tickHz: 60, skipRatio: 0.999, hitches: 0, worstGapMs: 0 })).toBe('');
    expect(classifyHealth({ tickHz: 60, skipRatio: 0.999, hitches: 4, worstGapMs: 240 }))
      .toBe('4 hitches >100ms, worst 240ms');
  });
});
