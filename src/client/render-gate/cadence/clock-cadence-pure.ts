// Motion-aware clock cadence: the per-frame rate report every layer
// files, and how long the render gate may idle given it. See
// README.md § The clock cadence.

/** On-screen motion smaller than this many DEVICE pixels between two
 *  rendered frames is below the step a viewer can resolve. Device, not
 *  CSS: a 0.5 CSS-px step is a whole physical pixel wherever the display
 *  runs at ratio 2, which is where a step first becomes visible. */
export const CADENCE_VISIBLE_STEP_DEVICE_PX = 0.5;

/** Margin the scheduling threshold keeps below the visible step.
 *
 *  Every rate the layers report is now their content's ACTUAL on-screen
 *  speed rather than a ceiling over a population, and an accurate rate
 *  carries no slack. That inverts the failure direction: a term someone
 *  forgets shows up as a visible FREEZE, not as wasted frames. Scheduling
 *  at half the visible step costs 2x the frames and buys a 2x error
 *  margin on every term at once — and it is what makes the handoff to
 *  `CADENCE_CAP_SIM_S` clean (README.md § Emerging from behind
 *  something). */
export const CADENCE_SAFETY_FACTOR = 2;

/** The scheduling threshold: how far anything drawn may travel, in device
 *  pixels, between two rendered frames. Layers reach it only through
 *  `cadenceSimBudgetS` — they report rates, the gate owns the conversion,
 *  so the threshold and the device-pixel conversion have one home. */
export const CADENCE_MOTION_THRESHOLD_DEVICE_PX =
  CADENCE_VISIBLE_STEP_DEVICE_PX / CADENCE_SAFETY_FACTOR;

/** The threshold above as a CAMERA TURN, in radians at the current view.
 *
 *  A writer that moves the camera itself cannot report a rate and be
 *  scheduled — it has already written by the time the gate looks — so the
 *  one thing it can do is decline to write a step below what a rendered
 *  frame could show. `RenderGate` compares poses for exact equality, so
 *  any write at all costs every subsequent tick a frame; this is how a
 *  per-frame camera writer stays inside the cadence instead of defeating
 *  it (`../README.md` § The focal ride).
 *
 *  A degenerate viewport answers 0 — ride every step — because the safe
 *  failure here is a frame too many, not an instrument that never moves. */
export function cadenceVisibleTurnRad(pxPerRadian: number, pixelRatio: number): number {
  const devicePxPerRadian = pxPerRadian * pixelRatio;
  return devicePxPerRadian > 0
    ? CADENCE_MOTION_THRESHOLD_DEVICE_PX / devicePxPerRadian
    : 0;
}

/** Just-noticeable brightness change, as a fraction of the changing
 *  body's own flux. The photometric twin of the pixel threshold, and
 *  carrying the same safety factor: 2 % of a body's flux is about the
 *  smallest dip a viewer catches, so the schedule runs at 1 %. */
export const CADENCE_JND_FLUX_FRAC = 0.01;

/** Just-noticeable brightness change in MAGNITUDES — the same 1 % of
 *  flux, for the one driver whose amplitude is published in magnitudes
 *  (the GCVS pulsation bound below). */
export const CADENCE_JND_MAG = 0.01;

/** Ceiling on how much sim time may pass between rendered frames while
 *  the clock runs, whatever the layers report.
 *
 *  Its job is exactly two things and the README says nothing else:
 *  something that has not started yet cannot be differenced (an eclipse
 *  ONSET — the first frame of a dip has no previous dip to difference
 *  against), and something not yet visible cannot be rated (a body
 *  emerging from behind another was contributing nothing the frame
 *  before). 30 s at 1x is one frame per 30 real seconds. */
export const CADENCE_CAP_SIM_S = 30;

/** One layer's answer to "how fast is what you are drawing changing,
 *  right now, in the camera's frame", plus what it saw actually happen
 *  since the last rendered frame.
 *
 *  The two RATE channels are the schedule's inputs, per SIM second, so
 *  the gate's conversion is the only place a threshold or a pixel ratio
 *  appears. Neither is a bound over a population: a star too faint to
 *  see, a body behind its parent, and a pair whose separation is
 *  sub-pixel all contribute nothing (README.md § Only ink on screen
 *  counts).
 *
 *  The two OBSERVED channels are the audit
 *  (`cadence-trust-pure.ts`) — measured, never derived from the rate
 *  model, or the check would only confirm its own arithmetic. */
export interface CadenceReport {
  /** Fastest on-screen speed of anything drawn, CSS px per sim second. */
  readonly screenPxPerSimS: number;
  /** Fastest brightness slope of anything drawn, as a fraction of that
   *  thing's own flux per sim second. */
  readonly fluxFracPerSimS: number;
  /** Largest on-screen displacement, in CSS px, that anything drawn
   *  actually underwent since the last rendered frame — from projecting
   *  both frames' positions, not from running a rate forward. */
  readonly observedPx: number;
  /** Largest fractional-flux change anything drawn actually underwent
   *  since the last rendered frame. */
  readonly observedFluxFrac: number;
}

/** A layer drawing nothing that moves or changes brightness. */
export const CADENCE_REPORT_STILL: CadenceReport = {
  screenPxPerSimS: 0,
  fluxFracPerSimS: 0,
  observedPx: 0,
  observedFluxFrac: 0,
};

/** `b` when it is strictly faster, else `a`. Written as a comparison
 *  rather than `Math.max` so a NaN rate cannot win the reduction and
 *  freeze the clock for every other layer: `NaN > a` is false.
 *
 *  The `isNaN` arm makes that symmetric. Without it a NaN in the LEFT
 *  operand survives every comparison after it, so one garbage report
 *  early in the reduction would swallow every real rate behind it — the
 *  same freeze by the other route. */
export function fasterRate(a: number, b: number): number {
  return b > a || Number.isNaN(a) ? b : a;
}

/** Channel-wise faster of two reports — the registry's reduction. */
export function maxCadenceReport(a: CadenceReport, b: CadenceReport): CadenceReport {
  return {
    screenPxPerSimS: fasterRate(a.screenPxPerSimS, b.screenPxPerSimS),
    fluxFracPerSimS: fasterRate(a.fluxFracPerSimS, b.fluxFracPerSimS),
    observedPx: fasterRate(a.observedPx, b.observedPx),
    observedFluxFrac: fasterRate(a.observedFluxFrac, b.observedFluxFrac),
  };
}

/** Sim-time budget for one rate against one threshold — the threshold
 *  over the rate, or Infinity when the rate is zero. */
function budgetFor(rate: number, threshold: number): number {
  return rate > 0 ? threshold / rate : Number.POSITIVE_INFINITY;
}

/** Sim-time budget for GCVS pulsation: the JND over the catalog's fastest
 *  brightness slope. The slope of 0.5·A·cos(2πt/P) peaks at A·π/P, so the
 *  fastest variable bounds every other. Suppressed records (eclipsers —
 *  extrinsically variable, they never pulsate) are excluded when the mask
 *  is given. Infinity for a catalog with no pulsating variable.
 *
 *  A load-time constant rather than a per-frame reduction over drawn
 *  variables, and allowed to be one only because it does not bind: on the
 *  shipped catalogue it measures 32.36 s, above the cap
 *  (`tests/cadence-pulsation-bound.test.ts` pins that and fails if a
 *  refresh brings it under). If it ever does bind, it has to become a
 *  per-frame reduction over the variables actually drawn. */
export function pulsationCadenceBudgetS(
  periodDays: ArrayLike<number>,
  amplitudeMag: ArrayLike<number>,
  suppressPulsation?: ArrayLike<number>,
): number {
  let maxRate = 0;
  for (let i = 0; i < periodDays.length; i++) {
    const p = periodDays[i];
    const a = amplitudeMag[i];
    if (p <= 0 || a <= 0) continue;
    if (suppressPulsation !== undefined && suppressPulsation[i] >= 0.5) continue;
    const rate = (a * Math.PI) / (p * 86400);
    if (rate > maxRate) maxRate = rate;
  }
  return budgetFor(maxRate, CADENCE_JND_MAG);
}

/** The frame's cadence budget: the smallest sim-time step that neither
 *  reported channel, the pulsation bound, nor the cap allows to be
 *  exceeded.
 *
 *  `trust` is the safety net's standing correction (1 = declarations have
 *  been holding up; below 1 = one has under-reported and the budget is
 *  shortened until it stops — `cadence-trust-pure.ts`). */
export function cadenceSimBudgetS(
  report: CadenceReport,
  pulsationBudgetS: number,
  pixelRatio: number,
  trust = 1,
): number {
  const devicePxPerSimS = report.screenPxPerSimS * Math.max(pixelRatio, 1);
  return trust * Math.min(
    CADENCE_CAP_SIM_S,
    budgetFor(devicePxPerSimS, CADENCE_MOTION_THRESHOLD_DEVICE_PX),
    budgetFor(report.fluxFracPerSimS, CADENCE_JND_FLUX_FRAC),
    pulsationBudgetS,
  );
}

/** Whether the running clock has outrun the budget since the last
 *  rendered frame. NaN `lastRenderedSimS` (nothing rendered yet) is due.
 *  Rate 0 is never due — a paused clock moves nothing, whatever the
 *  budget says.
 *
 *  The due test is `>=` against the elapsed sim time, which IS rule 6's
 *  "schedule to the first tick at or past the due time": the frame lands
 *  on the first tick that has crossed the budget, one tick of overshoot
 *  at worst. There is no minimum idle gap — with honest rates the
 *  budget at a close vantage is seconds, not milliseconds, and a floor
 *  would only be policy covering a measurement error. */
export function clockFrameDue(
  rate: number,
  simNowS: number,
  lastRenderedSimS: number,
  budgetS: number,
): boolean {
  if (rate === 0) return false;
  if (Number.isNaN(lastRenderedSimS)) return true;
  // Faster than live is the user asking to watch time move, so nothing
  // idles there. Generalising the cadence past live rate is what puts a
  // held frame in front of someone waiting for one.
  if (Math.abs(rate) > 1) return true;
  // Negated, not `<=`: a NaN budget must render rather than freeze the
  // clock. The reduction drops NaN before it gets here and this must not
  // come to depend on that.
  if (!(budgetS > 0)) return true;
  return Math.abs(simNowS - lastRenderedSimS) >= budgetS;
}
