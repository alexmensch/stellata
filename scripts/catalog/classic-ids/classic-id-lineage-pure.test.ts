import { describe, expect, it } from 'vitest';

import { SEEDED_BRANCH, seededCodeCheck } from '../lineage/count-block-fixture';
import { invariantCheck, invariantViolations } from '../lineage/lineage-invariant-pure';
import { foldStageLines, stageLineageLine } from '../lineage/lineage-row-pure';
import { bindingEvidence } from '../membership/binding/binding-gate-pure';
import { NO_PRINTED_V, printedVOf } from '../photometry/photometry-fixture';
import { CLASSIC_ID_CODES, CLASSIC_ID_INVARIANTS, classicIdLineage, rejectedBindingsView, routeDisagreementsView } from './classic-id-lineage-pure';
import { CLASSIC_ID_KEYS } from './classic-id-keys';
import { buildClassicIdOverlay, type OverlayInput } from './classic-id-overlay-pure';
import { cns5Row } from './cns5-fixture';
import { REJECTED_BINDINGS } from './rejected-bindings-tsv';
import { ROUTE_DISAGREEMENTS } from './route-disagreements-tsv';

const BACKGROUND = '5877748442128924544';
const TOLIMAN_HIP = 71681;

/** α Cen B's shape: HD 128621 / HR 5460 / HIP 71681 / α Cen all reach the G = 20.95 background source beside the saturated star. */
function toliman(overrides: Partial<OverlayInput> = {}): OverlayInput {
  return {
    tyc2Hd: [{ tyc: '9007-5849-1', hd: 128621, nHd: 1, nTyc: 1 }],
    crossIndex: [{ hd: 128621, hip: TOLIMAN_HIP, bayer: 'alf', flamsteed: null, cst: 'Cen' }],
    bsc5: [{ hr: 5460, hd: 128621, name: 'Alp2Cen' }],
    cns5: [],
    tycToSource: new Map([['9007-5849-1', BACKGROUND]]),
    hipToSource: new Map([[TOLIMAN_HIP, BACKGROUND]]),
    evidence: bindingEvidence(new Map([[BACKGROUND, 20.95]]), null, printedVOf({ hip: new Map([[TOLIMAN_HIP, 1.33]]) })),
    ...overrides,
  };
}

const lineageOf = (input: OverlayInput) => classicIdLineage(buildClassicIdOverlay(input), CLASSIC_ID_KEYS);
const summary = (input: OverlayInput) => lineageOf(input).map((r) => `${r.key} ${r.role} ${r.code} ${r.params}${
  r.evidence.length > 0 ? ` ${r.evidence.join('|')}` : ''}`).sort();

describe('classicIdLineage', () => {
  it('writes each designation\'s outcome on its own catalogue row, and a refused row per key reaching a gated source', () => {
    const refused = `{"source_id":"${BACKGROUND}","via":"%s","hip":"71681","v_mag":"1.33","v_via":"printed_hip","g_mag":"20.95"}`;
    expect(summary(toliman())).toEqual([
      'gaia-dr3-hip:71681 outcome classic-ids.hip.gated {"hip":"hip:71681"}',
      `gaia-dr3-hip:71681 refused classic-ids.gate-mag ${refused.replace('%s', 'xmatch')}`,
      'iv25:9007-5849-1 outcome classic-ids.hd.gated {"hd":"hd:128621"}',
      `iv25:9007-5849-1 refused classic-ids.gate-mag ${refused.replace('%s', 'tyc')}`,
      'iv27a:128621 outcome classic-ids.bayer.hd-route.gated {"bayer":"alf Cen","hd":"hd:128621","hip":"hip:71681"}',
      `iv27a:128621 outcome classic-ids.route.agree {"hd":"hd:128621","hip":"hip:71681","hd_route_source_ids":"${BACKGROUND}","hip_route_source_id":"${BACKGROUND}"}`,
      `iv27a:128621 refused classic-ids.gate-mag ${refused.replace('%s', 'hd')}`,
      'v50:5460 outcome classic-ids.hr.gated {"hr":"hr:5460","hd":"hd:128621"}',
      `v50:5460 refused classic-ids.gate-mag ${refused.replace('%s', 'hd')}`,
    ].sort());
  });

  it('keys an HD on its first IV/25 row, cites the rest, and lists only the sources the gate kept', () => {
    const kept = '111111111111111111';
    const rows = lineageOf(toliman({
      tyc2Hd: [
        { tyc: '9007-5849-2', hd: 128621, nHd: 1, nTyc: 2 },
        { tyc: '9007-5849-1', hd: 128621, nHd: 1, nTyc: 2 },
      ],
      crossIndex: [],
      bsc5: [],
      tycToSource: new Map([['9007-5849-1', BACKGROUND], ['9007-5849-2', kept]]),
      hipToSource: new Map([[TOLIMAN_HIP, kept]]),
      evidence: bindingEvidence(
        new Map([[BACKGROUND, 20.95], [kept, 1.4]]),
        null,
        printedVOf({ hip: new Map([[TOLIMAN_HIP, 1.33]]), tycho2: { '9007-5849-1': 1.33 } }),
      ),
    }));
    expect(rows.filter((r) => r.key === 'iv25:9007-5849-1').map((r) => [r.code, r.params, r.evidence])).toEqual([
      ['classic-ids.hd.bound', `{"hd":"hd:128621","source_ids":"${kept}"}`, ['iv25:9007-5849-2']],
      ['classic-ids.gate-mag', `{"source_id":"${BACKGROUND}","via":"tyc","v_mag":"1.33","v_via":"tycho2","g_mag":"20.95"}`, []],
    ]);
  });

  it('gives a designation no route reaches a row of its own', () => {
    const codes = lineageOf(toliman({
      tyc2Hd: [{ tyc: '9007-5849-1', hd: 128621, nHd: 1, nTyc: 1 }],
      bsc5: [{ hr: 5460, hd: 128621, name: 'Alp2Cen' }, { hr: 5459, hd: null, name: 'Alp1Cen' }],
      cns5: [cns5Row({ gj: '9848' })],
      tycToSource: new Map(),
      hipToSource: new Map(),
      evidence: bindingEvidence(new Map(), null, NO_PRINTED_V),
    })).map((r) => `${r.key} ${r.code}`).sort();
    expect(codes).toEqual([
      'cns5:1 classic-ids.gj.no-source',
      'iv25:9007-5849-1 classic-ids.hd.no-source',
      'iv27a:128621 classic-ids.bayer.no-source',
      'v50:5459 classic-ids.hr.no-hd',
      'v50:5460 classic-ids.hr.no-source',
    ]);
  });

  it('writes only codes it declares, each in its declared role', () => {
    for (const row of lineageOf(toliman())) expect(() => stageLineageLine(CLASSIC_ID_CODES, row)).not.toThrow();
  });
});

describe('the classic-ids count block', () => {
  const lines = lineageOf(toliman()).map((r) => stageLineageLine(CLASSIC_ID_CODES, r));

  it('folds one count per live code, zeros included', () => {
    const counts = foldStageLines(CLASSIC_ID_CODES, lines);
    expect(Object.keys(counts)).toEqual(CLASSIC_ID_CODES.live);
    expect(counts['classic-ids.gate-mag']).toBe(4);
    expect(counts['classic-ids.route.agree']).toBe(1);
    expect(counts['classic-ids.hd.bound']).toBe(0);
  });

  it('a new code reaches the snapshot as a key, and fails the check until the snapshot is refreshed', () => {
    const { drift, refreshed } = seededCodeCheck(CLASSIC_ID_CODES, lines);
    expect(drift.drifted).toBe(true);
    expect(drift.report).toContain(`classic-ids.${SEEDED_BRANCH}`);
    expect(refreshed.drifted).toBe(false);
  });
});

describe('CLASSIC_ID_INVARIANTS', () => {
  const linesOf = (input: OverlayInput) => lineageOf(input).map((r) => stageLineageLine(CLASSIC_ID_CODES, r));
  const checks = (input: OverlayInput) => invariantViolations(CLASSIC_ID_INVARIANTS, linesOf(input)).map(invariantCheck);

  it('holds while the astrometry pull covers every source a designation reaches', () => {
    expect(checks(toliman()).map((c) => c.kind)).toEqual(['pass']);
  });

  it('fails a source the pull never returned, naming every designation row that reached it', () => {
    const [check] = checks(toliman({
      evidence: bindingEvidence(new Map(), null, printedVOf({ hip: new Map([[TOLIMAN_HIP, 1.33]]) })),
    }));
    expect(check.kind).toBe('fail');
    const message = check.kind === 'fail' ? check.message : '';
    expect(message).toMatch(/^invariant broken by 4 classic-ids\.unweighed-no-pulled-row rows/);
    expect(message).toContain(`iv25:9007-5849-1\tclassic-ids.unweighed-no-pulled-row\t{"source_id":"${BACKGROUND}","via":"tyc"}`);
    expect(message).toContain('gaia-dr3-hip:71681\t');
    expect(message).toContain('iv27a:128621\t');
    expect(message).toContain('v50:5460\t');
  });
});

describe('the gate queues as views of the lineage', () => {
  it('rejected_bindings.tsv names a refused source by every designation reaching it', () => {
    expect(REJECTED_BINDINGS.serialize(rejectedBindingsView(lineageOf(toliman())))).toBe([
      'gaia_source_id\thip\tv_mag\tv_via\tg_mag\treason\tdesignations',
      `${BACKGROUND}\t71681\t1.330\tprinted_hip\t20.950\tmag\tHD 128621 · HR 5460 · alf Cen`,
      '',
    ].join('\n'));
  });

  it('hd_hip_route_disagreements.tsv is the route checks that disagree', () => {
    const other = '9999999999999999';
    const rows = lineageOf(toliman({
      hipToSource: new Map([[TOLIMAN_HIP, other]]),
      evidence: bindingEvidence(new Map(), null, NO_PRINTED_V),
    }));
    expect(ROUTE_DISAGREEMENTS.serialize(routeDisagreementsView(rows))).toBe([
      'hd\thip\thd_route_source_ids\thip_route_source_id',
      `128621\t71681\t${BACKGROUND}\t${other}`,
      '',
    ].join('\n'));
  });
});
