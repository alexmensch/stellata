// The binding-integrity audit: verdicts on one source across disjoint letters and one letter across sources, then their enforcement. See README.md#the-binding-integrity-audit.

import { canonicalCompLetter, componentKey, compoundContains, relatedHier, type ComponentKey } from '../component-tokens-pure';
import type { GaiaAstrometryRow } from '../load/gaia-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import type { SimbadWdsXid } from '../load/simbad-pure';
import { measuredOffset, type WdsPair } from '../../wds/wds-pure';
import { fold } from '../../util/counts/tally-pure';
import { compareSourceIds } from '../../util/tsv/table-pure';
import { polarToTangent, propagatePosition, tangentOffset, type TangentOffset } from '../sky-geometry-pure';
import { working, type DecomposedPair, type Draft, type DraftPair } from './components-pure';
import { inheritDownwardParentBindings, propagateIdentities, smearIfSeeded } from './propagate-pure';
import { addTo, groupBy, pushTo } from '../../util/map-buckets-pure';

export const BINDING_SHAPES = ['source_letters', 'letter_sources'] as const;
export type BindingShape = (typeof BINDING_SHAPES)[number];

export const BINDING_VERDICTS = [
  'geometric', 'identity_refuted', 'unbound_ambiguous', 'skipped_no_reference', 'skipped_photocentre_blend',
] as const;
export type BindingVerdictKind = (typeof BINDING_VERDICTS)[number];

/** A winner must sit within the floor and beat the runner-up by 2×. The floor
 *  is flat: a wide pair's chain accumulates error, so scaling it with ρ would
 *  pass a source arcseconds off the winner. */
export const ARBITRATION_ABS_TOLERANCE_ARCSEC = 2.0;
export const ARBITRATION_RUNNERUP_FACTOR = 0.5;
/** A measured-pair blend is enforced only when the source sits on one
 *  component: a genuine coincidence is sub-arcsecond. */
export const ARBITRATION_BLEND_FLOOR_ARCSEC = 1.0;

/** The secondary's offset from the primary, and the WDS year that measured it. */
export interface Edge {
  readonly eastArcsec: number;
  readonly northArcsec: number;
  readonly epoch: number | null;
}

/** Registers an edge both ways, keeping the newest measurement when a token
 *  pair recurs across discoverers. */
export function addNewestEdge<E>(
  adj: Map<string, Map<string, E>>, a: string, b: string, forward: E, backward: E,
  epoch: number | null, epochOf: (edge: E) => number | null,
): void {
  for (const [src, dst, edge] of [[a, b, forward], [b, a, backward]] as const) {
    let nbrs = adj.get(src);
    if (!nbrs) adj.set(src, (nbrs = new Map()));
    const existing = nbrs.get(dst);
    if (existing !== undefined) {
      const old = epochOf(existing);
      if (!(epoch !== null && (old === null || epoch >= old))) continue;
    }
    nbrs.set(dst, edge);
  }
}

/** A measured offset both ways, the newest kept: `addNewestEdge` over `Edge`. */
export function addEdge(adj: Map<string, Map<string, Edge>>, a: string, b: string, v: TangentOffset, epoch: number | null): void {
  addNewestEdge(
    adj, a, b,
    { eastArcsec: v.eastArcsec, northArcsec: v.northArcsec, epoch },
    { eastArcsec: -v.eastArcsec, northArcsec: -v.northArcsec, epoch },
    epoch, (e) => e.epoch,
  );
}

/** The secondary's (E, N) offset, or null without a measured ρ > 0 and θ. */
export function pairVector(pair: WdsPair): TangentOffset | null {
  const offset = measuredOffset(pair);
  if (offset === null) return null;
  return polarToTangent(offset.rhoArcsec, offset.thetaDeg);
}

/** One WDS system's bindings, as the audit weighs them. */
export interface SystemContext {
  readonly wdsId: string;
  readonly tokenSources: Map<string, Set<string>>;
  readonly tokenMag: Map<string, number>;
  readonly blendPairs: [string, string][];
  /** Sources bound to both sides of a measured pair: Gaia blends. */
  readonly blendSources: Set<string>;
  readonly adj: Map<string, Map<string, Edge>>;
  /** Canonical token → its instances, as (pair index, side). */
  readonly instances: Map<string, Instance[]>;
}

export interface Instance {
  readonly pairIdx: number;
  readonly side: 'primary' | 'secondary';
}

export function buildSystemContexts(pairs: readonly DecomposedPair[]): ReadonlyMap<string, SystemContext> {
  const systems = new Map<string, SystemContext>();
  pairs.forEach(({ pair, primary: p, secondary: s }, pairIdx) => {
    let ctx = systems.get(pair.wdsId);
    if (!ctx) {
      ctx = {
        wdsId: pair.wdsId, tokenSources: new Map(), tokenMag: new Map(), blendPairs: [],
        blendSources: new Set(), adj: new Map(), instances: new Map(),
      };
      systems.set(pair.wdsId, ctx);
    }
    const pTok = p.component;
    const sTok = canonicalCompLetter(pTok, s.component);
    if (pair.rhoLast === null || pair.rhoLast === 0) ctx.blendPairs.push([pTok, sTok]);
    else if (p.gaiaSourceId !== null && p.gaiaSourceId === s.gaiaSourceId) ctx.blendSources.add(p.gaiaSourceId);
    for (const [tok, side, mag] of [[pTok, 'primary', pair.magPri], [sTok, 'secondary', pair.magSec]] as const) {
      pushTo(ctx.instances, tok, { pairIdx, side });
      const src = (side === 'primary' ? p : s).gaiaSourceId;
      if (src !== null) addTo(ctx.tokenSources, tok, src);
      if (mag !== null && mag < (ctx.tokenMag.get(tok) ?? Infinity)) ctx.tokenMag.set(tok, mag);
    }
    const v = pairVector(pair);
    if (v !== null) addEdge(ctx.adj, pTok, sTok, v, pair.dateLast);
  });
  return systems;
}

/** Sub-resolution blend-mates, transitively through ancestors: `A`/`B` are
 *  mates when an (Aa, Bx) sub-pair blends. */
export function arePairMates(x: string, y: string, blendPairs: readonly (readonly [string, string])[]): boolean {
  return blendPairs.some(([p, s]) => (relatedHier(x, p) && relatedHier(y, s)) || (relatedHier(x, s) && relatedHier(y, p)));
}

function tokensRelated(x: string, y: string, blendPairs: readonly (readonly [string, string])[]): boolean {
  return relatedHier(x, y) || compoundContains(x, y) || arePairMates(x, y, blendPairs);
}

/** Breadth-first from `start` over shortest-hop chains of pair rows, each
 *  token's value fixed where the walk first reaches it. `token` order visits
 *  neighbours sorted, so the result never depends on insertion order. */
export function walk<E, V>(
  adj: ReadonlyMap<string, ReadonlyMap<string, E>>, start: string, origin: V, step: (at: V, edge: E) => V,
  order: 'insertion' | 'token' = 'insertion',
): Map<string, V> {
  const out = new Map<string, V>([[start, origin]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const tok = queue[head];
    const nbrs = [...(adj.get(tok) ?? [])];
    if (order === 'token') nbrs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [nbr, edge] of nbrs) {
      if (out.has(nbr)) continue;
      out.set(nbr, step(out.get(tok)!, edge));
      queue.push(nbr);
    }
  }
  return out;
}

/** The tangent-plane offset along the shortest-hop chain of pair rows, with
 *  the epoch of the edge reaching `goal`; null when no chain connects them. */
export function bfsOffset(adj: SystemContext['adj'], start: string, goal: string): Edge | null {
  const origin: Edge = { eastArcsec: 0, northArcsec: 0, epoch: null };
  return walk(adj, start, origin, (at, edge: Edge) => ({
    eastArcsec: at.eastArcsec + edge.eastArcsec, northArcsec: at.northArcsec + edge.northArcsec, epoch: edge.epoch,
  })).get(goal) ?? null;
}

function sourceOffset(src: GaiaAstrometryRow, ref: GaiaAstrometryRow, epoch: number | null): TangentOffset {
  if (epoch === null) return tangentOffset({ raDeg: src.raDeg, decDeg: src.decDeg }, { raDeg: ref.raDeg, decDeg: ref.decDeg });
  const at = (r: GaiaAstrometryRow) => propagatePosition(
    { raDeg: r.raDeg, decDeg: r.decDeg }, { pmRaMasyr: r.pmraMasyr, pmDecMasyr: r.pmdecMasyr }, r.refEpoch, epoch,
  );
  return tangentOffset(at(src), at(ref));
}

/** The better of J2016.0 and, when the chain carries one, the WDS edge epoch. */
function arbitrationError(src: GaiaAstrometryRow, ref: GaiaAstrometryRow, predicted: Edge): number {
  const miss = (o: TangentOffset) => Math.hypot(o.eastArcsec - predicted.eastArcsec, o.northArcsec - predicted.northArcsec);
  const err = miss(sourceOffset(src, ref, null));
  return predicted.epoch === null ? err : Math.min(err, miss(sourceOffset(src, ref, predicted.epoch)));
}

export interface BindingCandidate {
  /** A cluster's representative token, or a contested source_id. */
  readonly label: string;
  readonly tokens: readonly string[];
  readonly sourceId: string;
  /** Infinity when no token chains to the reference or the source has no astrometry. */
  readonly errArcsec: number;
  readonly predictedSepArcsec: number;
}

export interface UnbindTarget {
  readonly token: string;
  readonly sourceId: string;
}

export interface BindingVerdict {
  readonly wdsId: string;
  readonly shape: BindingShape;
  readonly verdict: BindingVerdictKind;
  readonly contested: string;
  readonly reference: { readonly token: string; readonly sourceId: string } | null;
  readonly winner: BindingCandidate | null;
  readonly candidates: readonly BindingCandidate[];
  /** What enforcement does; null for a skipped conflict. */
  readonly action: VerdictAction | null;
}

export type VerdictAction =
  /** Every instance of the letter rebinds to the source. */
  | { readonly kind: 'rebind'; readonly letter: string; readonly sourceId: string }
  | { readonly kind: 'unbind'; readonly targets: readonly UnbindTarget[] };

interface Reference {
  readonly token: string;
  readonly sourceId: string;
  readonly astro: GaiaAstrometryRow;
}

/** A letter whose one source has astrometry, every predicted offset's anchor:
 *  `A` first, then the brightest. */
function selectReference(
  ctx: SystemContext, excludeTokens: ReadonlySet<string>, excludeSources: ReadonlySet<string>, indices: IdentifierIndices,
): Reference | null {
  let best: { rank: [number, number, string]; ref: Reference } | null = null;
  for (const [tok, sources] of ctx.tokenSources) {
    if (excludeTokens.has(tok) || sources.size !== 1) continue;
    const [src] = sources;
    if (excludeSources.has(src)) continue;
    const astro = indices.srcToAstrometry.get(src);
    if (astro === undefined) continue;
    const rank: [number, number, string] = [tok === 'A' ? 0 : 1, ctx.tokenMag.get(tok) ?? Infinity, tok];
    if (best === null || rankBefore(rank, best.rank)) best = { rank, ref: { token: tok, sourceId: src, astro } };
  }
  return best === null ? null : best.ref;
}

function rankBefore(a: [number, number, string], b: [number, number, string]): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/** Mutually related tokens bound to one source are one star; two clusters is a contradiction. */
function clusterTokens(tokens: ReadonlySet<string>, blendPairs: SystemContext['blendPairs']): string[][] {
  const toks = [...tokens].sort();
  const parent = new Map(toks.map((t) => [t, t]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j < toks.length; j++) {
      if (tokensRelated(toks[i], toks[j], blendPairs)) parent.set(find(toks[i]), find(toks[j]));
    }
  }
  return [...groupBy(toks, find).values()];
}

/** The ancestor, or shortest token: `{A, Aa}` → `A`. */
function clusterRepresentative(cluster: readonly string[]): string {
  return cluster.reduce((best, t) => (t.length < best.length || (t.length === best.length && t < best) ? t : best));
}

/** The best (error, predicted separation) over the cluster's tokens. */
function clusterError(
  ctx: SystemContext, ref: Reference, tokens: readonly string[], source: string, indices: IdentifierIndices,
): { err: number; sep: number } {
  const srcAstro = indices.srcToAstrometry.get(source);
  if (srcAstro === undefined) return { err: Infinity, sep: 0 };
  let best = { err: Infinity, sep: 0 };
  for (const tok of tokens) {
    const pred = bfsOffset(ctx.adj, ref.token, tok);
    if (pred === null) continue;
    const err = arbitrationError(srcAstro, ref.astro, pred);
    if (err < best.err) best = { err, sep: Math.hypot(pred.eastArcsec, pred.northArcsec) };
  }
  return best;
}

/** Error ascending; Infinity last. */
export const byError = (a: BindingCandidate, b: BindingCandidate): number =>
  (a.errArcsec < b.errArcsec ? -1 : a.errArcsec > b.errArcsec ? 1 : 0);

function refuted(c: BindingCandidate): boolean {
  return Number.isFinite(c.errArcsec) && c.errArcsec > ARBITRATION_ABS_TOLERANCE_ARCSEC;
}

/** The winner by margin (inside the floor, 2× the runner-up), else by
 *  refutation (every reachable candidate refuted, exactly one unreachable),
 *  else null: ambiguous. */
function decide(candidates: readonly BindingCandidate[]): BindingCandidate | null {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort(byError);
  const win = ranked[0];
  if (Number.isFinite(win.errArcsec)) {
    const runnerUp = ranked.length > 1 ? ranked[1].errArcsec : Infinity;
    if (win.errArcsec <= ARBITRATION_ABS_TOLERANCE_ARCSEC && win.errArcsec <= ARBITRATION_RUNNERUP_FACTOR * runnerUp) return win;
  }
  const reachable = candidates.filter((c) => Number.isFinite(c.errArcsec));
  const unreachable = candidates.filter((c) => !Number.isFinite(c.errArcsec));
  if (reachable.length > 0 && unreachable.length === 1 && reachable.every(refuted)) return unreachable[0];
  return null;
}

/** SIMBAD's curated source for the component, directly or through its HIP. */
function xidOwnSource(
  wdsId: string, token: string, indices: IdentifierIndices, xids: ReadonlyMap<ComponentKey, SimbadWdsXid>,
): string | null {
  const xid = xids.get(componentKey(wdsId, token));
  if (xid === undefined) return null;
  if (xid.gaiaSourceId !== null) return xid.gaiaSourceId;
  if (xid.hip === null) return null;
  return indices.hipToGaia.get(xid.hip) ?? indices.hipToAthyg.get(xid.hip)?.gaia ?? null;
}

/** A measured-pair "blend" where SIMBAD gives exactly one side the contested
 *  source and the other side a different one is a cross-walk mis-match. The
 *  loser must be one token: rebinding re-homes one letter. */
function refutePhotocentreBlend(
  ctx: SystemContext, cands: readonly BindingCandidate[], src: string,
  indices: IdentifierIndices, xids: ReadonlyMap<ComponentKey, SimbadWdsXid>,
): { owner: BindingCandidate; loserToken: string; loserSource: string } | null {
  if (cands.length !== 2) return null;
  const own = cands.map((c) => xidOwnSource(ctx.wdsId, c.label, indices, xids));
  if (own.some((o) => o === null)) return null;
  const owners = cands.filter((_c, i) => own[i] === src);
  if (owners.length !== 1) return null;
  const owner = owners[0];
  const loserIdx = cands.findIndex((c) => c !== owner);
  const loser = cands[loserIdx];
  const loserSource = own[loserIdx]!;
  if (loserSource === src || loser.tokens.length !== 1) return null;
  return { owner, loserToken: loser.tokens[0], loserSource };
}

function auditSystem(
  ctx: SystemContext, indices: IdentifierIndices, xids: ReadonlyMap<ComponentKey, SimbadWdsXid>,
): BindingVerdict[] {
  const verdicts: BindingVerdict[] = [];
  const verdict = (
    shape: BindingShape, kind: BindingVerdictKind, contested: string, ref: Reference | null,
    winner: BindingCandidate | null, candidates: readonly BindingCandidate[], action: VerdictAction | null,
  ): void => {
    verdicts.push({
      wdsId: ctx.wdsId, shape, verdict: kind, contested,
      reference: ref === null ? null : { token: ref.token, sourceId: ref.sourceId },
      winner, candidates, action,
    });
  };
  const blendLetters = new Set<string>();
  const identityRebound = new Set<string>();

  const sourceTokens = new Map<string, Set<string>>();
  for (const [tok, sources] of ctx.tokenSources) {
    for (const src of sources) {
      addTo(sourceTokens, src, tok);
    }
  }
  for (const src of [...sourceTokens.keys()].sort(compareSourceIds)) {
    const tokens = sourceTokens.get(src)!;
    const clusters = clusterTokens(tokens, ctx.blendPairs);
    if (clusters.length < 2) continue;
    const contested = `${src}:${clusters.map(clusterRepresentative).sort().join('/')}`;
    const ref = selectReference(ctx, tokens, new Set([src]), indices);
    if (ref === null) {
      verdict('source_letters', 'skipped_no_reference', contested, null, null, [], null);
      continue;
    }
    const cands = clusters.map((cluster): BindingCandidate => {
      const { err, sep } = clusterError(ctx, ref, cluster, src, indices);
      return { label: clusterRepresentative(cluster), tokens: cluster, sourceId: src, errArcsec: err, predictedSepArcsec: sep };
    });
    const winner = decide(cands);
    const isBlend = ctx.blendSources.has(src);
    const decisive = winner !== null
      && (!isBlend || (Number.isFinite(winner.errArcsec) && winner.errArcsec <= ARBITRATION_BLEND_FLOOR_ARCSEC));
    if (decisive) {
      const targets = cands.filter((c) => c !== winner).flatMap((c) => c.tokens.map((token) => ({ token, sourceId: src })));
      verdict('source_letters', 'geometric', contested, ref, winner, cands, { kind: 'unbind', targets });
    } else if (isBlend) {
      const refutation = refutePhotocentreBlend(ctx, cands, src, indices, xids);
      if (refutation !== null) {
        identityRebound.add(refutation.loserToken);
        verdict(
          'source_letters', 'identity_refuted', contested, ref, refutation.owner, cands,
          { kind: 'rebind', letter: refutation.loserToken, sourceId: refutation.loserSource },
        );
      } else {
        for (const c of cands) for (const t of c.tokens) blendLetters.add(t);
        verdict('source_letters', 'skipped_photocentre_blend', contested, ref, winner, cands, null);
      }
    } else {
      const targets = cands.flatMap((c) => c.tokens.map((token) => ({ token, sourceId: src })));
      verdict('source_letters', 'unbound_ambiguous', contested, ref, null, cands, { kind: 'unbind', targets });
    }
  }

  for (const tok of [...ctx.tokenSources.keys()].sort()) {
    const sources = [...ctx.tokenSources.get(tok)!].sort(compareSourceIds);
    if (sources.length < 2) continue;
    const contested = `${tok}:${sources.join('/')}`;
    if (identityRebound.has(tok)) continue;
    if (blendLetters.has(tok)) {
      verdict('letter_sources', 'skipped_photocentre_blend', contested, null, null, [], null);
      continue;
    }
    const ref = selectReference(ctx, new Set([tok]), new Set(), indices);
    if (ref === null) {
      verdict('letter_sources', 'skipped_no_reference', contested, null, null, [], null);
      continue;
    }
    const cands = sources.map((s): BindingCandidate => {
      const { err, sep } = clusterError(ctx, ref, [tok], s, indices);
      return { label: s, tokens: [tok], sourceId: s, errArcsec: err, predictedSepArcsec: sep };
    });
    const winner = decide(cands);
    if (winner !== null) {
      verdict('letter_sources', 'geometric', contested, ref, winner, cands, { kind: 'rebind', letter: tok, sourceId: winner.sourceId });
    } else {
      verdict('letter_sources', 'unbound_ambiguous', contested, ref, null, cands, {
        kind: 'unbind', targets: sources.map((sourceId) => ({ token: tok, sourceId })),
      });
    }
  }
  return verdicts;
}

/** Every contradiction the cascade and propagation left, per system in
 *  wds_id order, arbitrated against WDS (ρ, θ) geometry. */
/** The pairs audited, their per-system contexts, and the verdicts: what enforcement acts on. */
export interface BindingAudit {
  readonly pairs: readonly DecomposedPair[];
  readonly systems: ReadonlyMap<string, SystemContext>;
  readonly verdicts: readonly BindingVerdict[];
}

export function auditBindingIntegrity(
  pairs: readonly DecomposedPair[], indices: IdentifierIndices, xids: ReadonlyMap<ComponentKey, SimbadWdsXid>,
): BindingAudit {
  const systems = buildSystemContexts(pairs);
  const verdicts = [...systems.keys()].sort().flatMap((wdsId) => auditSystem(systems.get(wdsId)!, indices, xids));
  return { pairs, systems, verdicts };
}

/** Every HIP the winning cluster carries, read as enforcement has left them,
 *  plus the winner source's cross-walk HIP. */
const instance = (pairs: readonly DraftPair[], i: Instance): Draft => pairs[i.pairIdx][i.side];

function winnerHips(v: BindingVerdict, ctx: SystemContext, out: readonly DraftPair[], indices: IdentifierIndices): Set<number> {
  const hips = new Set<number>();
  if (v.winner === null) return hips;
  const srcHip = indices.srcToHip.get(v.winner.sourceId);
  if (srcHip !== undefined) hips.add(srcHip);
  for (const tok of v.winner.tokens) {
    for (const i of ctx.instances.get(tok) ?? []) {
      const hip = instance(out, i).hip;
      if (hip !== null) hips.add(hip);
    }
  }
  return hips;
}

/** gaia always clears; a HIP clears only when it cross-walks to the contested
 *  source or the winner carries it too, else the loser would resolve straight back. */
function unbindComponent(c: Draft, winner: ReadonlySet<number>, indices: IdentifierIndices): void {
  if (c.hip !== null && (indices.hipToGaia.get(c.hip) === c.gaiaSourceId || winner.has(c.hip))) c.hip = null;
  c.gaiaSourceId = null;
  c.resolveVia = 'unresolved';
}

export function enforceBindingVerdicts(
  { pairs, systems, verdicts }: BindingAudit, indices: IdentifierIndices,
): readonly DecomposedPair[] {
  const out = working(pairs).pairs;
  const enforced = new Set<string>();
  for (const v of verdicts) {
    const ctx = systems.get(v.wdsId)!;
    const { action } = v;
    if (action === null) continue;
    enforced.add(v.wdsId);
    if (action.kind === 'rebind') {
      for (const i of ctx.instances.get(action.letter) ?? []) instance(out, i).gaiaSourceId = action.sourceId;
      continue;
    }
    const winner = winnerHips(v, ctx, out, indices);
    for (const { token, sourceId } of action.targets) {
      for (const i of ctx.instances.get(token) ?? []) {
        const c = instance(out, i);
        if (c.gaiaSourceId === sourceId) unbindComponent(c, winner, indices);
      }
    }
  }
  if (enforced.size === 0) return out;
  return smearIfSeeded(inheritDownwardParentBindings(propagateIdentities(out), enforced));
}

const SHAPE_COUNT_KEY = {
  source_letters: 'binding_conflicts_source_letters',
  letter_sources: 'binding_conflicts_letter_sources',
} as const satisfies Record<BindingShape, string>;

const VERDICT_COUNT_KEY = {
  geometric: 'arbitrated_geometric',
  identity_refuted: 'arbitrated_identity_refuted',
  unbound_ambiguous: 'arbitrated_unbound_ambiguous',
  skipped_no_reference: 'arbitration_skipped_no_reference',
  skipped_photocentre_blend: 'arbitration_skipped_photocentre_blend',
} as const satisfies Record<BindingVerdictKind, string>;

export type BindingIntegrityCountKey =
  (typeof SHAPE_COUNT_KEY)[BindingShape] | (typeof VERDICT_COUNT_KEY)[BindingVerdictKind];

/** The snapshot's order: the two shape totals, then the outcomes. */
export const BINDING_INTEGRITY_COUNT_KEYS: readonly BindingIntegrityCountKey[] = [
  ...BINDING_SHAPES.map((s) => SHAPE_COUNT_KEY[s]),
  ...BINDING_VERDICTS.map((k) => VERDICT_COUNT_KEY[k]),
];

function rekey<K extends string, V extends string>(table: Readonly<Record<K, V>>, tally: Record<K, number>): Record<V, number> {
  const out = {} as Record<V, number>;
  for (const k of Object.keys(tally) as K[]) out[table[k]] = tally[k];
  return out;
}

export function bindingIntegrityCounts(verdicts: readonly BindingVerdict[]): Record<BindingIntegrityCountKey, number> {
  return {
    ...rekey(SHAPE_COUNT_KEY, fold(BINDING_SHAPES, verdicts, (v) => v.shape)),
    ...rekey(VERDICT_COUNT_KEY, fold(BINDING_VERDICTS, verdicts, (v) => v.verdict)),
  };
}

/** Every source the audit weighed, kept or unbound. */
export function bindingAuditSourceIds(verdicts: readonly BindingVerdict[]): Set<string> {
  return new Set(verdicts.flatMap((v) => v.candidates.map((c) => c.sourceId)));
}
