import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { maybeShowMobileAdvisory } from './mobile-advisory';

const STORAGE_KEY = 'stellata.mobile-advisory-dismissed';

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
}

function makeFakeModal() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    hidden: true,
    addEventListener: (type: string, cb: (e: unknown) => void) => {
      (listeners[type] ??= []).push(cb);
    },
    removeEventListener: () => {},
    dispatch: (type: string, e: unknown) => {
      for (const cb of listeners[type] ?? []) cb(e);
    },
  };
}

const g = globalThis as Record<string, unknown>;
const GLOBAL_KEYS = ['document', 'window', 'navigator', 'localStorage', 'sessionStorage'];
const saved: Record<string, unknown> = {};

// Node's built-in `navigator` (and, depending on version, `window`) are
// read-only getters — a plain `g.navigator = ...` throws. defineProperty
// overrides them for the test and restores the original the same way.
function setGlobal(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

function mountTouchPhone() {
  const modal = makeFakeModal();
  setGlobal('document', {
    getElementById: (id: string) => (id === 'mobile-advisory-modal' ? modal : null),
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  setGlobal('window', {
    innerWidth: 390,
    matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' }),
  });
  setGlobal('navigator', { maxTouchPoints: 5 });
  setGlobal('localStorage', makeStorage());
  setGlobal('sessionStorage', makeStorage());
  return modal;
}

describe('maybeShowMobileAdvisory', () => {
  beforeEach(() => {
    for (const k of GLOBAL_KEYS) saved[k] = g[k];
  });

  afterEach(() => {
    for (const k of GLOBAL_KEYS) setGlobal(k, saved[k]);
  });

  it('shows on a narrow touch viewport and records the dismissal in sessionStorage', () => {
    const modal = mountTouchPhone();
    expect(maybeShowMobileAdvisory()).toBe(true);
    expect(modal.hidden).toBe(false);
    expect((g.sessionStorage as Storage).getItem(STORAGE_KEY)).toBeNull();
    modal.dispatch('click', { target: { closest: () => ({}) } });
    expect(modal.hidden).toBe(true);
    expect((g.sessionStorage as Storage).getItem(STORAGE_KEY)).toBe('1');
  });

  it('does not show again within the same session once dismissed', () => {
    mountTouchPhone();
    (g.sessionStorage as Storage).setItem(STORAGE_KEY, '1');
    expect(maybeShowMobileAdvisory()).toBe(false);
  });

  it('shows again on a fresh session even if a prior session dismissed it', () => {
    mountTouchPhone();
    // Simulate the prior session's dismissal living in localStorage (the
    // old per-browser key) — sessionStorage starts empty for a new tab.
    (g.localStorage as Storage).setItem(STORAGE_KEY, '1');
    expect(maybeShowMobileAdvisory()).toBe(true);
  });

  it('does not show on a wide viewport', () => {
    mountTouchPhone();
    (g.window as { innerWidth: number }).innerWidth = 1440;
    expect(maybeShowMobileAdvisory()).toBe(false);
  });
});
