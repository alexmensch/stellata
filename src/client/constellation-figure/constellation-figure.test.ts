import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CameraMode } from '../camera/focus/focus-controller';
import { fakeChromeLineMaterials } from '../chrome-lines/chrome-lines-mock';
import type { Constellation } from '../loaders/catalog-loader';
import { ConstellationFigure } from './constellation-figure';

const CONSTELLATIONS = [
  { code: 'Ori', name: 'Orion', lines: [[0, 1, 2]] },
  { code: 'UMa', name: 'Ursa Major', lines: [[3, 4]] },
] as Constellation[];

function build(start: { highlightCon?: number; chart?: boolean; mode?: CameraMode } = {}) {
  const added: THREE.Object3D[] = [];
  const stateHandlers = new Set<() => void>();
  const view = {
    chart: start.chart ?? false,
    highlightCon: start.highlightCon ?? -1,
    mode: start.mode ?? ('navigate' as CameraMode),
    anchor: null as number | null,
  };
  const localPositions = new Float32Array(5 * 3).map((_, i) => i);
  const rate = () => ({ pxPerSimSecond: 0 }) as never;
  const figure = new ConstellationFigure({
    scene: { add: (...objects: THREE.Object3D[]) => { added.push(...objects); return undefined as never; } },
    chromeLines: fakeChromeLineMaterials(),
    constellations: CONSTELLATIONS,
    localPositions,
    filter: () => view,
    cameraMode: () => view.mode,
    observeAnchorStar: () => view.anchor,
    onState: (handler) => {
      stateHandlers.add(handler);
      return () => { stateHandlers.delete(handler); };
    },
    rate,
  });
  const group = added[0] as THREE.Group;
  const segments = () => group.children[0] as THREE.LineSegments | undefined;
  const endpointCount = () => (segments()?.geometry.getAttribute('position').count ?? 0);
  const emitState = () => { for (const h of stateHandlers) h(); };
  return { figure, group, view, segments, endpointCount, emitState, stateHandlers, localPositions, rate };
}

describe('ConstellationFigure', () => {
  it('seeds its active set at construction', () => {
    const { group, endpointCount } = build({ highlightCon: 0 });
    expect(group.visible).toBe(true);
    expect(endpointCount()).toBe(4);
  });

  it('draws nothing with nothing highlighted outside chart', () => {
    const { group, segments } = build();
    expect(group.visible).toBe(false);
    expect(segments()).toBeUndefined();
  });

  it('rebuilds on a state emit that changes the selection, and only then', () => {
    const { view, segments, endpointCount, emitState } = build({ highlightCon: 0 });
    const first = segments();
    emitState();
    expect(segments()).toBe(first);
    view.highlightCon = 1;
    emitState();
    expect(segments()).not.toBe(first);
    expect(endpointCount()).toBe(2);
  });

  it('draws every figure in chart only while observing', () => {
    const navigate = build({ chart: true });
    expect(navigate.endpointCount()).toBe(0);
    const observe = build({ chart: true, mode: 'observe' });
    expect(observe.endpointCount()).toBe(6);
  });

  it('drops the segments touching the observe anchor', () => {
    const { view, endpointCount, emitState } = build({ highlightCon: 0 });
    view.anchor = 2;
    emitState();
    expect(endpointCount()).toBe(2);
  });

  it('re-copies vertex positions from the live buffer on update', () => {
    const { figure, segments, localPositions } = build({ highlightCon: 1 });
    localPositions[3 * 3] = 99;
    figure.entry.update?.(undefined as never);
    expect(segments()!.geometry.getAttribute('position').getX(0)).toBe(99);
  });

  it('moves at the rate it is given — a vertex may be a binary member', () => {
    const { figure, rate } = build();
    expect(figure.entry.timeBehaviour).toEqual({ kind: 'clock', rate });
  });

  it('hides while the declutter floor refuses it', () => {
    const { figure, group } = build({ highlightCon: 0 });
    figure.setPermitted(false);
    expect(group.visible).toBe(false);
    figure.setPermitted(true);
    expect(group.visible).toBe(true);
  });

  it('drops its state subscription on dispose', () => {
    const { figure, stateHandlers } = build();
    expect(stateHandlers.size).toBe(1);
    figure.entry.dispose();
    expect(stateHandlers.size).toBe(0);
  });
});
