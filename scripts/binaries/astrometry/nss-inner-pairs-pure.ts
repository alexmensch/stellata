// Stage 3's Gaia NSS inner pairs: an orbit interior to one component, re-homed on a synthesized sub-pair. ../load/README.md#sub-pair-synthesis

import { childComponentTokens } from '../component-tokens-pure';
import type { NssOrbitRow } from '../load/gaia-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import { subResolutionPair } from '../load/subdivide-pure';
import { nssInRegime, nssToCanonicalElements } from '../orbits/nss-elements-pure';
import { componentsOf, inheritAs, type DecomposedPair, type GaiaBinding, type ResolvedComponent } from '../resolve/components-pure';
import { inheritedFrom } from '../multiples-record-pure';
import { GAIA_NSS } from '../../catalog/sources/gaia-nss-source';
import { sourceRowRef } from '../../util/sources/row-ref-pure';
import { compareSourceIds } from '../../util/tsv/table-pure';
import { splitComponents } from '../../wds/wds-pure';
import type { ComponentAstrometry, PairAstrometry } from './routes-pure';
import { compareCodeUnits } from '../../../src/astro-core/order-pure';

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
  readonly gaia: GaiaBinding;
  readonly component: ResolvedComponent;
  readonly astrometry: ComponentAstrometry;
}

function nssCarriers(pairs: readonly DecomposedPair[], astrometry: ReadonlyMap<DecomposedPair, PairAstrometry>, indices: IdentifierIndices): Carrier[] {
  const carriers = new Map<string, Carrier>();
  for (const p of pairs) {
    const a = astrometry.get(p)!;
    for (const [component, ast, partner] of [[p.primary, a.primary, p.secondary], [p.secondary, a.secondary, p.primary]] as const) {
      const { gaia } = component;
      if (gaia === null || !indices.srcToNss.has(gaia.value)) continue;
      if (partner.gaia === null || partner.gaia.value === gaia.value) continue;
      const key = `${component.wdsId}\t${gaia.value}`;
      const cur = carriers.get(key);
      if (cur === undefined || component.component.length > cur.component.component.length) {
        carriers.set(key, { gaia, component, astrometry: ast });
      }
    }
  }
  return [...carriers.values()].sort((x, y) =>
    compareCodeUnits(x.component.wdsId, y.component.wdsId) || compareSourceIds(x.gaia.value, y.gaia.value));
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
  const foundingSystem = new Map<string, string>();
  for (const carrier of nssCarriers(pairs, astrometry, indices)) {
    const { component: c, astrometry: ast } = carrier;
    const measured = ast.astrometryVia === 'unresolved' ? null : ast;
    const existing = tokensBySystem.get(c.wdsId)!;
    const verdict = nssVerdict(carrier, existing, indices.srcToNss.get(carrier.gaia.value)!);
    outcomes.push(verdict.outcome);
    if (verdict.outcome !== 'synthesized') continue;

    const [a, b] = verdict.children;
    const sourceId = carrier.gaia.value;
    const founded = foundingSystem.get(sourceId);
    if (founded !== undefined) {
      throw new Error(
        `Gaia NSS source ${sourceId} founds inner pairs in ${founded} and ${c.wdsId}; `
        + `both would sit under one pairs lineage key (gaia-dr3-nss:${sourceId}). Decide which system the orbit belongs to.`,
      );
    }
    foundingSystem.set(sourceId, c.wdsId);
    const pair = subResolutionPair(
      sourceRowRef(GAIA_NSS, sourceId), c.wdsId, SYNTH_NSS_DISCOVERER, `${a},${b}`, measured === null ? null : { raDeg: measured.raDeg, decDeg: measured.decDeg },
    );
    const fromCarrier = inheritedFrom(c.component, 'parent');
    const child = (component: string, isPrimary: boolean): ResolvedComponent => ({
      wdsId: c.wdsId, discoverer: SYNTH_NSS_DISCOVERER, component, isPrimary,
      gaia: inheritAs(carrier.gaia, fromCarrier),
      hip: c.hip === null ? null : inheritAs(c.hip, fromCarrier),
      athyg: c.athyg === null ? null : inheritAs(c.athyg, fromCarrier), hd: null,
    });
    const inner: DecomposedPair = { pair, tokens: splitComponents(pair.components)!, primary: child(a, true), secondary: child(b, false) };
    out.push(inner);
    outAstrometry.set(inner, { primary: ast, secondary: ast });
    existing.add(a).add(b);
  }
  return { pairs: out, astrometry: outAstrometry, outcomes };
}
