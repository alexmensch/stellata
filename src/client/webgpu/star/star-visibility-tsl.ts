// The dust-independent visibility prefilter every star stage runs, the two
// bounds it re-tests on the extincted magnitude, and the clock-independent
// form the extinction cache gates on. README.md#dust-extinction--two-tiers-one-gate.

import { Fn, float, log, uint } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';
import { STAR_PASS_GLOW, type StarPass } from '../../star-pipeline/star-pass';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import type { StarTables } from './star-tables';

type NF = Node<'float'>;

/** The instrument and filter uniforms the A_V cache gates its march on, and
 *  therefore the complete set a change to any of which has to invalidate it.
 *  Both types below and the cache's watch derive from this list rather than
 *  restating it (`../extinction/README.md#the-cache-gate`). */
export const STAR_VISIBILITY_BOUND_KEYS = [
  'uThresholdMag', 'uCullMag', 'uMinDistSol', 'uMaxDistSol', 'uSpectMask', 'uMonochrome',
] as const;

export type StarVisibilityBoundKey = typeof STAR_VISIBILITY_BOUND_KEYS[number];

/** Those slots as the shell's value objects, shared by reference with the
 *  star pipeline's sharedUniforms map. */
export type StarVisibilityBoundValues = Record<StarVisibilityBoundKey, { value: number }>;

/** `SharedUniformNodes` satisfies this, and so does the extinction
 *  prepass's own record (`../extinction/README.md#the-cache-gate`). */
export type StarVisibilityUniforms = Pick<SharedUniformNodes, StarVisibilityBoundKey>;

/** The distance modulus alone — before pulsation, eclipse dim or
 *  extinction. */
export const appMagAtTsl = /* @__PURE__ */ Fn(([absmag, dPc]: [NF, NF]) => (
  absmag.add(log(dPc).mul(1 / Math.LN10).sub(1.0).mul(5.0))
));

export interface StarVisibility {
  chart: Node<'bool'>;
  /** Fresh nodes per call: a TSL comparison reads its variable where the
   *  enclosing `If` emits it, so one node object used in two places would
   *  read two different magnitudes. */
  magOk(): Node<'bool'>;
  taperAlive(): Node<'bool'>;
  /** All four terms, and exact ahead of the extinction read: A_V ≥ 0 and
   *  both bounds are monotonic in dust (README.md#dust-extinction--two-tiers-one-gate). */
  alive(): Node<'bool'>;
}

export function starVisibilityTsl(
  u: StarVisibilityUniforms,
  spectClass: NF,
  distSol: NF,
  appMag: NF,
  pass: StarPass,
): StarVisibility {
  const spectOk = u.uSpectMask
    .bitAnd(uint(1).shiftLeft(uint(spectClass)))
    .notEqual(uint(0));
  const distOk = distSol.greaterThanEqual(u.uMinDistSol)
    .and(distSol.lessThanEqual(u.uMaxDistSol));
  // Chart sizes and clips against uLimitMag in the fragment stage and
  // keeps its quads, so the taper cull is off there entirely.
  const chart = u.uMonochrome.greaterThan(0.5);
  const magOk = () => appMag.lessThanEqual(u.uCullMag);
  const taperAlive = () => chart.or(pass === STAR_PASS_GLOW
    ? appMag.lessThan(u.uThresholdMag.add(SOFT_TAPER_MARGIN_MAG))
    : appMag.lessThanEqual(u.uThresholdMag));
  return {
    chart,
    magOk,
    taperAlive,
    alive: () => spectOk.and(distOk).and(magOk()).and(taperAlive()),
  };
}

/**
 * The prefilter a per-star CACHE may gate on: the same four terms over the
 * BRIGHTEST magnitude the star can reach, so the answer is clock-independent
 * and every stage's own prefilter admits a subset of it.
 * `../extinction/README.md#the-cache-gate`.
 */
export function starCacheVisibleTsl(
  u: StarVisibilityUniforms,
  tables: StarTables,
  self: Node<'int'>,
  dPc: NF,
): Node<'bool'> {
  const stat = (name: Parameters<StarTables['stat']>[1]) => tables.stat(self, name);
  const appMag = appMagAtTsl(stat('iAbsmag'), dPc)
    .sub(stat('iAmplitudeMag').mul(0.5));
  return starVisibilityTsl(
    u, stat('iSpectClass'), stat('iDistSol'), float(appMag), STAR_PASS_GLOW,
  ).alive();
}
