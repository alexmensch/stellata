import { describe, expect, it } from 'vitest';
import { makeStar } from '../../parse/star-fixture';
import type { MultiplesTsvRow } from '../companion-promotion';
import { multiplesRow } from '../multiples-fixture';
import { emptyParkedRefusals, parkedRefusals, type ParkedRefusals } from './parked-refusals';
import { MintedIds, resolveRowIdentity, type RowIdentity } from './row-identity';
import { SystemIndex } from './system-index';

const ANCHOR_ROW = multiplesRow({ systemId: '06451-1643-AB', comp: 'A', orbitRole: 'primary', hip: 32349, gaiaSourceId: '100' });
const anchorStar = makeStar({ hip: 32349, gaiaSourceId: '100', bayerComponent: null, originKey: 'spine:anchor' });
const held = makeStar({ gaiaSourceId: '300', hip: 500, originKey: 'spine:held' });

function resolve(
  row: MultiplesTsvRow,
  opts: { minted?: MintedIds; parked?: ParkedRefusals; bridges?: Map<string, string>; anchor?: typeof anchorStar } = {},
): RowIdentity {
  const stars = [opts.anchor ?? anchorStar, held];
  return resolveRowIdentity(row, { primaryRow: ANCHOR_ROW, star: stars[0], catalogIdx: 0 }, row.comp, `synth-06451-1643-${row.comp}`, {
    index: new SystemIndex([], stars),
    minted: opts.minted ?? new MintedIds(),
    parked: opts.parked ?? emptyParkedRefusals(),
    synthGaiaBridges: opts.bridges ?? new Map(),
  });
}

describe('resolveRowIdentity', () => {
  it('strips ids shared with the anchor, leaving a synthetic new record', () => {
    expect(resolve(multiplesRow({ systemId: '06451-1643-AB', hip: 32349, gaiaSourceId: '100' }))).toEqual({
      kind: 'new', gaia: null, hip: null, synthetic: true, idsInheritedFromAnchor: true,
    });
  });

  it('holds a record its own id names, and one its own HIP names when its Gaia source missed', () => {
    expect(resolve(multiplesRow({ gaiaSourceId: '300' }))).toEqual({ kind: 'held', idx: 1, via: 'own-id' });
    expect(resolve(multiplesRow({ gaiaSourceId: '999', hip: 500 }))).toEqual({ kind: 'held', idx: 1, via: 'own-hip' });
  });

  it('refuses a pair whose two ends are one record the authority letters as this component', () => {
    const lettered = makeStar({ hip: 32349, gaiaSourceId: '100', bayerComponent: 'B' });
    expect(resolve(multiplesRow({ hip: 32349 }), { anchor: lettered })).toEqual({
      kind: 'decided', outcome: { kind: 'dropped', reason: 'anchor-is-component', idx: 0 },
    });
  });

  it('adopts an earlier mint on a surviving id, or on the synthetic key', () => {
    const minted = new MintedIds();
    minted.register(7, { gaia: '400', hip: null, synth: null });
    minted.register(8, { gaia: null, hip: null, synth: 'synth-06451-1643-C' });
    expect(resolve(multiplesRow({ gaiaSourceId: '400' }), { minted })).toEqual({
      kind: 'decided', outcome: { kind: 'adopted', idx: 7, via: 'earlier-mint' },
    });
    expect(resolve(multiplesRow({ comp: 'C' }), { minted })).toEqual({
      kind: 'decided', outcome: { kind: 'adopted', idx: 8, via: 'earlier-mint' },
    });
  });

  it('refuses a row stating a refused parallax before the gates strip the id that finds it', () => {
    const parked = parkedRefusals([{
      gaiaSourceId: '100', hip: null, reason: 'refused_no_defensible_parallax', refusedPlxMas: [10], originKey: 'spine:parked',
    }]);
    const outcome = resolve(multiplesRow({ gaiaSourceId: '100', distPc: 100 }), { parked });
    expect(outcome).toMatchObject({ kind: 'decided', outcome: { kind: 'dropped', reason: 'parked-record', parked: 'spine:parked' } });
  });

  it('holds the record a same-as bridge names for an id-less row', () => {
    const bridges = new Map([['synth-06451-1643-B', '300']]);
    expect(resolve(multiplesRow(), { bridges })).toEqual({ kind: 'held', idx: 1, via: 'sameas-bridge' });
  });
});

describe('MintedIds.lookup', () => {
  it('tries the Gaia source before the HIP', () => {
    const minted = new MintedIds();
    minted.register(3, { gaia: '1', hip: null, synth: null });
    minted.register(4, { gaia: null, hip: 9, synth: null });
    expect(minted.lookup(multiplesRow({ gaiaSourceId: '1', hip: 9 }))).toBe(3);
    expect(minted.lookup(multiplesRow({ gaiaSourceId: '2', hip: 9 }))).toBe(4);
    expect(minted.lookup(multiplesRow())).toBeNull();
  });
});
