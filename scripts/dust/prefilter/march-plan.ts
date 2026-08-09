// The band raymarch factored so the dust read is a plug-in: step geometry,
// emissivity and analytic-tier A_V are precomputed per sightline, and a method
// supplies only the measured A_V.

import * as THREE from 'three';
import { analyticAv, coverageSpan, type Coverage, type Ray } from './froxel';
import {
  FOREGROUND_DUST_STEPS,
  MAG_PER_TAU,
  MILKYWAY_COMPONENTS,
  REDDENING_RGB,
  S_MIN_PC,
  STEPS,
  meshSpanPc,
  type Vec3,
} from '../../../src/client/milkyway/milkyway-column-pure';
import { relativeLuminance } from '../../../src/client/hdr/tonemap-pure';

export interface PlanStep {
  readonly sa: number;
  readonly sb: number;
  readonly dsPc: number;
  /** Emissivity at the step midpoint; 0 for the foreground pre-march. */
  readonly density: number;
  readonly analytic: number;
}

export interface PlanComponent {
  readonly colorRgb: readonly [number, number, number];
  readonly steps: PlanStep[];
}

export interface MarchPlan {
  readonly ray: Ray;
  readonly cov: Coverage;
  readonly components: PlanComponent[];
}

export function buildMarchPlan(originPc: Vec3, dirUnit: Vec3): MarchPlan {
  const ray: Ray = {
    o: new THREE.Vector3(originPc[0], originPc[1], originPc[2]),
    u: new THREE.Vector3(dirUnit[0], dirUnit[1], dirUnit[2]),
  };
  const cov = coverageSpan(ray);
  const components: PlanComponent[] = [];

  for (const component of MILKYWAY_COMPONENTS) {
    const span = meshSpanPc(originPc, dirUnit, component.meshScalePc);
    if (span === null) continue;
    const sStart = Math.max(span.sNear, S_MIN_PC);
    const sEnd = span.sFar;
    if (sStart >= sEnd) continue;
    const steps: PlanStep[] = [];

    if (sStart > S_MIN_PC) {
      const ds = (sStart - S_MIN_PC) / FOREGROUND_DUST_STEPS;
      for (let i = 0; i < FOREGROUND_DUST_STEPS; i++) {
        const sa = S_MIN_PC + i * ds;
        const sb = sa + ds;
        steps.push({ sa, sb, dsPc: ds, density: 0, analytic: analyticAv(ray, cov, sa, sb) });
      }
    }

    const logMin = Math.log(sStart);
    const logStep = (Math.log(sEnd) - logMin) / STEPS;
    let prevS = sStart;
    for (let i = 0; i < STEPS; i++) {
      const sb = Math.exp(logMin + (i + 1) * logStep);
      const sMid = Math.exp(logMin + (i + 0.5) * logStep);
      const sa = prevS;
      prevS = sb;

      const px = originPc[0] + sMid * dirUnit[0];
      const py = originPc[1] + sMid * dirUnit[1];
      const pz = originPc[2] + sMid * dirUnit[2];
      let outside = -1;
      const local = [px, py, pz];
      for (let k = 0; k < 3; k++) {
        const q = local[k] / component.meshScalePc[k];
        outside += q * q;
      }
      if (outside > 0.001) break;

      steps.push({
        sa,
        sb,
        dsPc: sb - sa,
        density: component.density(Math.hypot(px, py), pz),
        analytic: analyticAv(ray, cov, sa, sb),
      });
    }
    components.push({ colorRgb: component.colorRgb as [number, number, number], steps });
  }
  return { ray, cov, components };
}

/** A method supplies the MEASURED A_V of a step; the plan adds the analytic tier. */
export type MeasuredAv = (sa: number, sb: number) => number;
/** A method that owns the whole cascade value for a step (the direct march). */
export type TotalAv = (sa: number, sb: number) => number;

export function planColumn(plan: MarchPlan, total: TotalAv): number {
  const accum: [number, number, number] = [0, 0, 0];
  for (const component of plan.components) {
    const tau: [number, number, number] = [0, 0, 0];
    for (const step of component.steps) {
      const av = total(step.sa, step.sb);
      for (let k = 0; k < 3; k++) {
        const dTau = (av * REDDENING_RGB[k]) / MAG_PER_TAU;
        const transmittance = Math.exp(-tau[k]) * Math.exp(-0.5 * dTau);
        accum[k] += step.density * component.colorRgb[k] * transmittance * step.dsPc;
        tau[k] += dTau;
      }
    }
  }
  return relativeLuminance(accum);
}

export function withAnalytic(plan: MarchPlan, measured: MeasuredAv): TotalAv {
  const byKey = new Map<number, number>();
  for (const component of plan.components) {
    for (const step of component.steps) byKey.set(step.sa, step.analytic);
  }
  return (sa, sb) => (byKey.get(sa) ?? 0) + measured(sa, sb);
}

/** Measured column the march accumulates over the whole sightline. */
export function planMeasuredColumn(plan: MarchPlan, measured: MeasuredAv): number {
  const component = plan.components[0];
  if (component === undefined) return 0;
  let acc = 0;
  for (const step of component.steps) acc += measured(step.sa, step.sb);
  return acc;
}
