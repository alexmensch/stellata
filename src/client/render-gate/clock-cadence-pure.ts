// Motion-aware clock cadence: how long the render gate may idle under a
// running sim clock before anything drawn could visibly move. See
// README.md § The clock cadence.

/** On-screen motion below this many DEVICE pixels between two rendered
 *  frames is invisible. Device, not CSS: a 0.5 CSS-px step is a whole
 *  physical pixel wherever the display runs at ratio 2, which is where
 *  a step first becomes visible. Layers reach it through
 *  `cadenceBudgetFromRatePxS`. */
export const CADENCE_MOTION_THRESHOLD_DEVICE_PX = 0.5;

/** Sim-time budget for a layer whose drawn content moves no faster than
 *  `maxRateCssPxPerS` on screen — the motion threshold over that rate,
 *  or Infinity when nothing it draws moves at all. Rates come in CSS px
 *  (the unit every screen-size calc in the client works in) and the
 *  pixel ratio converts them to the device pixels the threshold is
 *  stated in. */
export function cadenceBudgetFromRatePxS(
  maxRateCssPxPerS: number,
  pixelRatio: number,
): number {
  const deviceRate = maxRateCssPxPerS * Math.max(pixelRatio, 1);
  return deviceRate > 0
    ? CADENCE_MOTION_THRESHOLD_DEVICE_PX / deviceRate
    : Number.POSITIVE_INFINITY;
}

/** Just-noticeable brightness change, in magnitudes — the photometric
 *  twin of the pixel threshold (~1 % flux). */
export const CADENCE_JND_MAG = 0.01;

/** Ceiling on how much sim time may pass between rendered frames while
 *  the clock runs, whatever the layers report. Covers every photometric
 *  driver without a per-frame bound of its own — an eclipse ONSET (the
 *  dim fields evaluate on rendered frames, so a dip can start at most
 *  this late), and any future sim-driven change not yet reporting a
 *  budget. 30 s at 1× is one frame per 30 real seconds. */
export const CADENCE_CAP_SIM_S = 30;

/** Sim-time budget for GCVS pulsation: the JND over the catalog's fastest
 *  brightness slope. The slope of 0.5·A·cos(2πt/P) peaks at A·π/P, so the
 *  fastest variable bounds every other. Suppressed records (eclipsers —
 *  extrinsically variable, they never pulsate) are excluded when the mask
 *  is given. Infinity for a catalog with no pulsating variable. */
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
  return maxRate > 0 ? CADENCE_JND_MAG / maxRate : Number.POSITIVE_INFINITY;
}

/** The frame's clock-cadence budget: the smallest sim-time step any
 *  layer, the pulsation bound, or the cap allows. `layerBudgetS` is the
 *  registry's min over per-layer budgets (Infinity when none reported). */
export function cadenceSimBudgetS(
  layerBudgetS: number,
  pulsationBudgetS: number,
): number {
  return Math.min(CADENCE_CAP_SIM_S, layerBudgetS, pulsationBudgetS);
}

/** Shortest gap between rendered frames, in REAL seconds, that idling is
 *  worth. The budget bounds how far anything steps between two frames; it
 *  says nothing about how long the picture may be stale, and those only
 *  coincide while frames are frequent. Gaps shorter than this are the
 *  worst of both: long enough to read as a hang, short enough to save
 *  nothing, and close enough to one rAF tick that the due test flips
 *  between rendering and skipping tick to tick — which is judder rather
 *  than idle. They collapse to continuous rendering instead. */
export const CADENCE_MIN_IDLE_GAP_REAL_S = 2;

/** Whether the running clock has outrun the budget since the last
 *  rendered frame. NaN `lastRenderedSimS` (nothing rendered yet) is due.
 *  Rate 0 is never due — a paused clock moves nothing, whatever the
 *  budget says. */
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
  // Negated `>=`, not `<`: a NaN budget must render rather than freeze
  // the clock. The registry drops NaN before it gets here and this must
  // not come to depend on that.
  if (!(budgetS >= CADENCE_MIN_IDLE_GAP_REAL_S * Math.abs(rate))) return true;
  return Math.abs(simNowS - lastRenderedSimS) >= budgetS;
}
