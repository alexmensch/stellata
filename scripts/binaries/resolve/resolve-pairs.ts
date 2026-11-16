// Stage 2: every decomposing WDS pair's two components bound to Gaia DR3 / HIP, audited, as DecomposedPairs. See README.md.

import type { ComponentKey } from '../component-tokens-pure';
import { pairRowKey } from '../component-tokens-pure';
import type { AthygRow } from '../load/athyg-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import type { ReferenceCatalogs } from '../load/reference-catalogs';
import type { SimbadWdsXid } from '../load/simbad-pure';
import type { Orb6Entry, WdsPair } from '../../wds/wds-pure';
import { fold } from '../../util/counts/tally-pure';
import {
  auditBindingIntegrity, bindingAuditSourceIds,
  enforceBindingVerdicts, verdictTouches, type BindingVerdict, type VerdictTouch,
} from './binding-audit-pure';
import {
  CASCADE_GATES, groupOrb6ByPair, resolveComponent, resolveViaCcdm, resolveViaPosition, resolveViaSimbad,
  type CascadeGate, type CascadeRefusal,
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
): { pairs: readonly DecomposedPair[]; refusals: readonly CascadeRefusal[] } {
  const orb6ByPair = groupOrb6ByPair(inputs.orb6);
  const offCoord: CascadeRefusal[] = [];
  const first = decompose(inputs.pairs, (pair, token, isPrimary) => {
    const { component, refused } = resolveComponent(
      pair, token, isPrimary, orb6ByPair.get(pairRowKey(pair.wdsId, pair.components)) ?? [], inputs.indices,
    );
    offCoord.push(...refused);
    return component;
  });
  const simbad = resolveViaSimbad(first, inputs.simbadWdsXids);
  const ccdm = resolveViaCcdm(simbad, inputs.indices);
  const position = resolveViaPosition(ccdm.pairs, inputs.athyg);
  return {
    pairs: propagateIdentities(position.pairs),
    refusals: [...offCoord, ...ccdm.rejected, ...position.rejected],
  };
}

export interface Stage2Result {
  readonly pairs: readonly DecomposedPair[];
  /** One per candidate a cascade gate refused, in gate order. */
  readonly refusals: readonly CascadeRefusal[];
  /** Synthesized pairs' components the seeding pass bound. */
  readonly synthesizedSeeds: readonly ResolvedComponent[];
  readonly verdicts: readonly BindingVerdict[];
  readonly touches: readonly VerdictTouch[];
}

export function resolveStage2(reference: ReferenceCatalogs): Stage2Result {
  const cascade = resolveCascade(reference);
  const seeds = seedSynthesizedComponentBindings(
    cascade.pairs, [...reference.synthesizedOrb6Pairs, ...reference.synthesizedMscPairs],
  );
  const audit = auditBindingIntegrity(seeds.pairs, reference.indices, reference.simbadWdsXids);
  return Object.freeze({
    pairs: freezePairs(enforceBindingVerdicts(audit, reference.indices)),
    refusals: Object.freeze([...cascade.refusals]),
    synthesizedSeeds: Object.freeze([...seeds.seeded]),
    verdicts: Object.freeze([...audit.verdicts]),
    touches: Object.freeze(verdictTouches(audit)),
  });
}

/** Refused and weighed sources stay in: README.md#binding-integrity-audit-enforced */
export function astrometryRequestIds(result: Stage2Result, indices: IdentifierIndices): Set<string> {
  const ids = new Set<string>();
  for (const p of result.pairs) {
    for (const c of [p.primary, p.secondary]) if (c.gaia !== null) ids.add(c.gaia.value);
  }
  for (const r of [...indices.xwalkMagRejected, ...indices.athygGaiaMagRejected]) ids.add(r.sourceId);
  for (const id of bindingAuditSourceIds(result.verdicts)) ids.add(id);
  return ids;
}

export function refusalTally(result: Stage2Result): Record<CascadeGate, number> {
  return fold(CASCADE_GATES, result.refusals, (r) => r.gate);
}
