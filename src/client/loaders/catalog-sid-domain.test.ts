import { describe, it, expect, vi } from 'vitest';
import { catalogSidDomain, type SidCatalog } from './catalog-sid-domain';
import type { DecodedSpan } from './catalog-loader';
import { LateCell } from '../util/late/late';
import { SidResolver } from '../util/sid-resolver';

function streamingCatalog(sids: number[], decoded: number) {
  const listeners = new Set<(span: DecodedSpan) => void>();
  const complete = new LateCell<never>();
  const catalog: SidCatalog = {
    sid: new Uint32Array(sids),
    get loadedCount() { return decoded; },
    onRecordsDecoded: (l) => { listeners.add(l); return () => listeners.delete(l); },
    complete,
  };
  return {
    catalog,
    listeners,
    land(end: number) {
      const first = decoded;
      decoded = end;
      listeners.forEach((l) => l({ first, end }));
    },
    // The cell's value is never read, only its settle.
    finish: () => complete.land(undefined as never),
    fail: () => complete.conclude(),
  };
}

describe('catalogSidDomain', () => {
  it('claims only decoded records, and grows with each landing chunk', () => {
    const c = streamingCatalog([11, 22, 33, 44], 2);
    const d = catalogSidDomain(c.catalog);
    expect(d.localIndexOf(22)).toBe(1);
    expect(d.localIndexOf(44)).toBeNull();
    expect(d.sidOf(3)).toBeNull();
    c.land(4);
    expect(d.localIndexOf(44)).toBe(3);
    expect(d.sidOf(3)).toBe(44);
  });

  it('is filling until the catalogue completes, and complete if it fails', () => {
    const done = streamingCatalog([11], 1);
    const doneDomain = catalogSidDomain(done.catalog);
    expect(doneDomain.fill()).toBe('filling');
    done.finish();
    expect(doneDomain.fill()).toBe('complete');

    // A failed chunk means no further records land, so a miss is final.
    const failed = streamingCatalog([11], 1);
    const failedDomain = catalogSidDomain(failed.catalog);
    failed.fail();
    expect(failedDomain.fill()).toBe('complete');
  });

  it('announces each chunk and the completion, and stops on unsubscribe', () => {
    const c = streamingCatalog([11, 22, 33], 1);
    const d = catalogSidDomain(c.catalog);
    const grew = vi.fn();
    const off = d.onGrow(grew);
    c.land(2);
    c.land(3);
    c.finish();
    expect(grew).toHaveBeenCalledTimes(3);
    off();
    expect(c.listeners.size).toBe(0);
  });

  it('lets a queued sid in a late chunk resolve, and expires a missing one at completion', () => {
    const c = streamingCatalog([11, 22, 33, 44], 2);
    const r = new SidResolver(['star']);
    r.attach('star', catalogSidDomain(c.catalog));
    const late = vi.fn();
    const missing = vi.fn();
    r.whenResolved(44, late);
    r.whenResolved(99, missing);
    c.land(4);
    expect(late).toHaveBeenCalledWith('star', 3);
    expect(r.resolve(99)).toEqual({ status: 'pending' });
    c.finish();
    expect(r.resolve(99)).toEqual({ status: 'unknown' });
    expect(missing).not.toHaveBeenCalled();
  });
});
