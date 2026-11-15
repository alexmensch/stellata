// Anchor flux conservation: per anchor, the joint subset solve and the dim it decides. See README.md#anchor-flux-conservation.

import { absoluteMagnitude, apparentMagnitude } from '../../../../src/astro-core/perceptual-magnitude';
import { physicalRadius, type RadiusResolution } from '../../../../src/catalog-format/spectral/physical-radius';
import type { SpectralInfo } from '../../../../src/catalog-format/spectral/spectral-classify';
import { parentComponentToken } from '../../../binaries/component-tokens-pure';
import type { NamedStar } from '../../parse/stars-parse';
import { RIELLO_G_MINUS_V_SIGMA, vTierIsSystemBlend } from '../../photometry/v-magnitude-pure';
import { recordSpectralInfo, starDistPc } from './held-record';

// A member at M_blend + 0.05 carries ~95% of the blend's flux; anything
// brighter leaves no residual for the anchor to keep.
const ANCHOR_DIM_MIN_DELTA_MAG = 0.05;

/** README.md#the-decisive-margin. */
const ANCHOR_DIM_DECISIVE_MAG = RIELLO_G_MINUS_V_SIGMA;

// 2^N subset enumeration cap; real anchors carry ≤ ~6 fitted members.
const ANCHOR_DIM_MAX_FIT_MEMBERS = 16;

/** Calibrated — README.md#closest-is-not-close. */
export const ANCHOR_DIM_MAX_FIT_RESIDUAL_MAG = 0.2;

/** Calibrated — README.md#the-separation-gate. */
export const PRINTED_BLEND_MAX_SEP_ARCSEC = 10.0;
export const GAIA_BLEND_MAX_SEP_ARCSEC = 1.0;

/** README.md#registration. */
export function anchorMagIsCatalogued(anchor: NamedStar): boolean {
  return anchor.vVia !== null && anchor.vVia !== 'none';
}

/** A null separation is WDS publishing no measurement, which is no evidence of blending. */
function withinBlendSeparation(sepArcsec: number | null, maxSepArcsec: number): boolean {
  return sepArcsec !== null && sepArcsec <= maxSepArcsec;
}

/** Two designators at ONE level: an unresolved compound (`AB`, `Aab`, `Aa12`). */
const COMPOUND_COMPONENT_LEVEL = /[A-Z]{2,}|[a-z]{2,}|\d{2,}/;

/** README.md#anchor-alone. */
export function componentDepth(comp: string): number {
  const c = comp.trim();
  if (COMPOUND_COMPONENT_LEVEL.test(c)) return 0;
  let depth = 0;
  for (let tok: string | null = c; tok; tok = parentComponentToken(tok)) {
    depth++;
  }
  return depth;
}

export interface AnchorDimCandidate {
  anchorIdx: number;
  member: NamedStar;
  memberSpectral: SpectralInfo;
  /** `dmag_imputed` brightness is blend-relative (re-split by Δmag); `wds_mag`
   *  and `own` are independent member brightness (flux subtraction). */
  source: 'wds_mag' | 'dmag_imputed' | 'own';
  dmag: number | null;
  /** ids inherited from the anchor — README.md#the-separation-gate. */
  structural: boolean;
  /** Member's own observed-frame WDS magnitude. */
  memberWdsMag: number | null;
  /** The anchor component's own observed WDS magnitude; null on an escape row. */
  anchorWdsMag: number | null;
  /** Depth of the component letter `anchorWdsMag` describes. */
  anchorDepth: number;
  /** Angular separation from the anchor (″). */
  sepArcsec: number | null;
  av: number;
}

/** README.md#anchor-alone: the deepest candidate row's `mag_pri`, ties brightest. */
function anchorAloneMagnitude(cands: readonly AnchorDimCandidate[]): number | null {
  let best: { mag: number; depth: number } | null = null;
  for (const c of cands) {
    if (c.anchorWdsMag === null) continue;
    if (best === null
        || c.anchorDepth > best.depth
        || (c.anchorDepth === best.depth && c.anchorWdsMag < best.mag)) {
      best = { mag: c.anchorWdsMag, depth: c.anchorDepth };
    }
  }
  return best?.mag ?? null;
}

/** What became of one candidate. Every candidate gets exactly one. */
export const ANCHOR_DIM_VERDICTS = [
  'gaia-resolved', 'beyond-separation', 'unfit', 'misfit', 'outside', 'skipped',
  'subtracted', 're-split', 'unapplied',
] as const;
export type AnchorDimVerdict = typeof ANCHOR_DIM_VERDICTS[number];

/** Values as written: a later anchor can rewrite a record this one changed. */
export interface AnchorDim<C extends AnchorDimCandidate> {
  anchor: NamedStar;
  anchorAbsmag: number;
  anchorRadius: RadiusResolution;
  /** Re-split members, in the order their absmag was rewritten. */
  reSplit: { cand: C; absmag: number; radius: RadiusResolution }[];
  /** Origin keys of every member whose light the anchor lost. */
  members: string[];
}

export interface AnchorDimResult<C extends AnchorDimCandidate> {
  verdicts: { cand: C; verdict: AnchorDimVerdict }[];
  /** One per dimmed anchor, in the order applied. */
  dims: AnchorDim<C>[];
}

/** In place, one anchor at a time in first-registered order — README.md#anchor-flux-conservation. */
export function dimAnchors<C extends AnchorDimCandidate>(
  candidates: readonly C[],
  starAt: (idx: number) => NamedStar,
): AnchorDimResult<C> {
  const byAnchor = new Map<number, C[]>();
  for (const cand of candidates) {
    const bucket = byAnchor.get(cand.anchorIdx);
    if (bucket) bucket.push(cand);
    else byAnchor.set(cand.anchorIdx, [cand]);
  }
  const result: AnchorDimResult<C> = { verdicts: [], dims: [] };
  for (const cands of byAnchor.values()) dimAnchor(starAt(cands[0].anchorIdx), cands, result);
  return result;
}

function dimAnchor<C extends AnchorDimCandidate>(anchor: NamedStar, cands: readonly C[], result: AnchorDimResult<C>): void {
  const judge = (cand: C, verdict: AnchorDimVerdict): void => {
    result.verdicts.push({ cand, verdict });
  };
  const anchorAloneMag = anchorAloneMagnitude(cands);
  // README.md#observed-magnitude: one A_V for the group, the anchor's own distance.
  const av = cands[0].av;
  const distPc = starDistPc(anchor);
  const recordObsMag = (s: NamedStar): number | null => {
    const d = starDistPc(s);
    return d > 0 ? apparentMagnitude(s.absmag, d) + av : null;
  };
  const mObs = distPc > 0 ? recordObsMag(anchor) : null;
  // ONE definition of a member's light, for the fit and the subtraction alike — README.md#one-member-magnitude.
  const obsMag = (c: C): number | null => {
    if (c.source !== 'dmag_imputed') {
      const measured = recordObsMag(c.member);
      if (measured !== null) return measured;
    }
    return c.memberWdsMag !== null ? c.memberWdsMag
      : c.anchorWdsMag !== null && c.dmag !== null ? c.anchorWdsMag + c.dmag
        : null;
  };

  // A non-null member gaiaSourceId is already its own: the mint nulls a shared one.
  const anchorMagIsSystemBlend = vTierIsSystemBlend(anchor.vVia);
  const maxSepArcsec = anchorMagIsSystemBlend ? PRINTED_BLEND_MAX_SEP_ARCSEC : GAIA_BLEND_MAX_SEP_ARCSEC;
  const structural: C[] = [];
  const fitted: C[] = [];
  for (const c of cands) {
    if (anchorMagIsSystemBlend && c.structural) structural.push(c);
    else if (!anchorMagIsSystemBlend && c.member.gaiaSourceId !== null) judge(c, 'gaia-resolved');
    else if (!c.structural && !withinBlendSeparation(c.sepArcsec, maxSepArcsec)) judge(c, 'beyond-separation');
    else fitted.push(c);
  }
  const chosen = fitted.length === 0 ? [] : fitSubset(fitted, structural, obsMag, anchorAloneMag, mObs, judge);

  const applied = [...structural, ...chosen];
  if (applied.length === 0) return;
  if (mObs === null) {
    for (const c of applied) judge(c, 'unfit');
    return;
  }
  // Conservation is an OBSERVED-frame statement — README.md#conservation-is-observed-frame.
  let ownFlux = 0;
  const independents: C[] = [];
  const relatives: Array<{ cand: C; delta: number }> = [];
  for (const c of applied) {
    const memberMObs = obsMag(c);
    if (c.source === 'dmag_imputed') {
      const delta = anchorAloneMag !== null && memberMObs !== null
        ? memberMObs - anchorAloneMag : c.dmag;
      if (delta !== null) relatives.push({ cand: c, delta });
      else judge(c, 'unapplied');
      continue;
    }
    if (memberMObs === null || !(memberMObs > mObs + ANCHOR_DIM_MIN_DELTA_MAG)) {
      judge(c, 'skipped');
      continue;
    }
    ownFlux += Math.pow(10, -0.4 * memberMObs);
    independents.push(c);
  }
  if (relatives.length === 0 && independents.length === 0) return;
  const residualFlux = Math.pow(10, -0.4 * mObs) - ownFlux;
  if (!(residualFlux > 0)) {
    for (const c of independents) judge(c, 'skipped');
    for (const { cand } of relatives) judge(cand, 'unapplied');
    return;
  }
  const relSum = relatives.reduce((s, r) => s + Math.pow(10, -0.4 * r.delta), 0);
  const residualMObs = -2.5 * Math.log10(residualFlux / (1 + relSum));
  anchor.absmag = absoluteMagnitude(residualMObs - av, distPc);
  const reSplit: AnchorDim<C>['reSplit'] = [];
  for (const { cand, delta } of relatives) {
    cand.member.absmag = anchor.absmag + delta;
    const radius = physicalRadius(cand.member.absmag, cand.memberSpectral);
    cand.member.physicalRadius = radius.rSun;
    reSplit.push({ cand, absmag: cand.member.absmag, radius });
  }
  const anchorRadius = physicalRadius(anchor.absmag, recordSpectralInfo(anchor));
  anchor.physicalRadius = anchorRadius.rSun;
  for (const c of independents) judge(c, 'subtracted');
  for (const { cand } of relatives) judge(cand, 're-split');
  result.dims.push({
    anchor, anchorAbsmag: anchor.absmag, anchorRadius, reSplit,
    members: [...independents.map((c) => c.member.originKey), ...relatives.map(({ cand }) => cand.member.originKey)],
  });
}

/** The subset of `fitted` the anchor's blend contains, judging every member it leaves out. */
function fitSubset<C extends AnchorDimCandidate>(
  fitted: readonly C[],
  structural: readonly C[],
  obsMag: (c: C) => number | null,
  anchorAloneMag: number | null,
  mObs: number | null,
  judge: (cand: C, verdict: AnchorDimVerdict) => void,
): C[] {
  const participants = fitted.filter((c) => {
    if (obsMag(c) !== null) return true;
    judge(c, 'unfit');
    return false;
  });
  if (anchorAloneMag === null || mObs === null || participants.length === 0
      || participants.length > ANCHOR_DIM_MAX_FIT_MEMBERS) {
    for (const c of participants) judge(c, 'unfit');
    return [];
  }
  const baseFlux = Math.pow(10, -0.4 * anchorAloneMag)
    + structural.reduce((f, c) => {
      const m = obsMag(c);
      return m !== null ? f + Math.pow(10, -0.4 * m) : f;
    }, 0);
  const fluxes = participants.map((c) => Math.pow(10, -0.4 * (obsMag(c) as number)));
  const errs = new Array<number>(1 << participants.length);
  for (let mask = 0; mask < errs.length; mask++) {
    let f = baseFlux;
    for (let i = 0; i < participants.length; i++) {
      if (mask & (1 << i)) f += fluxes[i];
    }
    errs[mask] = Math.abs(mObs - (-2.5 * Math.log10(f)));
  }
  const bestErr = Math.min(...errs);
  if (bestErr > ANCHOR_DIM_MAX_FIT_RESIDUAL_MAG) {
    for (const c of participants) judge(c, 'misfit');
    return [];
  }
  if (errs[0] - bestErr < ANCHOR_DIM_DECISIVE_MAG) {
    for (const c of participants) judge(c, 'outside');
    return [];
  }
  let bestMask = 0;
  let bestBits = Infinity;
  for (let mask = 0; mask < errs.length; mask++) {
    if (errs[mask] - bestErr >= ANCHOR_DIM_DECISIVE_MAG) continue;
    let bits = 0;
    for (let i = 0; i < participants.length; i++) {
      if (mask & (1 << i)) bits++;
    }
    if (bits < bestBits || (bits === bestBits && errs[mask] < errs[bestMask])) {
      bestMask = mask;
      bestBits = bits;
    }
  }
  return participants.filter((c, i) => {
    if ((bestMask & (1 << i)) !== 0) return true;
    judge(c, 'outside');
    return false;
  });
}
