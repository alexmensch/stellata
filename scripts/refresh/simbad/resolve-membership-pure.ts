// Phase A of a manifest-keyed SIMBAD pull: the manifest's keys to oids, the widening ladder, and the corroboration rule. See README.md.

import type { Ask } from '../pull/pull';
import { fetchReleaseIds, resolveOids, type ParseLedger, type SimbadPhases } from './simbad-fetch-pure';
import type { MembershipKeys } from './membership-keys-pure';
import { percent, share } from './simbad-rows-pure';
import { GAIA_DR3, WIDENING_LADDER, type Namespace } from './simbad-specs-pure';

export interface Verdicts {
  corroborated: number;
  vetoed: number;
  uncorroborated: number;
}

/** What each pass asked and bound. `bindings` is keyed on the namespace, not the pass, so a widening rung folds into its namespace: read-back does not care which rung bound a row. */
export interface OidRequest {
  readonly oids: Set<number>;
  readonly requested: Map<string, number>;
  readonly resolved: Map<string, number>;
  readonly bindings: Map<string, Map<string, number>>;
  readonly gainedByWidening: Map<string, number>;
  readonly verdicts: Map<string, Verdicts>;
}

export const wideningLabel = (ns: Namespace): string => `${ns.name}_widening`;

function emptyRequest(): OidRequest {
  return { oids: new Set(), requested: new Map(), resolved: new Map(), bindings: new Map(), gainedByWidening: new Map(), verdicts: new Map() };
}

function add(request: OidRequest, label: string, requested: number, resolved: ReadonlyMap<string, number>, namespace = label): void {
  request.requested.set(label, requested);
  request.resolved.set(label, resolved.size);
  for (const oid of resolved.values()) request.oids.add(oid);
  let bound = request.bindings.get(namespace);
  if (bound === undefined) request.bindings.set(namespace, bound = new Map());
  for (const [key, oid] of resolved) bound.set(key, oid);
}

export const coverage = (request: OidRequest, label: string): number => share(request.resolved.get(label) ?? 0, request.requested.get(label) ?? 0);

export const verdictLine = (v: Verdicts): string =>
  `${v.corroborated} corroborated by a Gaia cross-ID, ${v.vetoed} vetoed on a contradicting DR3 id, ${v.uncorroborated} kept with no DR3 id to contradict them`;

export function requestReport(request: OidRequest): string[] {
  return [...request.requested].flatMap(([label, asked]) => {
    const got = request.resolved.get(label) ?? 0;
    const verdict = request.verdicts.get(label);
    return [
      `  ${label.padEnd(14)} requested ${String(asked).padStart(7)} → resolved ${String(got).padStart(7)} (${percent(share(got, asked))})`,
      ...(verdict ? [`  ${''.padEnd(14)} of the widened: ${verdictLine(verdict)}`] : []),
    ];
  });
}

/**
 * Adjudicates designation-only bindings against SIMBAD's Gaia ids across every release: the asking id held under any
 * release corroborates, a differing DR3 id vetoes, anything else stands uncorroborated. An asking id of `null` has
 * nothing to contradict, so it lands uncorroborated. README.md#the-corroboration-rule.
 */
export async function corroborate(
  ask: Ask, phases: SimbadPhases, bound: ReadonlyMap<string, number>, askingIds: ReadonlyMap<string, string | null>, ledger: ParseLedger,
): Promise<{ kept: Map<string, number>; verdicts: Verdicts }> {
  const verdicts: Verdicts = { corroborated: 0, vetoed: 0, uncorroborated: 0 };
  const kept = new Map<string, number>();
  if (bound.size === 0) return { kept, verdicts };
  const gaiaIds = await fetchReleaseIds(ask, phases, [...new Set(bound.values())].sort((a, b) => a - b), ledger);
  for (const [suffix, oid] of bound) {
    const releases = gaiaIds.get(oid) ?? new Map<string, Set<string>>();
    const asking = askingIds.get(suffix) ?? null;
    if (asking !== null && [...releases.values()].some((ids) => ids.has(asking))) verdicts.corroborated++;
    else if (asking !== null && (releases.get(GAIA_DR3.name)?.size ?? 0) > 0) {
      verdicts.vetoed++;
      continue;
    } else verdicts.uncorroborated++;
    kept.set(suffix, oid);
  }
  return { kept, verdicts };
}

/** {designation: source_id} for each still-unbound source_id carrying one under `ns`; a designation two source_ids claim binds neither, so it is dropped. */
function wideningCandidates(keys: MembershipKeys, ns: (typeof WIDENING_LADDER)[number], unbound: readonly string[]): Map<string, string> {
  const claims = new Map<string, string[]>();
  for (const sid of unbound) {
    const suffix = keys.designations.get(sid)?.[ns.name];
    if (suffix === undefined) continue;
    const claimants = claims.get(suffix);
    if (claimants === undefined) claims.set(suffix, [sid]);
    else claimants.push(sid);
  }
  return new Map([...claims].flatMap(([suffix, sids]) => (sids.length === 1 ? [[suffix, sids[0]] as const] : [])));
}

/** Gaia first, then the no-Gaia tier's HIP / TYC / GJ keys, then the widening ladder over every source_id Gaia did not reach, each rung asking only what the rungs above left unbound. */
export async function resolveMembershipKeys(ask: Ask, phases: SimbadPhases, keys: MembershipKeys, ledger: ParseLedger): Promise<OidRequest> {
  const request = emptyRequest();
  const gaia = await resolveOids(ask, phases, GAIA_DR3, keys.sourceIds, ledger);
  add(request, GAIA_DR3.name, keys.sourceIds.length, gaia);
  for (const ns of WIDENING_LADDER) {
    const asked = keys.byNamespace[ns.name];
    add(request, ns.name, asked.length, await resolveOids(ask, phases, ns, asked, ledger));
  }
  let unbound = keys.sourceIds.filter((sid) => !gaia.has(sid));
  for (const ns of WIDENING_LADDER) {
    if (unbound.length === 0) break;
    const candidates = wideningCandidates(keys, ns, unbound);
    if (candidates.size === 0) continue;
    const label = wideningLabel(ns);
    const widened = await resolveOids(ask, phases, ns, [...candidates.keys()], ledger);
    const { kept, verdicts } = await corroborate(ask, phases, widened, candidates, ledger);
    const before = request.oids.size;
    add(request, label, candidates.size, kept, ns.name);
    request.gainedByWidening.set(label, request.oids.size - before);
    request.verdicts.set(label, verdicts);
    const bound = new Set([...kept.keys()].map((suffix) => candidates.get(suffix)));
    unbound = unbound.filter((sid) => !bound.has(sid));
  }
  return request;
}
