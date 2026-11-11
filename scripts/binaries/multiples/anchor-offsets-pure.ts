// Each component's WDS offset from its system's anchor letter, composed over the system's pair geometry. See ../README.md#stage-6--multiplestsv-emit.

import { RAD_TO_DEG } from '../../../src/astro-core/astronomy-constants';
import {
  canonicalCompLetter, componentKey, isComponentToken, isMoreCanonicalAnchor, parentComponentToken, tokenLetters,
  type ComponentKey,
} from '../component-tokens-pure';
import type { MscLookup } from '../load/msc-pure';
import { OPTICAL_VIA_PROPERTIES, type OpticalVia } from '../optical/optical-tiers-pure';
import { pyMod, pySum } from '../python-float-pure';
import { addEdge, addNewestEdge, pairVector, type Edge } from '../resolve/binding-audit-pure';
import type { DecomposedPair } from '../resolve/components-pure';
import type { TangentOffset } from '../sky-geometry-pure';
import type { WdsPair } from '../../wds/wds-pure';
import { pairMagnitudes, wdsDmag } from './pair-photometry-pure';

type GeomAdj = Map<string, Map<string, Edge>>;

/** One sibling row under a parent letter: the offset, and the Δm when the row measured one. */
export interface SiblingEdge {
  readonly eastArcsec: number;
  readonly northArcsec: number;
  readonly dmag: number | null;
  readonly epoch: number | null;
}

export type SiblingAdj = Map<string, Map<string, SiblingEdge>>;

export function addSiblingEdge(adj: SiblingAdj, a: string, b: string, edge: SiblingEdge): void {
  const reverse: SiblingEdge = {
    eastArcsec: -edge.eastArcsec, northArcsec: -edge.northArcsec, dmag: edge.dmag === null ? null : -edge.dmag, epoch: edge.epoch,
  };
  addNewestEdge(adj, a, b, edge, reverse, edge.epoch, (e) => e.epoch);
}

/** The most canonical token: the order the anchor and the photocentre's reference share. */
function mostCanonical(tokens: Iterable<string>): string {
  let best: string | null = null;
  for (const t of tokens) if (best === null || isMoreCanonicalAnchor(t, best)) best = t;
  if (best === null) throw new Error('mostCanonical: no tokens');
  return best;
}

/** A compound's letters (`BC` → B, C), or the token itself. */
function proxyEndpoints(tok: string): string[] {
  const letters = tokenLetters(tok);
  return letters.size >= 2 ? [...letters].sort() : [tok];
}

/** `base`'s edges with `overlay`'s, `overlay` winning a collision. */
function mergedAdj(base: GeomAdj, overlay: GeomAdj): GeomAdj {
  const out: GeomAdj = new Map([...base].map(([tok, nbrs]) => [tok, new Map(nbrs)]));
  for (const [tok, nbrs] of overlay) {
    let into = out.get(tok);
    if (!into) out.set(tok, (into = new Map()));
    for (const [nbr, edge] of nbrs) into.set(nbr, edge);
  }
  return out;
}

/** The composed (E, N) offset of every token reachable from `start`, over shortest-hop chains. */
function bfsAllOffsets(adj: GeomAdj, start: string): Map<string, TangentOffset> {
  const out = new Map<string, TangentOffset>([[start, { eastArcsec: 0, northArcsec: 0 }]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const tok = queue[head];
    const at = out.get(tok)!;
    for (const [nbr, edge] of adj.get(tok) ?? []) {
      if (out.has(nbr)) continue;
      out.set(nbr, { eastArcsec: at.eastArcsec + edge.eastArcsec, northArcsec: at.northArcsec + edge.northArcsec });
      queue.push(nbr);
    }
  }
  return out;
}

/** Breadth-first from `start`, neighbours in token order, so the walk never depends on insertion order. */
function walk<V>(adj: SiblingAdj, start: string, origin: V, step: (at: V, edge: SiblingEdge) => V): Map<string, V> {
  const out = new Map<string, V>([[start, origin]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const tok = queue[head];
    const nbrs = [...(adj.get(tok) ?? [])].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [nbr, edge] of nbrs) {
      if (out.has(nbr)) continue;
      out.set(nbr, step(out.get(tok)!, edge));
      queue.push(nbr);
    }
  }
  return out;
}

/** Each sibling's (E, N) offset to the parent letter's photocentre: ../README.md#stage-6--multiplestsv-emit */
export function photocentreOffsets(adj: SiblingAdj): Map<string, TangentOffset> {
  const ref = mostCanonical(adj.keys());
  const pos = walk(adj, ref, { eastArcsec: 0, northArcsec: 0 }, (p, e) => ({
    eastArcsec: p.eastArcsec + e.eastArcsec, northArcsec: p.northArcsec + e.northArcsec,
  }));
  const measured: SiblingAdj = new Map(
    [...adj].map(([t, nbrs]) => [t, new Map([...nbrs].filter(([, e]) => e.dmag !== null))]),
  );
  const weights = walk(measured, ref, 1.0, (f, e) => f * 10.0 ** (-0.4 * e.dmag!));
  const total = pySum(weights.values());
  const pcE = pySum([...weights].map(([t, w]) => w * pos.get(t)!.eastArcsec)) / total;
  const pcN = pySum([...weights].map(([t, w]) => w * pos.get(t)!.northArcsec)) / total;
  return new Map([...pos].map(([t, p]) => [t, { eastArcsec: pcE - p.eastArcsec, northArcsec: pcN - p.northArcsec }]));
}

/** A sibling row's edge; null for a row that measured a separation without
 *  an angle, or overflowed WDS's field. An unmeasured separation is zero. */
function siblingEdge(pair: WdsPair, pTok: string, sTok: string, msc: MscLookup): SiblingEdge | null {
  let v = pairVector(pair);
  if (v === null) {
    const measuredWider = pair.rhoLast !== null && pair.rhoLast > 0;
    const overflowed = pair.rhoLast === null && pair.thetaLast !== null;
    if (measuredWider || overflowed) return null;
    v = { eastArcsec: 0, northArcsec: 0 };
  }
  const mags = pairMagnitudes(pair, pTok, sTok, msc);
  return { ...v, dmag: wdsDmag(mags.magPri, mags.magSec), epoch: pair.dateLast };
}

export interface AnchorOffset {
  readonly sepArcsec: number;
  readonly paDeg: number;
}

export interface AnchorOffsets {
  /** The letter each system's offsets chain from: its most canonical kept primary. */
  readonly anchorBySystem: ReadonlyMap<string, string>;
  /** Every reached component's offset from its system's anchor. */
  readonly offsets: ReadonlyMap<ComponentKey, AnchorOffset>;
}

function getOrSet<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let v = map.get(key);
  if (v === undefined) map.set(key, (v = make()));
  return v;
}

/** ../README.md#stage-6--multiplestsv-emit */
export function computeAnchorOffsets(
  pairs: readonly DecomposedPair[], optical: ReadonlyMap<DecomposedPair, OpticalVia>, msc: MscLookup,
): AnchorOffsets {
  const kept = new Map<string, GeomAdj>();
  const rejected = new Map<string, GeomAdj>();
  const proxy = new Map<string, GeomAdj>();
  const siblings = new Map<ComponentKey, SiblingAdj>();
  const keptPrimaryTokens = new Map<string, Set<string>>();
  for (const p of pairs) {
    const { wdsId } = p.pair;
    const isKept = OPTICAL_VIA_PROPERTIES[optical.get(p)!].physical;
    const pTok = p.primary.component;
    const sTok = canonicalCompLetter(pTok, p.secondary.component);
    if (isKept) getOrSet(keptPrimaryTokens, wdsId, () => new Set()).add(pTok);
    const parent = parentComponentToken(pTok);
    if (parent !== null && parent === parentComponentToken(sTok) && isComponentToken(pTok) && isComponentToken(sTok)) {
      const edge = siblingEdge(p.pair, pTok, sTok, msc);
      if (edge !== null) addSiblingEdge(getOrSet(siblings, componentKey(wdsId, parent), () => new Map()), pTok, sTok, edge);
    }
    const v = pairVector(p.pair);
    if (v === null) continue;
    const epoch = p.pair.dateLast;
    addEdge(getOrSet(isKept ? kept : rejected, wdsId, () => new Map()), pTok, sTok, v, epoch);
    const pEnds = proxyEndpoints(pTok);
    const sEnds = proxyEndpoints(sTok);
    if (pEnds.length > 1 || sEnds.length > 1) {
      const proxyAdj = getOrSet(proxy, wdsId, () => new Map());
      for (const a of pEnds) for (const b of sEnds) addEdge(proxyAdj, a, b, v, epoch);
    }
  }

  const anchorBySystem = new Map<string, string>();
  const out = new Map<ComponentKey, AnchorOffset>();
  for (const [wdsId, primaryTokens] of keptPrimaryTokens) {
    const anchor = mostCanonical(primaryTokens);
    anchorBySystem.set(wdsId, anchor);
    const links: GeomAdj = new Map();
    let tok = anchor;
    let parent = isComponentToken(anchor) ? parentComponentToken(anchor) : null;
    while (parent !== null) {
      const adj = siblings.get(componentKey(wdsId, parent));
      const link = (adj && photocentreOffsets(adj).get(tok)) ?? { eastArcsec: 0, northArcsec: 0 };
      addEdge(links, tok, parent, link, null);
      tok = parent;
      parent = parentComponentToken(parent);
    }
    const g0 = mergedAdj(links, kept.get(wdsId) ?? new Map());
    const g1 = mergedAdj(rejected.get(wdsId) ?? new Map(), g0);
    const g2 = mergedAdj(proxy.get(wdsId) ?? new Map(), g1);
    const offsets = new Map<string, TangentOffset>();
    const reachedAtZero = new Set<string>();
    const accumulate = (candidates: Iterable<[string, TangentOffset]>): void => {
      for (const [t, o] of candidates) {
        if (t === anchor || offsets.has(t)) continue;
        if (Math.hypot(o.eastArcsec, o.northArcsec) <= 0) reachedAtZero.add(t);
        else offsets.set(t, o);
      }
    };
    for (const graph of [g0, g1]) accumulate(graph.get(anchor) ?? []);
    for (const graph of [g0, g1, g2]) accumulate(bfsAllOffsets(graph, anchor));
    for (const t of reachedAtZero) if (!offsets.has(t)) offsets.set(t, { eastArcsec: 0, northArcsec: 0 });
    for (const [t, { eastArcsec: e, northArcsec: n }] of offsets) {
      out.set(componentKey(wdsId, t), { sepArcsec: Math.hypot(e, n), paDeg: pyMod(Math.atan2(e, n) * RAD_TO_DEG, 360) });
    }
  }
  return { anchorBySystem, offsets: out };
}
