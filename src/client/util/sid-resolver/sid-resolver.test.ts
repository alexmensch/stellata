import { describe, it, expect, vi } from 'vitest';
import { SidResolver, arrayDomain, sidColumnError, type SidRuntimeKind } from './sid-resolver';

const FULL_ROSTER: readonly SidRuntimeKind[] = ['star', 'planet', 'cloud', 'lg'];

describe('SidResolver', () => {
  describe('resolve', () => {
    it('is pending while any rostered domain is neither attached nor concluded', () => {
      const r = new SidResolver(FULL_ROSTER);
      r.attach('star', arrayDomain([10, 20]));
      expect(r.resolve(999)).toEqual({ status: 'pending' });
    });

    it('resolves through an attached domain regardless of unsettled siblings', () => {
      const r = new SidResolver(FULL_ROSTER);
      r.attach('star', arrayDomain([10, 20]));
      expect(r.resolve(20)).toEqual({ status: 'resolved', kind: 'star', localIndex: 1 });
    });

    it('is unknown once every rostered domain settles without claiming', () => {
      const r = new SidResolver(FULL_ROSTER);
      r.attach('star', arrayDomain([10]));
      r.attach('planet', arrayDomain([30]));
      r.conclude('cloud');
      r.conclude('lg');
      expect(r.resolve(999)).toEqual({ status: 'unknown' });
    });

    it('treats sid 0 (NO_SID) and negative sids as unknown immediately', () => {
      const r = new SidResolver(FULL_ROSTER);
      expect(r.resolve(0)).toEqual({ status: 'unknown' });
      expect(r.resolve(-5)).toEqual({ status: 'unknown' });
      expect(r.resolve(1.5)).toEqual({ status: 'unknown' });
    });

    it('consults domains in roster order on a cross-domain collision', () => {
      const r = new SidResolver(['star', 'planet']);
      r.attach('star', arrayDomain([42]));
      r.attach('planet', arrayDomain([42]));
      expect(r.resolve(42)).toEqual({ status: 'resolved', kind: 'star', localIndex: 0 });
    });
  });

  describe('successor following (docs/sid.md § 9.4)', () => {
    it('resolves a retired sid to its successor', () => {
      const r = new SidResolver(['star'], new Map([[99, 10]]));
      r.attach('star', arrayDomain([10, 20]));
      expect(r.resolve(99)).toEqual({ status: 'resolved', kind: 'star', localIndex: 0 });
    });

    it('follows a successor chain to its live end', () => {
      const r = new SidResolver(['star'], new Map([[99, 98], [98, 20]]));
      r.attach('star', arrayDomain([10, 20]));
      expect(r.resolve(99)).toEqual({ status: 'resolved', kind: 'star', localIndex: 1 });
    });

    it('is pending for a successor whose domain has not settled', () => {
      const r = new SidResolver(FULL_ROSTER, new Map([[99, 10]]));
      r.attach('star', arrayDomain([20]));
      expect(r.resolve(99)).toEqual({ status: 'pending' });
    });

    it('is unknown when the successor is claimed by no settled domain', () => {
      const r = new SidResolver(['star'], new Map([[99, 55]]));
      r.attach('star', arrayDomain([10]));
      expect(r.resolve(99)).toEqual({ status: 'unknown' });
    });

    it('treats a corrupt successor cycle as unknown', () => {
      const r = new SidResolver(['star'], new Map([[99, 98], [98, 99]]));
      r.attach('star', arrayDomain([10]));
      expect(r.resolve(99)).toEqual({ status: 'unknown' });
    });

    it('fires a deferred intent through the successor on late attach', () => {
      const r = new SidResolver(FULL_ROSTER, new Map([[99, 7]]));
      r.attach('star', arrayDomain([10]));
      const apply = vi.fn();
      r.whenResolved(99, apply);
      expect(apply).not.toHaveBeenCalled();
      r.attach('lg', arrayDomain([7]));
      expect(apply).toHaveBeenCalledWith('lg', 0);
    });
  });

  describe('shell domain round-trip (docs/sid.md § 8)', () => {
    it('resolves a shell sid to its SHELL_KEYS index and sidOf reverses', () => {
      // Fabricated pins in SHELL_KEYS order (local_bubble, heliopause) —
      // exercises the wiring independent of the frozen ledger values.
      const r = new SidResolver(['shell']);
      r.attach('shell', arrayDomain([5001, 5002]));
      expect(r.resolve(5001)).toEqual({ status: 'resolved', kind: 'shell', localIndex: 0 });
      expect(r.resolve(5002)).toEqual({ status: 'resolved', kind: 'shell', localIndex: 1 });
      expect(r.sidOf('shell', 0)).toBe(5001);
      expect(r.sidOf('shell', 1)).toBe(5002);
    });
  });

  describe('attach / conclude lifecycle', () => {
    it('attach replaces a previous domain', () => {
      const r = new SidResolver(['star']);
      r.attach('star', arrayDomain([10]));
      r.attach('star', arrayDomain([99]));
      expect(r.resolve(10)).toEqual({ status: 'unknown' });
      expect(r.resolve(99)).toEqual({ status: 'resolved', kind: 'star', localIndex: 0 });
    });

    it('attach after conclude re-opens the domain', () => {
      const r = new SidResolver(['cloud']);
      r.conclude('cloud');
      expect(r.resolve(7)).toEqual({ status: 'unknown' });
      r.attach('cloud', arrayDomain([7]));
      expect(r.resolve(7)).toEqual({ status: 'resolved', kind: 'cloud', localIndex: 0 });
    });

    it('conclude after attach is a no-op', () => {
      const r = new SidResolver(['star']);
      r.attach('star', arrayDomain([10]));
      r.conclude('star');
      expect(r.resolve(10)).toEqual({ status: 'resolved', kind: 'star', localIndex: 0 });
    });

    it('throws on a kind outside the roster', () => {
      const r = new SidResolver(['star']);
      expect(() => r.attach('cloud', arrayDomain([]))).toThrow(/roster/);
      expect(() => r.conclude('lg')).toThrow(/roster/);
    });
  });

  describe('sidOf (reverse lookup)', () => {
    it('returns the sid for an attached domain and null otherwise', () => {
      const r = new SidResolver(FULL_ROSTER);
      r.attach('star', arrayDomain([10, 20]));
      r.conclude('cloud');
      expect(r.sidOf('star', 1)).toBe(20);
      expect(r.sidOf('planet', 0)).toBeNull(); // registered, unattached
      expect(r.sidOf('cloud', 0)).toBeNull();  // concluded absent
    });
  });

  describe('whenResolved (deferred intents)', () => {
    it('applies synchronously when the sid already resolves', () => {
      const r = new SidResolver(['star']);
      r.attach('star', arrayDomain([10]));
      const apply = vi.fn();
      r.whenResolved(10, apply);
      expect(apply).toHaveBeenCalledExactlyOnceWith('star', 0);
    });

    it('queues while pending and fires on the attach that claims it', () => {
      const r = new SidResolver(['star', 'lg']);
      r.attach('star', arrayDomain([10]));
      const apply = vi.fn();
      r.whenResolved(77, apply);
      expect(apply).not.toHaveBeenCalled();
      r.attach('lg', arrayDomain([77]));
      expect(apply).toHaveBeenCalledExactlyOnceWith('lg', 0);
    });

    it('fires each queued intent at most once', () => {
      const r = new SidResolver(['star', 'lg', 'cloud']);
      r.attach('star', arrayDomain([]));
      const apply = vi.fn();
      r.whenResolved(77, apply);
      r.attach('lg', arrayDomain([77]));
      r.conclude('cloud');
      expect(apply).toHaveBeenCalledTimes(1);
    });

    it('expires silently once all domains settle without claiming', () => {
      const r = new SidResolver(['star', 'cloud']);
      r.attach('star', arrayDomain([10]));
      const apply = vi.fn();
      r.whenResolved(77, apply);
      r.conclude('cloud');
      expect(apply).not.toHaveBeenCalled();
      // A later (out-of-contract) re-open must not resurrect it.
      r.attach('cloud', arrayDomain([77]));
      expect(apply).not.toHaveBeenCalled();
    });

    it('drops unknown sids without queueing', () => {
      const r = new SidResolver(['star']);
      r.attach('star', arrayDomain([10]));
      const apply = vi.fn();
      r.whenResolved(0, apply);
      r.whenResolved(999, apply);
      expect(apply).not.toHaveBeenCalled();
    });
  });
});

describe('arrayDomain', () => {
  it('maps sid → position and position → sid', () => {
    const d = arrayDomain([5, 9, 12]);
    expect(d.localIndexOf(9)).toBe(1);
    expect(d.sidOf(2)).toBe(12);
  });

  it('never claims sid 0 in either direction', () => {
    const d = arrayDomain([0, 9]);
    expect(d.localIndexOf(0)).toBeNull();
    expect(d.sidOf(0)).toBeNull();
    expect(d.sidOf(1)).toBe(9);
  });

  it('returns null for out-of-range local indices and unknown sids', () => {
    const d = arrayDomain([5]);
    expect(d.localIndexOf(6)).toBeNull();
    expect(d.sidOf(-1)).toBeNull();
    expect(d.sidOf(1)).toBeNull();
  });

  it('first position wins a duplicated sid', () => {
    const d = arrayDomain([5, 5]);
    expect(d.localIndexOf(5)).toBe(0);
  });

  it('accepts typed arrays', () => {
    const d = arrayDomain(new Uint32Array([3, 8]));
    expect(d.localIndexOf(8)).toBe(1);
    expect(d.sidOf(0)).toBe(3);
  });
});

describe('sidColumnError', () => {
  it('accepts a valid column', () => {
    expect(sidColumnError([1, 2, 300])).toBeNull();
    expect(sidColumnError([])).toBeNull();
  });

  it('rejects missing, zero, negative, fractional, and non-numeric sids', () => {
    expect(sidColumnError([1, undefined])).toMatch(/record 1/);
    expect(sidColumnError([0])).toMatch(/record 0/);
    expect(sidColumnError([-3])).toMatch(/record 0/);
    expect(sidColumnError([1.5])).toMatch(/record 0/);
    expect(sidColumnError(['7'])).toMatch(/record 0/);
  });

  it('rejects duplicates and names the sid', () => {
    expect(sidColumnError([1, 2, 1])).toMatch(/duplicate sid 1 at record 2/);
  });
});
