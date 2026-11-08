// Stage 2: every decomposing WDS pair's two components bound to Gaia DR3 / HIP, audited, as DecomposedPairs. See README.md.

import type { ComponentKey } from '../component-tokens-pure';
import { pairRowKey, splitComponents } from '../component-tokens-pure';
import type { AthygRow } from '../load/athyg-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import type { ReferenceCatalogs } from '../load/reference-catalogs';
import type { SimbadWdsXid } from '../load/simbad-pure';
import type { Orb6Entry, WdsPair } from '../load/wds-pure';
import { fold } from '../../util/counts/tally-pure';
import {
  auditBindingIntegrity, bindingAuditSourceIds, bindingIntegrityCounts,
  enforceBindingVerdicts, type BindingVerdict,
} from './binding-audit-pure';
import {
  SIBLING_REJECTION_TIERS, groupOrb6ByPair, resolveComponent, resolveViaCcdm, resolveViaPosition, resolveViaSimbad,
  type SiblingRejection,
} from './cascade-pure';
import { toDecomposedPairs, type DecomposedPair, type ResolvedComponent } from './components-pure';
import { propagateBlendIdentity, propagateWithinSystem, seedSynthesizedComponentBindings } from './propagate-pure';

export interface CascadeInputs {
  readonly pairs: readonly WdsPair[];
  readonly orb6: readonly Orb6Entry[];
  readonly indices: IdentifierIndices;
  readonly athyg: readonly AthygRow[];
  readonly simbadWdsXids: ReadonlyMap<ComponentKey, SimbadWdsXid>;
}

export function resolveCascade(
  inputs: CascadeInputs,
): { components: readonly ResolvedComponent[]; siblingRejections: readonly SiblingRejection[] } {
  const orb6ByPair = groupOrb6ByPair(inputs.orb6);
  const first: ResolvedComponent[] = [];
  for (const pair of inputs.pairs) {
    const split = splitComponents(pair.components);
    if (split === null) continue;
    const orb6ForPair = orb6ByPair.get(pairRowKey(pair.wdsId, pair.components)) ?? [];
    first.push(resolveComponent(pair, split[0], true, orb6ForPair, inputs.indices));
    first.push(resolveComponent(pair, split[1], false, orb6ForPair, inputs.indices));
  }
  const simbad = resolveViaSimbad(first, inputs.simbadWdsXids);
  const ccdm = resolveViaCcdm(simbad, inputs.pairs, inputs.indices);
  const position = resolveViaPosition(ccdm.components, inputs.pairs, inputs.athyg);
  const smeared = propagateWithinSystem(position.components);
  const blend = propagateBlendIdentity(smeared, inputs.pairs);
  return {
    components: blend.seeded.length > 0 ? propagateWithinSystem(blend.components) : blend.components,
    siblingRejections: [...ccdm.rejected, ...position.rejected],
  };
}

export interface Stage2Result {
  readonly pairs: readonly DecomposedPair[];
  /** One per candidate the sibling-identity guard refused, CCDM tier then AT-HYG position tier. */
  readonly siblingRejections: readonly SiblingRejection[];
  /** Synthesized pairs' components the seeding pass bound. */
  readonly synthesizedSeeds: readonly ResolvedComponent[];
  readonly verdicts: readonly BindingVerdict[];
}

/** The cascade, the synthesized-pair seeds, then the binding audit and its enforcement. */
export function resolveStage2(reference: ReferenceCatalogs): Stage2Result {
  const cascade = resolveCascade(reference);
  const seeds = seedSynthesizedComponentBindings(
    cascade.components, [...reference.synthesizedOrb6Pairs, ...reference.synthesizedMscPairs],
  );
  const verdicts = auditBindingIntegrity(reference.pairs, seeds.components, reference.indices, reference.simbadWdsXids);
  const enforced = enforceBindingVerdicts(reference.pairs, seeds.components, verdicts, reference.indices);
  return Object.freeze({
    pairs: toDecomposedPairs(reference.pairs, enforced),
    siblingRejections: Object.freeze([...cascade.siblingRejections]),
    synthesizedSeeds: Object.freeze([...seeds.seeded]),
    verdicts: Object.freeze([...verdicts]),
  });
}

/** Refused and weighed sources stay in: ../README.md#binding-integrity-audit-enforced */
export function astrometryRequestIds(result: Stage2Result, indices: IdentifierIndices): Set<string> {
  const ids = new Set<string>();
  for (const p of result.pairs) {
    for (const c of [p.primary, p.secondary]) if (c.gaiaSourceId !== null) ids.add(c.gaiaSourceId);
  }
  for (const r of [...indices.xwalkMagRejected, ...indices.athygGaiaMagRejected]) ids.add(r.sourceId);
  for (const id of bindingAuditSourceIds(result.verdicts)) ids.add(id);
  return ids;
}

/** The count-snapshot keys Stage 2's code alone produces. */
export function stage2Counts(result: Stage2Result): Record<string, number> {
  return {
    ccdm_sibling_owned_rejected: fold(SIBLING_REJECTION_TIERS, result.siblingRejections, (r) => r.tier).ccdm_sibling_owned,
    ...bindingIntegrityCounts(result.verdicts),
  };
}
