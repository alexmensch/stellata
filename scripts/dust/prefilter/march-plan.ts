// The band raymarch factored so the dust read is a plug-in: step geometry,
// emissivity and analytic-tier A_V are precomputed per sightline, and a method
// supplies only the measured A_V.

import * as THREE from 'three';
import { analyticAv, coverageSpan, type Coverage, type Ray } from './froxel';
import { coverageRadiusPc, type DustField } from './dust-grid';
import {
  FOREGROUND_DUST_STEPS,
  MAG_PER_TAU,
  MILKYWAY_COMPONENTS,
  REDDENING_RGB,
  S_MIN_PC,
  STEPS,
  meshSpanPc,
  type MilkywayComponent,
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
  readonly name: MilkywayComponent['name'];
  readonly colorRgb: readonly [number, number, number];
  readonly steps: PlanStep[];
}

export interface MarchPlan {
  readonly ray: Ray;
  readonly cov: Coverage;
  readonly components: PlanComponent[];
}

export function buildMarchPlan(field: DustField, originPc: Vec3, dirUnit: Vec3): MarchPlan {
  const ray: Ray = {
    o: new THREE.Vector3(originPc[0], originPc[1], originPc[2]),
    u: new THREE.Vector3(dirUnit[0], dirUnit[1], dirUnit[2]),
  };
  const cov = coverageSpan(ray, coverageRadiusPc(field.params));
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
        steps.push({ sa, sb, dsPc: ds, density: 0, analytic: analyticAv(field, ray, cov, sa, sb) });
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
        analytic: analyticAv(field, ray, cov, sa, sb),
      });
    }
    components.push({
      name: component.name,
      colorRgb: component.colorRgb as [number, number, number],
      steps,
    });
  }
  return { ray, cov, components };
}

/** A method supplies the MEASURED A_V of a step; `withAnalytic` adds the tier
 *  the plan already holds. */
export type MeasuredAv = (sa: number, sb: number) => number;
/** A method that owns the whole cascade value for a step. */
export type StepAv = (step: PlanStep) => number;

export function withAnalytic(measured: MeasuredAv): StepAv {
  return (step) => step.analytic + measured(step.sa, step.sb);
}

/** Per-component accumulation summed at the end, never one shared
 *  accumulator: `sightlineColumnRgb` groups the two additively-blended meshes
 *  that way, and the grouping is what makes the two agree to the last bit. */
export function planColumn(plan: MarchPlan, av: StepAv): number {
  const total: [number, number, number] = [0, 0, 0];
  for (const component of plan.components) {
    const accum: [number, number, number] = [0, 0, 0];
    const tau: [number, number, number] = [0, 0, 0];
    for (const step of component.steps) {
      const stepAv = av(step);
      for (let k = 0; k < 3; k++) {
        const dTau = (stepAv * REDDENING_RGB[k]) / MAG_PER_TAU;
        const transmittance = Math.exp(-tau[k]) * Math.exp(-0.5 * dTau);
        accum[k] += step.density * component.colorRgb[k] * transmittance * step.dsPc;
        tau[k] += dTau;
      }
    }
    for (let k = 0; k < 3; k++) total[k] += accum[k];
  }
  return relativeLuminance(total);
}

/** Measured column one component accumulates over its own march. */
export function planMeasuredColumn(
  plan: MarchPlan,
  name: MilkywayComponent['name'],
  measured: MeasuredAv,
): number {
  const component = plan.components.find((c) => c.name === name);
  if (component === undefined) return 0;
  let acc = 0;
  for (const step of component.steps) acc += measured(step.sa, step.sb);
  return acc;
}
