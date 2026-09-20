import { describe, it, expect, afterEach } from 'vitest';
import { createCardRolodex } from './card-rolodex';
import { makeCardDom } from './card-dom-mock';
import type { FocusCardContent, FocusCardProviders } from './focus-card-types';
import type { Stellata } from '../stellata';
import type { Target } from '../camera/focus/focus-target';

// Stands in for starLabels / spectralMap / searchEntryById.
interface LateTables {
  label: string;
  rows: { label: string; value: string }[];
  generation: number;
}

const PARTIAL: Omit<LateTables, 'generation'> = {
  label: 'Gaia DR3 2061213083772814080',
  rows: [{ label: 'Distance', value: '3.2 pc' }],
};

const COMPLETE: Omit<LateTables, 'generation'> = {
  label: 'HIP 100557',
  rows: [
    { label: 'Distance', value: '3.2 pc' },
    { label: 'Designations', value: 'HIP 100557 · HD 194298' },
    { label: 'Spectral', value: 'M3 V' },
    { label: 'Known companions', value: 'HIP 100557 B' },
  ],
};

function makeProviders(
  tables: LateTables,
  ready: (idx: number) => boolean = () => true,
): FocusCardProviders {
  const format = (idx: number): FocusCardContent => ({
    name: `${tables.label}${idx === POI_IDX ? ' (pin)' : ''}`,
    identityLines: [],
    rows: tables.rows.map((r) => ({ label: r.label, value: r.value })),
    lines: [],
  });
  const one = { format, ready };
  return {
    star: one, planet: one, probe: one, cloud: one, lg: one, shell: one,
  } as unknown as FocusCardProviders;
}

const POI_IDX = 42;

function makeStellata(target: Target, pois: readonly Target[] = []) {
  const handlers = new Map<string, ((p: never) => void)[]>();
  const stellata = {
    on(name: string, fn: (p: never) => void) {
      const list = handlers.get(name) ?? [];
      list.push(fn);
      handlers.set(name, list);
      return () => {};
    },
    focus: {
      getFocusedTarget: () => target,
      getCameraMode: () => 'navigate' as const,
      unfocus: () => {},
    },
    pois: { get: () => pois, toggle: () => {} },
  } as unknown as Stellata;
  return { stellata, frame: () => handlers.get('frame')?.forEach((f) => f(undefined as never)) };
}

describe('card rolodex over a growing catalogue', () => {
  let teardown: (() => void) | null = null;
  afterEach(() => { teardown?.(); teardown = null; });

  function boot(tables: LateTables, pending = { value: false }) {
    const dom = makeCardDom();
    teardown = dom.install();
    const { stellata, frame } = makeStellata({ kind: 'star', idx: 7 });
    const dispose = createCardRolodex({
      stellata,
      providers: makeProviders(tables),
      derivedGeneration: () => tables.generation,
      focusPending: () => pending.value,
    });
    return { dom, frame, dispose, stack: dom.els.get('card-stack')! };
  }

  // The gate, and it names no field on purpose — README.md § Surfaces
  // retained over a growing catalogue.
  it('a card built mid-load renders what a complete-catalogue boot would', () => {
    const late: LateTables = { ...PARTIAL, generation: 1 };
    const { dom, frame } = boot(late);
    const stale = dom.dump();

    Object.assign(late, COMPLETE, { generation: 2 });
    frame();
    const settled = dom.dump();
    teardown?.();
    teardown = null;

    const fresh = boot({ ...COMPLETE, generation: 2 });
    expect(settled).toBe(fresh.dom.dump());
    // Guard against a vacuous pass: the partial card must actually have
    // differed, or this asserts nothing.
    expect(stale).not.toBe(settled);
  });

  it('shows no card at all while a URL focus is still pending', () => {
    const pending = { value: true };
    const { dom, frame, stack } = boot({ ...COMPLETE, generation: 1 }, pending);
    expect(stack.hidden).toBe(true);

    pending.value = false;
    frame();

    expect(stack.hidden).toBe(false);
    expect(dom.dump()).toContain('HIP 100557');
  });

  it('withholds a pin on its own readiness, not the focus card\'s', () => {
    const tables: LateTables = { ...COMPLETE, generation: 1 };
    const dom = makeCardDom();
    teardown = dom.install();
    const poi: Target = { kind: 'star', idx: POI_IDX };
    const { stellata, frame } = makeStellata({ kind: 'star', idx: 7 }, [poi]);
    let poiReady = false;
    createCardRolodex({
      stellata,
      // The focus is ready throughout; only the pin is not.
      providers: makeProviders(tables, (idx) => (idx === POI_IDX ? poiReady : true)),
      derivedGeneration: () => tables.generation,
      focusPending: () => false,
    });

    // Focus card present, pin absent — not "the stack is hidden".
    expect(dom.els.get('card-stack')!.hidden).toBe(false);
    expect(dom.els.get('card-strips')!.children).toHaveLength(0);

    poiReady = true;
    tables.generation = 2;
    frame();

    expect(dom.els.get('card-strips')!.children).toHaveLength(1);
  });

  it('leaves the card alone while the generation is unchanged', () => {
    const tables: LateTables = { ...COMPLETE, generation: 4 };
    const { dom, frame } = boot(tables);
    const before = dom.dump();

    tables.rows = [{ label: 'Distance', value: 'CHANGED' }];
    frame();

    expect(dom.dump()).toBe(before);
  });
});
