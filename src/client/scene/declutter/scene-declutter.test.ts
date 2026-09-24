import { describe, expect, it } from 'vitest';
import { SceneDeclutter, type SceneDeclutterDeps } from './scene-declutter';
import { SCENE_ELEMENT_IDS, visibleSet } from './scene-elements';

function makeHarness(patch: Partial<SceneDeclutterDeps> = {}) {
  const calls: string[] = [];
  let lgToggle = true;
  const declutter = new SceneDeclutter({
    pushes: [
      {
        orbitRings: (on) => calls.push(`push:orbitRings:${on}`),
        milkyWayIsobar: (on) => calls.push(`push:milkyWayIsobar:${on}`),
      },
      { heliopauseShell: (on) => calls.push(`push:heliopauseShell:${on}`) },
    ],
    setMilkyWayEnabled: (on) => calls.push(`mw:${on}`),
    setLgEmissionEnabled: (on) => calls.push(`lg:${on}`),
    showLgEmission: () => lgToggle,
    ...patch,
  });
  return { declutter, calls, setLgToggle: (on: boolean) => { lgToggle = on; } };
}

describe('SceneDeclutter', () => {
  it('permits every element before any floor is applied', () => {
    const { declutter, calls } = makeHarness();
    expect(SCENE_ELEMENT_IDS.every((id) => declutter.permits(id))).toBe(true);
    expect(calls).toEqual([]);
  });

  it('applyFloors writes the cumulative floor set for the style', () => {
    const { declutter } = makeHarness();
    for (const style of ['realistic', 'chart'] as const) {
      for (const level of ['physical', 'representational', 'all'] as const) {
        declutter.applyFloors(level, style);
        const permitted = new Set(SCENE_ELEMENT_IDS.filter((id) => declutter.permits(id)));
        expect(permitted).toEqual(visibleSet(level, style));
      }
    }
  });

  it('refuses two push sources claiming one element', () => {
    expect(() => makeHarness({
      pushes: [{ orbitRings: () => {} }, { orbitRings: () => {} }],
    })).toThrow(/orbitRings/);
  });

  it('keeps the Milky Way group enabled in both styles — band in realistic, isobar in chart', () => {
    const { declutter, calls } = makeHarness();
    declutter.applyFloors('physical', 'realistic');
    expect(calls.filter((c) => c.startsWith('mw:')).at(-1)).toBe('mw:true');
    calls.length = 0;
    declutter.applyFloors('physical', 'chart');
    expect(calls).toContain('push:milkyWayIsobar:true');
    expect(calls.filter((c) => c.startsWith('mw:')).at(-1)).toBe('mw:true');
  });

  describe('LG emission is enabled only while the floor and the user toggle both allow it', () => {
    const lastLg = (calls: string[]) => calls.filter((c) => c.startsWith('lg:')).at(-1);

    it('floor permits, toggle on → enabled', () => {
      const { declutter, calls } = makeHarness();
      declutter.applyFloors('physical', 'realistic');
      expect(lastLg(calls)).toBe('lg:true');
    });

    it('floor permits, toggle off → disabled on the next refresh', () => {
      const { declutter, calls, setLgToggle } = makeHarness();
      declutter.applyFloors('physical', 'realistic');
      setLgToggle(false);
      declutter.refreshLgEmission();
      expect(lastLg(calls)).toBe('lg:false');
    });

    it('floor forbids, toggle on → disabled', () => {
      const { declutter, calls } = makeHarness();
      declutter.applyFloors('all', 'chart');
      expect(lastLg(calls)).toBe('lg:false');
    });
  });

  it('pushes each element exactly once per applyFloors', () => {
    const { declutter, calls } = makeHarness();
    declutter.applyFloors('physical', 'realistic');
    expect(calls).toEqual([
      'mw:true',
      'push:milkyWayIsobar:false', 'mw:true',
      'lg:true',
      'push:orbitRings:false',
      'push:heliopauseShell:false',
    ]);
  });
});
