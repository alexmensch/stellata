// Stage 2: every decomposing WDS pair's two components bound to Gaia DR3 / HIP, audited, as DecomposedPairs. See README.md.

import type { ComponentKey } from '../component-tokens-pure';
import { pairRowKey } from '../component-tokens-pure';
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
import { decompose, freezePairs, type DecomposedPair, type ResolvedComponent } from './components-pure';
import { propagateIdentities, seedSynthesizedComponentBindings } from './propagate-pure';

export interface CascadeInputs {
  readonly pairs: readonly WdsPair[];
  readonly orb6: readonly Orb6Entry[];
  readonly indices: IdentifierIndices;
  readonly athyg: readonly AthygRow[];
  readonly simbadWdsXids: ReadonlyMap<ComponentKey, SimbadWdsXid>;
}

export function resolveCascade(
  inputs: CascadeInputs,
): { pairs: readonly DecomposedPair[]; siblingRejections: readonly SiblingRejection[] } {
  const orb6ByPair = groupOrb6ByPair(inputs.orb6);
  const first = decompose(inputs.pairs, (pair, token, isPrimary) => resolveComponent(
    pair, token, isPrimary, orb6ByPair.get(pairRowKey(pair.wdsId, pair.components)) ?? [], inputs.indices,
  ));
  const simbad = resolveViaSimbad(first, inputs.simbadWdsXids);
  const ccdm = resolveViaCcdm(simbad, inputs.indices);
  const position = resolveViaPosition(ccdm.pairs, inputs.athyg);
  return {
    pairs: propagateIdentities(position.pairs),
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

export function resolveStage2(reference: ReferenceCatalogs): Stage2Result {
  const cascade = resolveCascade(reference);
  const seeds = seedSynthesizedComponentBindings(
    cascade.pairs, [...reference.synthesizedOrb6Pairs, ...reference.synthesizedMscPairs],
  );
  const audit = auditBindingIntegrity(seeds.pairs, reference.indices, reference.simbadWdsXids);
  return Object.freeze({
    pairs: freezePairs(enforceBindingVerdicts(audit, reference.indices)),
    siblingRejections: Object.freeze([...cascade.siblingRejections]),
    synthesizedSeeds: Object.freeze([...seeds.seeded]),
    verdicts: Object.freeze([...audit.verdicts]),
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
