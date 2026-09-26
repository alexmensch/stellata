import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { fakeChromeLineMaterials } from '../chrome-lines/chrome-lines-mock';
import { CADENCE_REPORT_STILL, type CadenceReport } from '../render-gate/cadence/clock-cadence-pure';
import { makeCadenceCtx, makeFrameCtx } from '../scene/frame-ctx-mock';
import type { SettledState } from '../util/late/late';
import { BinariesAttachment, type BinariesAttachmentDeps } from './binaries-attachment';
import type { BinariesData } from './binaries-loader';
import { makeBinaries, makeRelation } from './binary-relation-fixture';

const log: string[] = [];

const ORBIT_REPORT: CadenceReport = {
  screenPxPerSimS: 4, fluxFracPerSimS: 0, observedPx: 1, observedFluxFrac: 0,
};
const ECLIPSE_REPORT: CadenceReport = {
  screenPxPerSimS: 0, fluxFracPerSimS: 0.5, observedPx: 0, observedFluxFrac: 0.25,
};

vi.mock('./binary-orbit-field', () => ({
  BinaryOrbitField: class {
    constructor(readonly opts: { binaries: BinariesData }) { log.push('orbits.new'); }
    update() { log.push('orbits.update'); }
    recenter() { log.push('orbits.recenter'); }
    markBaselinesDirty() { log.push('orbits.markBaselinesDirty'); }
    cadenceReport() { return ORBIT_REPORT; }
    focalPerturbationInto(_idx: number, _t: number, out: THREE.Vector3) {
      out.set(1, 2, 3);
      return true;
    }
    dispose() { log.push('orbits.dispose'); }
  },
}));

vi.mock('./eclipse/eclipse-photometry', () => ({
  EclipsePhotometryField: class {
    activeDimCount = 3;
    constructor() { log.push('eclipse.new'); }
    update() { log.push('eclipse.update'); }
    cadenceReport() { return ECLIPSE_REPORT; }
    debugRows(_t: number, _cam: unknown, _mag: number, starIdx: number | null) {
      return [{ starIdx }];
    }
    dispose() { log.push('eclipse.dispose'); }
  },
}));

vi.mock('./orbit-paths/binary-orbit-path-layer', () => ({
  BinaryOrbitPathLayer: class {
    systems: unknown[][] = [];
    updates: unknown[] = [];
    setSystem(...args: unknown[]) { this.systems.push(args); }
    update(offsets: unknown) { this.updates.push(offsets); log.push('paths.update'); }
    dispose() { log.push('paths.dispose'); }
  },
}));

interface FakePaths { systems: unknown[][]; updates: unknown[] }

const COUNT = 4;

function rig() {
  const focusHandlers = new Set<() => void>();
  const state = { focused: null as number | null, rides: 0 };
  const attrs = {
    iPositionAttr: new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3),
    iCompositeSuppressAttr: new THREE.BufferAttribute(new Float32Array(COUNT), 1),
    iEclipseDimAttr: new THREE.BufferAttribute(new Float32Array(COUNT), 1),
  };
  const camera = new THREE.PerspectiveCamera();
  const deps: BinariesAttachmentDeps = {
    catalog: {
      count: COUNT,
      positions: new Float32Array(COUNT * 3),
      velocities: new Float32Array(COUNT * 3),
      absmag: new Float32Array(COUNT),
      physicalRadius: new Float32Array(COUNT),
    },
    basePositions: new Float32Array(COUNT * 3),
    localPositions: new Float32Array(COUNT * 3),
    attributes: () => attrs,
    uniforms: {
      uViewport: { value: new THREE.Vector2(800, 600) },
      uFovYRad: { value: 1 },
    } as unknown as BinariesAttachmentDeps['uniforms'],
    chromeLines: fakeChromeLineMaterials(),
    camera,
    worldOffset: new THREE.Vector3(),
    getT: () => 0,
    thresholdMag: () => 6,
    focusedStar: () => state.focused,
    observeAnchorStar: () => null,
    onFocus: (handler) => {
      focusHandlers.add(handler);
      return () => focusHandlers.delete(handler);
    },
    rideFocal: () => { state.rides++; log.push('ride'); },
  };
  const attachment = new BinariesAttachment(deps);
  return {
    attachment,
    attrs,
    camera,
    state,
    paths: attachment.orbitPaths as unknown as FakePaths,
    emitFocus: () => { for (const h of focusHandlers) h(); },
    focusHandlerCount: () => focusHandlers.size,
  };
}

const table = () => makeBinaries([makeRelation({ primaryIdx: 0, secondaryIdx: 1 })]);

beforeEach(() => {
  log.length = 0;
  vi.stubGlobal('window', { innerHeight: 600 });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('BinariesAttachment before a table lands', () => {
  it('reads as pending, walks nothing and reports a still rate', () => {
    const r = rig();
    expect(r.attachment.data.state().status).toBe('pending');
    expect(r.attachment.focalPerturbation.state().status).toBe('pending');
    r.attachment.entry.update?.(makeFrameCtx(r.camera));
    expect(log).toEqual(['paths.update']);
    expect(r.paths.updates).toEqual([null]);
    expect(r.attachment.rate(makeCadenceCtx(r.camera))).toBe(CADENCE_REPORT_STILL);
    expect(r.attachment.eclipseDebugRows(null)).toEqual([]);
    expect(r.attachment.eclipseActiveDimCount).toBe(0);
  });

  it('initialises every eclipse dim to 1 and every suppress flag to 0', () => {
    const { compositeSuppress, eclipseDim } = rig().attachment.sourceArrays();
    expect([...eclipseDim]).toEqual([1, 1, 1, 1]);
    expect([...compositeSuppress]).toEqual([0, 0, 0, 0]);
  });
});

describe('BinariesAttachment.attach', () => {
  it('lands the table and both fields in one settle', () => {
    const r = rig();
    const seen: SettledState<BinariesData>[] = [];
    r.attachment.data.observe((s) => seen.push(s));
    const binaries = table();
    r.attachment.attach(binaries);
    expect(seen).toEqual([{ status: 'ready', value: binaries }]);
    expect(r.attachment.focalPerturbation.state().status).toBe('ready');
    expect(log).toEqual(['orbits.new', 'orbits.recenter', 'eclipse.new']);
  });

  it('null concludes absent, disposing a previous attach', () => {
    const r = rig();
    r.attachment.attach(table());
    log.length = 0;
    r.attachment.attach(null);
    expect(r.attachment.data.state().status).toBe('absent');
    expect(r.attachment.focalPerturbation.state().status).toBe('absent');
    expect(log).toEqual(['orbits.dispose', 'eclipse.dispose']);
    expect(r.attachment.rate(makeCadenceCtx(r.camera))).toBe(CADENCE_REPORT_STILL);
  });

  it('a re-attach scrubs dims the previous set left and uploads them in full', () => {
    const r = rig();
    r.attachment.attach(table());
    r.attachment.sourceArrays().eclipseDim[2] = 0.3;
    const version = r.attrs.iEclipseDimAttr.version;
    r.attachment.attach(table());
    expect(r.attachment.eclipseDimAt(2)).toBe(1);
    expect(r.attrs.iEclipseDimAttr.version).toBeGreaterThan(version);
    expect(log.filter((e) => e.endsWith('.dispose'))).toEqual(['orbits.dispose', 'eclipse.dispose']);
  });
});

describe('BinariesAttachment per frame', () => {
  it('walks, rides, then runs the photometry, then the paths', () => {
    const r = rig();
    r.attachment.attach(table());
    log.length = 0;
    r.attachment.entry.update?.(makeFrameCtx(r.camera));
    expect(log).toEqual(['orbits.update', 'ride', 'eclipse.update', 'paths.update']);
    expect(r.paths.updates).toHaveLength(1);
    expect(r.paths.updates[0]).not.toBeNull();
  });

  it('rates the faster of the orbit walk and the photometry, channel by channel', () => {
    const r = rig();
    r.attachment.attach(table());
    expect(r.attachment.rate(makeCadenceCtx(r.camera))).toEqual({
      screenPxPerSimS: 4, fluxFracPerSimS: 0.5, observedPx: 1, observedFluxFrac: 0.25,
    });
  });

  it('forwards recenter and a baseline rewrite to the walk only once attached', () => {
    const r = rig();
    r.attachment.entry.recenter?.(new THREE.Vector3());
    r.attachment.markBaselinesDirty();
    expect(log).toEqual([]);
    r.attachment.attach(table());
    log.length = 0;
    r.attachment.entry.recenter?.(new THREE.Vector3());
    r.attachment.markBaselinesDirty();
    expect(log).toEqual(['orbits.recenter', 'orbits.markBaselinesDirty']);
  });

  it('reads the collapse verdict off the suppress buffer the walk writes', () => {
    const r = rig();
    r.attachment.sourceArrays().compositeSuppress[1] = 1;
    expect(r.attachment.isCompositeSuppressed(1)).toBe(true);
    expect(r.attachment.isCompositeSuppressed(0)).toBe(false);
  });
});

describe('BinariesAttachment orbit paths', () => {
  it('rebuild on every focus change and when the table lands', () => {
    const r = rig();
    r.state.focused = 1;
    r.emitFocus();
    expect(r.paths.systems.at(-1)?.slice(0, 2)).toEqual([null, 1]);
    const binaries = table();
    r.attachment.attach(binaries);
    expect(r.paths.systems.at(-1)?.slice(0, 2)).toEqual([binaries, 1]);
    expect(r.paths.systems).toHaveLength(2);
  });
});

describe('BinariesAttachment.dispose', () => {
  it('unsubscribes from focus and releases the fields and the path layer', () => {
    const r = rig();
    r.attachment.attach(table());
    log.length = 0;
    r.attachment.entry.dispose();
    expect(r.focusHandlerCount()).toBe(0);
    expect(log).toEqual(['orbits.dispose', 'eclipse.dispose', 'paths.dispose']);
  });
});

describe('BinariesAttachment debug reads', () => {
  it('reach the photometry once attached', () => {
    const r = rig();
    r.attachment.attach(table());
    expect(r.attachment.eclipseDebugRows(5)).toEqual([{ starIdx: 5 }]);
    expect(r.attachment.eclipseActiveDimCount).toBe(3);
  });
});
