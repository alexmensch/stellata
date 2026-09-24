import { describe, expect, it } from 'vitest';
import { SceneDeclutter, type SceneDeclutterDeps } from './scene-declutter';
import { SCENE_ELEMENT_IDS, visibleSet } from './scene-elements';

function makeHarness(patch: Partial<SceneDeclutterDeps> = {}) {
  const calls: string[] = [];
  let lgToggle = true;
  const declutter = new SceneDeclutter({
    layerPushes: {
      orbitRings: (on) => calls.push(`layer:orbitRings:${on}`),
      milkyWayIsobar: (on) => calls.push(`layer:milkyWayIsobar:${on}`),
    },
    kindPushes: {
      heliopauseShell: (on) => calls.push(`kind:heliopauseShell:${on}`),
      orbitRings: (on) => calls.push(`kind:orbitRings:${on}`),
    },
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

  it('runs the layer push, then the kind push, for one element', () => {
    const { declutter, calls } = makeHarness();
    declutter.setPermitted('orbitRings', false);
    expect(calls).toEqual(['layer:orbitRings:false', 'kind:orbitRings:false']);
    expect(declutter.permits('orbitRings')).toBe(false);
  });

  it('enables the Milky Way group while either the band or the isobar is permitted', () => {
    const { declutter, calls } = makeHarness();
    declutter.setPermitted('milkyWayBand', false);
    expect(calls).toEqual(['mw:true']);
    calls.length = 0;
    declutter.setPermitted('milkyWayIsobar', false);
    expect(calls).toEqual(['layer:milkyWayIsobar:false', 'mw:false']);
  });

  it('enables LG emission only while the floor and the user toggle both allow it', () => {
    const { declutter, calls, setLgToggle } = makeHarness();
    declutter.setPermitted('lgEmissionGlow', true);
    setLgToggle(false);
    declutter.refreshEnables();
    declutter.setPermitted('lgEmissionGlow', false);
    setLgToggle(true);
    declutter.refreshEnables();
    expect(calls).toEqual(['lg:true', 'mw:true', 'lg:false', 'lg:false', 'mw:true', 'lg:false']);
  });

  it('pushes each element exactly once per applyFloors', () => {
    const { declutter, calls } = makeHarness();
    declutter.applyFloors('physical', 'realistic');
    expect(calls).toEqual([
      'mw:true',
      'layer:milkyWayIsobar:false', 'mw:true',
      'lg:true',
      'layer:orbitRings:false', 'kind:orbitRings:false',
      'kind:heliopauseShell:false',
    ]);
  });
});
