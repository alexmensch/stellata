import { describe, expect, it } from 'vitest';
import {
  CADENCE_TRUST_BACKOFF,
  CADENCE_TRUST_FLOOR,
  CADENCE_TRUST_INITIAL,
  CADENCE_TRUST_RECOVER,
  CADENCE_TRUST_TOLERANCE,
  auditCadenceFrame,
  type CadenceAudit,
} from './cadence-trust-pure';
import {
  CADENCE_JND_FLUX_FRAC,
  CADENCE_MOTION_THRESHOLD_DEVICE_PX,
  cadenceSimBudgetS,
  CADENCE_REPORT_STILL,
} from './clock-cadence-pure';

const audit = (over: Partial<CadenceAudit> = {}): CadenceAudit => ({
  cadenceScheduled: true,
  observedPx: 0,
  observedFluxFrac: 0,
  pixelRatio: 2,
  ...over,
});

/** The device-pixel step at which the net fires: the visible step, which
 *  is the tolerance times the scheduling threshold. */
const VIOLATION_DEVICE_PX = CADENCE_MOTION_THRESHOLD_DEVICE_PX * CADENCE_TRUST_TOLERANCE;

describe('the trust constants', () => {
  it('the violation line is exactly the visible step', () => {
    expect(CADENCE_TRUST_TOLERANCE).toBe(2);
    expect(VIOLATION_DEVICE_PX).toBe(0.5);
  });

  it('trust starts whole and knows of no violation', () => {
    expect(CADENCE_TRUST_INITIAL).toEqual({ trust: 1, lastViolation: null, cleanFrames: 0 });
  });
});

describe('auditCadenceFrame — what it ignores', () => {
  it('a frame the cadence did not schedule says nothing about the budget', () => {
    // A camera move, a hold, the settle tail, a fast-forward rate: content
    // legitimately crosses the screen on those, and auditing them would
    // report the gate doing its job as a fault.
    const out = auditCadenceFrame(CADENCE_TRUST_INITIAL, audit({
      cadenceScheduled: false, observedPx: 400,
    }));
    expect(out).toBe(CADENCE_TRUST_INITIAL);
  });

  it('motion inside the margin the safety factor bought is not a fault', () => {
    const justUnder = (VIOLATION_DEVICE_PX / 2) * 0.999;
    const out = auditCadenceFrame(CADENCE_TRUST_INITIAL, audit({ observedPx: justUnder }));
    expect(out.lastViolation).toBe(null);
    expect(out.trust).toBe(1);
  });

  it('a NaN observation is not a violation', () => {
    // It would otherwise pin trust at the floor with nothing wrong.
    const out = auditCadenceFrame(CADENCE_TRUST_INITIAL, audit({
      observedPx: Number.NaN, observedFluxFrac: Number.NaN,
    }));
    expect(out.lastViolation).toBe(null);
    expect(out.trust).toBe(1);
  });
});

describe('auditCadenceFrame — what it catches', () => {
  it('a visible step on a scheduled frame halves the budget and is named', () => {
    const out = auditCadenceFrame(CADENCE_TRUST_INITIAL, audit({
      observedPx: 1, // 2 device px at ratio 2 — four times the line.
    }));
    expect(out.trust).toBe(CADENCE_TRUST_BACKOFF);
    expect(out.lastViolation).toEqual({
      channel: 'motion',
      observed: 2,
      allowed: VIOLATION_DEVICE_PX,
      trust: CADENCE_TRUST_BACKOFF,
    });
    expect(out.cleanFrames).toBe(0);
  });

  it('the pixel ratio reaches the audit, so a CSS-px report is not read raw', () => {
    const observedPx = 0.3;
    expect(auditCadenceFrame(CADENCE_TRUST_INITIAL, audit({ observedPx, pixelRatio: 1 })).trust)
      .toBe(1);
    expect(auditCadenceFrame(CADENCE_TRUST_INITIAL, audit({ observedPx, pixelRatio: 2 })).trust)
      .toBe(CADENCE_TRUST_BACKOFF);
  });

  it('the brightness channel has its own line', () => {
    const out = auditCadenceFrame(CADENCE_TRUST_INITIAL, audit({
      observedFluxFrac: CADENCE_JND_FLUX_FRAC * 10,
    }));
    expect(out.lastViolation?.channel).toBe('brightness');
    expect(out.lastViolation?.allowed)
      .toBeCloseTo(CADENCE_JND_FLUX_FRAC * CADENCE_TRUST_TOLERANCE, 12);
  });

  it('a 10x under-report costs a handful of late frames, never a freeze', () => {
    // The acceptance case: a layer declaring a tenth of its true rate. The
    // gate schedules 10x too long, the audit sees the whole step, and the
    // budget walks down until the schedule is honest again.
    const TRUE_RATE_CSS_PX_S = 1;
    const DECLARED = TRUE_RATE_CSS_PX_S / 10;
    let state = CADENCE_TRUST_INITIAL;
    const budgets: number[] = [];
    for (let frame = 0; frame < 6; frame++) {
      const budget = cadenceSimBudgetS(
        { ...CADENCE_REPORT_STILL, screenPxPerSimS: DECLARED },
        Number.POSITIVE_INFINITY, 2, state.trust,
      );
      budgets.push(budget);
      // What actually happens over that budget, at the true rate.
      state = auditCadenceFrame(state, audit({ observedPx: TRUE_RATE_CSS_PX_S * budget }));
    }
    // Three halvings put the true step under the visible line — a 10x
    // error needs exactly that many — and the recovery then holds it
    // hovering around the honest budget rather than driving it to zero.
    expect(budgets[0]).toBeCloseTo(1.25, 6);
    expect(budgets[3]).toBeCloseTo(1.25 / 8, 6);
    expect(budgets[5]).toBeCloseTo(0.244140625, 9);
    expect(state.lastViolation?.channel).toBe('motion');
    // Every frame from the fourth on lands inside the visible step, and
    // none of them is a held frame.
    for (const b of budgets.slice(3)) {
      expect(b * TRUE_RATE_CSS_PX_S * 2).toBeLessThan(VIOLATION_DEVICE_PX);
      expect(b).toBeGreaterThan(0);
    }
  });

  it('trust floors rather than collapsing to continuous rendering', () => {
    let state = CADENCE_TRUST_INITIAL;
    for (let i = 0; i < 40; i++) {
      state = auditCadenceFrame(state, audit({ observedPx: 1e6 }));
    }
    expect(state.trust).toBe(CADENCE_TRUST_FLOOR);
    // Still idling: a 30 s cap at the floor is a frame every 0.47 s, which
    // keeps the diagnosis visible instead of hiding it behind 60 fps.
    expect(cadenceSimBudgetS(CADENCE_REPORT_STILL, Number.POSITIVE_INFINITY, 2, state.trust))
      .toBeCloseTo(30 / 64, 6);
  });

  it('clean scheduled frames recover trust, and it stops at whole', () => {
    let state = auditCadenceFrame(CADENCE_TRUST_INITIAL, audit({ observedPx: 1 }));
    expect(state.trust).toBe(0.5);
    state = auditCadenceFrame(state, audit());
    expect(state.trust).toBeCloseTo(0.5 * CADENCE_TRUST_RECOVER, 12);
    expect(state.cleanFrames).toBe(1);
    for (let i = 0; i < 20; i++) state = auditCadenceFrame(state, audit());
    expect(state.trust).toBe(1);
    // The diagnosis outlives the recovery — a driver that misbehaved once
    // stays named in the watcher.
    expect(state.lastViolation?.channel).toBe('motion');
  });
});
