// Stage 3's Gaia NSS inner pairs: an orbit interior to one component, re-homed on a synthesized sub-pair. ../README.md#sub-pair-synthesis-subdividepy

import { childComponentTokens } from '../component-tokens-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import { subResolutionPair } from '../load/subdivide-pure';
import { nssInRegime, nssToCanonicalElements } from '../orbits/nss-elements-pure';
import { componentsOf, type DecomposedPair, type ResolvedComponent } from '../resolve/components-pure';
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
    const children = childComponentTokens(c.component);
    const existing = tokensBySystem.get(c.wdsId)!;
    const nss = indices.srcToNss.get(carrier.sourceId)!;
    const elements = nssToCanonicalElements(nss, measured?.parallaxMas ?? null);
    const outcome: NssSynthesisOutcome =
      children === null ? 'skipped_token_shape'
        : existing.has(children[0]) || existing.has(children[1]) ? 'skipped_children_exist'
          : !nssInRegime(nss) ? 'skipped_out_of_regime'
            : elements === null || elements.pDays === null || elements.tJd === null || elements.e === null
              || (elements.periastronRad === null && elements.e !== 0) ? 'skipped_incomplete_elements'
              : 'synthesized';
    outcomes.push(outcome);
    if (outcome !== 'synthesized') continue;

    const [a, b] = children!;
    const pair = subResolutionPair(
      c.wdsId, SYNTH_NSS_DISCOVERER, `${a},${b}`, measured === null ? null : { raDeg: measured.raDeg, decDeg: measured.decDeg },
    );
    const child = (component: string, isPrimary: boolean): ResolvedComponent => ({
      wdsId: c.wdsId, discoverer: SYNTH_NSS_DISCOVERER, component, isPrimary,
      gaiaSourceId: carrier.sourceId, resolveVia: c.resolveVia, hip: c.hip, athygRow: c.athygRow, hd: null,
    });
    const inner: DecomposedPair = { pair, tokens: splitComponents(pair.components)!, primary: child(a, true), secondary: child(b, false) };
    out.push(inner);
    outAstrometry.set(inner, { primary: ast, secondary: ast });
    existing.add(a).add(b);
  }
  return { pairs: out, astrometry: outAstrometry, outcomes };
}
