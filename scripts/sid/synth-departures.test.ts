import { describe, expect, it } from 'vitest';

import { pairsIdentity, pairsLineageLines, type PairDecisions } from '../binaries/pairs-lineage-pure';
import type { OpticalVia } from '../binaries/optical/optical-tiers-pure';
import type { DecomposedPair } from '../binaries/resolve/components-pure';
import { decomposed } from '../binaries/resolve/resolve-fixture';
import { wdsPair } from '../wds/wds-fixture';
import { multiplesRow } from '../catalog/companions/multiples-fixture';
import type { PromotedRow, RowOutcome } from '../catalog/companions/promotion-outcome';
import {
  PROMOTION_ADMISSION_CODES, PROMOTION_CODES, promotionLineage,
} from '../catalog/companions/promotion-lineage/promotion-lineage-pure';
import type { IdentityRow } from '../catalog/lineage/identity/identity-pure';
import { stageLineageLine, type LineageLine } from '../catalog/lineage/lineage-row-pure';
import { makeStar } from '../catalog/parse/star-fixture';
import type { Star } from '../catalog/parse/stars-parse';
import { enterPhase } from '../catalog/record/record-phase';
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
    admissions: (origins) => lineageAdmissions(origins, stages.flatMap((s) => s.lines), (code) => PROMOTION_ADMISSION_CODES.has(code)),
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

describe('a synthetic SID whose component now resolves to a record of its own', () => {
  const GAIA = '2595463996992115840';
  const promotionStage = (outcome: RowOutcome, row: PromotedRow['row'], stars: Parameters<typeof enterPhase<'promoted', Star>>[1]) => {
    const promoted: PromotedRow = { row, via: 'secondary', outcome, anchor: 'spine:1', systemAnchor: 'spine:1', synthKey: 'synth-00010+0010-B' };
    const { lineage, identity } = promotionLineage([promoted], enterPhase('promoted', stars), new Set(['hip:100']), new Map());
    return { stage: PROMOTION_CODES.stage, lines: lineage.map((r) => stageLineageLine(PROMOTION_CODES, r)), identity };
  };
  const removalsOf = (a: Allocation) => {
    if (a.kind === 'failed') throw new Error(a.errors.join('\n'));
    return a.removals.map((r) => [r.kind, r.sid, r.decision.code, r.kind === 'merged' ? r.into : null]);
  };

  it('merges into the record promotion mints on the component\'s own Gaia source', () => {
    const origin = 'multiples:00010+0010-AB/B';
    const keyed = makeStar({ originKey: origin, hip: null, gaiaSourceId: GAIA, syntheticId: null });
    const minted: SidObject = { designations: [`gaia_dr3:${GAIA}`], kind: 'star', label: 'B', origin, admission: { kind: 'lineage' } };
    const stage = promotionStage(
      { kind: 'minted', idx: 0, synthetic: false, constellationSplit: false, brightness: { source: 'own', spectMsFromOwnAbsmag: false, ci: 'own', av: 0, adjustment: null } },
      multiplesRow({ systemId: '00010+0010-AB', comp: 'B', gaiaSourceId: GAIA }), [keyed],
    );
    const a = allocateOver([anchor, minted], upstreamOf([stage]));
    const mintedSid = Math.max(ANCHOR_SID, SYNTH_SID) + 1;
    expect(removalsOf(a)).toEqual([['merged', SYNTH_SID, 'promotion.synthetic-key.keyed-mint', mintedSid]]);
  });

  it('merges into the record its row, now a pair\'s primary, resolves to', () => {
    const stage = promotionStage({ kind: 'pair-anchor' }, multiplesRow({ systemId: '00010+0010-BC', comp: 'B', orbitRole: 'primary' }), []);
    const a = allocateOver([anchor], upstreamOf([stage]));
    expect(removalsOf(a)).toEqual([['merged', SYNTH_SID, 'promotion.pair-anchor', ANCHOR_SID]]);
  });
});
