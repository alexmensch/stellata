import { describe, expect, it } from 'vitest';

import { pairsIdentity, pairsLineageLines, type PairDecisions } from '../binaries/pairs-lineage-pure';
import type { OpticalVia } from '../binaries/optical/optical-tiers-pure';
import type { DecomposedPair } from '../binaries/resolve/components-pure';
import { decomposed } from '../binaries/resolve/resolve-fixture';
import { wdsPair } from '../wds/wds-fixture';
import type { IdentityRow } from '../catalog/lineage/identity/identity-pure';
import type { LineageLine } from '../catalog/lineage/lineage-row-pure';
import { LINEAGE_STAGES } from '../catalog/lineage/lineage-stages';
import { codeEffects } from '../catalog/lineage/reason-codes/reason-codes-pure';
import { allocate, type Allocation, type SidObject, type Upstream } from './allocate-pure';
import { lineageAdmissions, lineageCauses } from './lineage-upstream-pure';

const EFFECTS = codeEffects(LINEAGE_STAGES.map((s) => s.codes));
const ORDER = LINEAGE_STAGES.map((s) => s.codes.stage);

const SYNTH_SID = 7;
const ANCHOR_SID = 3;
const anchor: SidObject = { designations: ['hip:100'], kind: 'star', label: 'anchor', origin: 'spine:1', admission: { kind: 'lineage' } };

function upstreamOf(stages: readonly { stage: string; lines: readonly LineageLine[]; identity: readonly IdentityRow[] }[]): Upstream {
  return {
    causes: (keys) => lineageCauses(keys, stages.map((s) => ({ stage: s.stage, rows: s.identity })), stages.flatMap((s) => s.lines), EFFECTS, ORDER),
    admissions: (origins) => lineageAdmissions(origins, stages.flatMap((s) => s.lines), () => false),
  };
}

function allocateOver(objects: readonly SidObject[], up: Upstream): Allocation {
  return allocate({
    objects, storedEdges: [], events: [], scope: () => true, date: '2026-11-16', version: '7.1.31',
    ledger: [
      { sid: ANCHOR_SID, canonicalKey: 'hip:100', kind: 'star', firstSeen: '2026-07-01' },
      { sid: SYNTH_SID, canonicalKey: 'synth:00010+0010-B', kind: 'star', firstSeen: '2026-07-01' },
    ],
  }, up);
}

describe('a synthetic SID whose pair Stage 5 now rejects', () => {
  const pair = decomposed(wdsPair({ wdsId: '00010+0010', discoverer: 'STF  10', components: 'AB' }), {
    primary: { gaiaSourceId: null, hip: 100 }, secondary: { gaiaSourceId: null, hip: null },
  });
  const pairsStage = (via: OpticalVia, rows: PairDecisions['multiples']['rows']) => {
    const decisions: PairDecisions = {
      reference: { wdsDedup: [], blankRescue: [] },
      optical: { optical: new Map<DecomposedPair, OpticalVia>([[pair, via]]) },
      multiples: { droppedNoPosition: [], rows },
    };
    return { stage: 'pairs', lines: pairsLineageLines(decisions), identity: pairsIdentity(decisions) };
  };

  it('retires under the rejection\'s code once no multiples.tsv row carries the component', () => {
    const a = allocateOver([anchor], upstreamOf([pairsStage('sep_limit_rejected', [])]));
    if (a.kind === 'failed') throw new Error(a.errors.join('\n'));
    expect(a.removals.map((r) => [r.kind, r.sid, r.decision.code, r.decision.origin])).toEqual([
      ['retired', SYNTH_SID, 'pairs.rejected.sep-limit', 'wds:00010+0010/STF  10/AB'],
    ]);
    expect(a.events.map((e) => [e.sid, e.event, e.code])).toEqual([[SYNTH_SID, 'retire', 'pairs.rejected.sep-limit']]);
  });

  it('still fails closed while the pair is kept, since nothing then decides the departure', () => {
    const a = allocateOver([anchor], upstreamOf([pairsStage('gaia_kept', [])]));
    expect(a.kind === 'failed' && a.unexplained).toEqual(['synth:00010+0010-B']);
  });
});
