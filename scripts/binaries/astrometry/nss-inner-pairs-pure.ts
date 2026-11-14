// Stage 3's Gaia NSS inner pairs: an orbit interior to one component, re-homed on a synthesized sub-pair. ../load/README.md#sub-pair-synthesis

import { childComponentTokens } from '../component-tokens-pure';
import type { NssOrbitRow } from '../load/gaia-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import { subResolutionPair } from '../load/subdivide-pure';
import { nssInRegime, nssToCanonicalElements } from '../orbits/nss-elements-pure';
import { componentsOf, inheritedFrom, type DecomposedPair, type ResolvedComponent } from '../resolve/components-pure';
import { compareSourceIds } from '../../util/tsv/table-pure';
import { splitComponents } from '../../wds/wds-pure';
import type { ComponentAstrometry, PairAstrometry } from './routes-pure';

/** Never a real WDS discoverer code, which carries a catalogue number. */
export const SYNTH_NSS_DISCOVERER = 'GNSS';

export const NSS_SYNTHESIS_OUTCOMES = [
  'synthesized',
  'skipped_token_shape',
  'skipped_children_exist',
  'skipped_out_of_regime',
  'skipped_incomplete_elements',
] as const;
export type NssSynthesisOutcome = (typeof NSS_SYNTHESIS_OUTCOMES)[number];

interface Carrier {
  readonly sourceId: string;
  readonly component: ResolvedComponent;
  readonly astrometry: ComponentAstrometry;
}

function nssCarriers(pairs: readonly DecomposedPair[], astrometry: ReadonlyMap<DecomposedPair, PairAstrometry>, indices: IdentifierIndices): Carrier[] {
  const carriers = new Map<string, Carrier>();
  for (const p of pairs) {
    const a = astrometry.get(p)!;
    for (const [component, ast, partner] of [[p.primary, a.primary, p.secondary], [p.secondary, a.secondary, p.primary]] as const) {
      const sourceId = component.gaiaSourceId;
      if (sourceId === null || !indices.srcToNss.has(sourceId)) continue;
      if (partner.gaiaSourceId === null || partner.gaiaSourceId === sourceId) continue;
      const key = `${component.wdsId}\t${sourceId}`;
      const cur = carriers.get(key);
      if (cur === undefined || component.component.length > cur.component.component.length) {
        carriers.set(key, { sourceId, component, astrometry: ast });
      }
    }
  }
  return [...carriers.values()].sort((x, y) =>
    x.component.wdsId === y.component.wdsId ? compareSourceIds(x.sourceId, y.sourceId) : x.component.wdsId < y.component.wdsId ? -1 : 1);
}

export interface NssInnerPairs {
  readonly pairs: readonly DecomposedPair[];
  readonly astrometry: ReadonlyMap<DecomposedPair, PairAstrometry>;
  /** One per carrier. */
  readonly outcomes: readonly NssSynthesisOutcome[];
}

type NssVerdict =
  | { readonly outcome: Exclude<NssSynthesisOutcome, 'synthesized'> }
  | { readonly outcome: 'synthesized'; readonly children: readonly [string, string] };

function nssVerdict(carrier: Carrier, existing: ReadonlySet<string>, nss: NssOrbitRow): NssVerdict {
  const children = childComponentTokens(carrier.component.component);
  if (children === null) return { outcome: 'skipped_token_shape' };
  if (existing.has(children[0]) || existing.has(children[1])) return { outcome: 'skipped_children_exist' };
  if (!nssInRegime(nss)) return { outcome: 'skipped_out_of_regime' };
  const ast = carrier.astrometry;
  const e = nssToCanonicalElements(nss, ast.astrometryVia === 'unresolved' ? null : ast.parallaxMas);
  if (e === null || e.pDays === null || e.tJd === null || e.e === null || (e.periastronRad === null && e.e !== 0)) {
    return { outcome: 'skipped_incomplete_elements' };
  }
  return { outcome: 'synthesized', children };
}

/** README.md#the-nss-inner-pairs */
export function synthesizeNssInnerPairs(
  pairs: readonly DecomposedPair[], astrometry: ReadonlyMap<DecomposedPair, PairAstrometry>, indices: IdentifierIndices,
): NssInnerPairs {
  const tokensBySystem = new Map<string, Set<string>>();
  for (const c of componentsOf(pairs)) {
    const s = tokensBySystem.get(c.wdsId);
    if (s === undefined) tokensBySystem.set(c.wdsId, new Set([c.component]));
    else s.add(c.component);
  }

  const out: DecomposedPair[] = [];
  const outAstrometry = new Map<DecomposedPair, PairAstrometry>();
  const outcomes: NssSynthesisOutcome[] = [];
  for (const carrier of nssCarriers(pairs, astrometry, indices)) {
    const { component: c, astrometry: ast } = carrier;
    const measured = ast.astrometryVia === 'unresolved' ? null : ast;
    const existing = tokensBySystem.get(c.wdsId)!;
    const verdict = nssVerdict(carrier, existing, indices.srcToNss.get(carrier.sourceId)!);
    outcomes.push(verdict.outcome);
    if (verdict.outcome !== 'synthesized') continue;

    const [a, b] = verdict.children;
    const pair = subResolutionPair(
      c.wdsId, SYNTH_NSS_DISCOVERER, `${a},${b}`, measured === null ? null : { raDeg: measured.raDeg, decDeg: measured.decDeg },
    );
    const fromCarrier = inheritedFrom(c.component, 'parent');
    const child = (component: string, isPrimary: boolean): ResolvedComponent => ({
      wdsId: c.wdsId, discoverer: SYNTH_NSS_DISCOVERER, component, isPrimary,
      gaiaSourceId: carrier.sourceId, gaiaOrigin: fromCarrier, resolveVia: c.resolveVia,
      hip: c.hip, hipOrigin: c.hip === null ? null : fromCarrier,
      athygRow: c.athygRow, athygOrigin: c.athygRow === null ? null : fromCarrier, hd: null,
    });
    const inner: DecomposedPair = { pair, tokens: splitComponents(pair.components)!, primary: child(a, true), secondary: child(b, false) };
    out.push(inner);
    outAstrometry.set(inner, { primary: ast, secondary: ast });
    existing.add(a).add(b);
  }
  return { pairs: out, astrometry: outAstrometry, outcomes };
}
