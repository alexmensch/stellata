import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mark,
  measure,
  frame,
  gpuBegin,
  gpuEnd,
  buildPerfSection,
  acquireGpuFrameSampler,
  _sectionsForTest,
} from './perf-hud';
import { publishGpuFrameSample } from './gpu-timing/gpu-frame-samples';
import { GPU_WHOLE_FRAME_SCOPE } from './gpu-timing/gpu-timer';
import { FakeGl, asGl } from './gpu-timing/fake-gl';

describe('perf-hud / no-op API', () => {
  it('mark/measure/frame are safe to call without installing the HUD', () => {
    // The API contract is "always callable, no-op until buildPerfSection
    // runs". Production code calls these unconditionally; if they ever
    // start throwing without the HUD installed, every animate() tick
    // would crash.
    expect(() => {
      mark('test.section');
      measure('test.section');
      frame();
    }).not.toThrow();
  });

  it('repeated frame() calls without install do nothing', () => {
    for (let i = 0; i < 100; i++) frame();
    // No assertion beyond "didn't throw and didn't allocate visible
    // state" — internal counters are off by design when not installed.
  });
});

// Minimal DOM stub for buildPerfSection(null) — it creates ~150 nodes
// (headline, table header, row pool, histogram bars, caption) but the
// teardown tests only need the build to complete; nothing is inspected.
// vitest runs in the node environment for this project, so document is
// unavailable by default. Pattern mirrors heliopause.test.ts.
function makeDomStub(): {
  createElement: () => unknown;
  createTextNode: () => unknown;
  getSelection: () => null;
} {
  type Node = {
    style: Record<string, string>;
    children: Node[];
    childNodes: Node[];
    firstChild: Node | null;
    id: string;
    textContent: string;
    nodeValue: string;
    title: string;
    appendChild: (c: Node) => Node;
    addEventListener: () => void;
  };
  const makeNode = (): Node => {
    const node: Node = {
      style: {},
      children: [],
      childNodes: [],
      firstChild: null,
      id: '',
      textContent: '',
      nodeValue: '',
      title: '',
      appendChild(c: Node) {
        this.children.push(c);
        this.childNodes.push(c);
        if (this.firstChild === null) this.firstChild = c;
        return c;
      },
      addEventListener() {},
    };
    return node;
  };
  return {
    createElement: makeNode,
    createTextNode: makeNode,
    // setReadoutText consults the live selection before every write, so a
    // stub without this reports a table that never updates.
    getSelection: () => null,
  };
}

type StubNode = { children: StubNode[]; firstChild: { nodeValue: string } };

/** The headline's `gpu`/`submit` segment. Headline children are
 *  [FPS text, low span, ' ', gpu span]; the production code writes through
 *  typed refs precisely to avoid this walk, so it lives in one place. */
function headlineBusyText(section: { element: unknown }): string {
  const headline = (section.element as StubNode).children[0];
  return headline.children[3].firstChild.nodeValue;
}

describe('perf-hud / install → dispose teardown', () => {
  let prevDoc: unknown;
  let perfNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = makeDomStub();
    perfNowSpy = vi.spyOn(performance, 'now');
  });

  afterEach(() => {
    perfNowSpy.mockRestore();
    (globalThis as { document?: unknown }).document = prevDoc;
  });

  it('dispose restores the no-op contract — mark/measure/frame stop calling performance.now', () => {
    const section = buildPerfSection(null);

    // While installed, realMark/realMeasure both call performance.now —
    // mark stores the start timestamp, measure subtracts it. Confirm
    // the install actually took effect before we test the teardown.
    perfNowSpy.mockClear();
    mark('test.a');
    measure('test.a');
    expect(perfNowSpy.mock.calls.length).toBeGreaterThan(0);

    section.dispose();

    // After dispose, every dispatch must route back through the no-op
    // stubs. No performance.now calls means _mark/_measure are no-ops
    // again; no exception from frame() means _frame is no-op too.
    perfNowSpy.mockClear();
    mark('test.b');
    measure('test.b');
    for (let i = 0; i < 100; i++) frame();
    expect(perfNowSpy.mock.calls.length).toBe(0);
  });

  it('records a published frame sample as the whole-frame scope only while open', () => {
    // The WebGPU boot has no GL timer object. animate() resolves the
    // renderer's timestamps every rendered frame regardless — the resolve
    // is what recycles the query pool — so a sample arrives whether or not
    // anything is listening, and an unsubscribed HUD must drop it rather
    // than accumulate one.
    const whole = `gpu.${GPU_WHOLE_FRAME_SCOPE}`;
    publishGpuFrameSample(4.2);
    expect(_sectionsForTest().has(whole)).toBe(false);

    const section = buildPerfSection(null);
    publishGpuFrameSample(4.2);
    expect(_sectionsForTest().has(whole)).toBe(true);

    section.dispose();
    publishGpuFrameSample(4.2);
    expect(_sectionsForTest().has(whole)).toBe(false);
  });

  it('section-GC: drops labels silent for a full ring window', () => {
    // Silent-section GC is the mechanism that lets `chart.*` entries fall
    // off the HUD after exiting chart mode. Without it the HUD averages
    // stale ring data forever.
    const section = buildPerfSection(null);

    mark('test.gc');
    measure('test.gc');
    expect(_sectionsForTest().has('test.gc')).toBe(true);

    // RING_SIZE = 60. After RING_SIZE+1 silent frames the section drops.
    for (let i = 0; i < 62; i++) frame();
    expect(_sectionsForTest().has('test.gc')).toBe(false);

    section.dispose();
  });

  it('headline reports the whole-frame scope, never the sum of the rotating scopes', () => {
    // The defect this pins: scopes rotate one per frame, so their averages
    // describe disjoint frame sets. Adding them produced a headline larger
    // than the frame period itself (85 ms claimed inside a 62.5 ms frame).
    const gl = new FakeGl();
    let clock = 0;
    perfNowSpy.mockImplementation(() => (clock += 100));
    const section = buildPerfSection(asGl(gl));

    // animate()'s call order, with every query resolving in-frame. Only a
    // begin that actually opened a NEW query gets a result written — the
    // enclosing scope stays active across the inner begins.
    const openScope = (label: string, ms: number): void => {
      const before = gl.activeQuery;
      gpuBegin(label);
      if (gl.activeQuery && gl.activeQuery !== before) {
        gl.results.set(gl.activeQuery, ms * 1e6);
      }
    };
    for (let f = 0; f < 6; f++) {
      openScope(GPU_WHOLE_FRAME_SCOPE, 20);
      openScope('main', 17);
      gpuEnd('main');
      openScope('localDepth', 11);
      gpuEnd('localDepth');
      gpuEnd(GPU_WHOLE_FRAME_SCOPE);
      frame();
    }

    expect(headlineBusyText(section)).toBe('gpu 20.0ms');

    section.dispose();
  });

  it('headline reads gpu on a WebGPU boot, where there is no GL timer at all', () => {
    // The WebGPU resolve is a real whole-frame GPU measurement, so gating
    // the label on "does a GpuTimer object exist" left the headline saying
    // `submit` — CPU wall-time around the render calls — while an exact GPU
    // number sat in the ring. Presence of the whole-frame row is the gate.
    let clock = 0;
    perfNowSpy.mockImplementation(() => (clock += 100));
    const section = buildPerfSection(null);

    for (let f = 0; f < 6; f++) {
      publishGpuFrameSample(20);
      frame();
    }

    expect(headlineBusyText(section)).toBe('gpu 20.0ms');

    section.dispose();
  });

  it('headline stays submit where no backend produces a whole-frame row', () => {
    // Presence of `gpu.frame` is the ONLY gate. Nothing publishes here —
    // a WebGPU adapter without timestamp-query, or WebGL2 Safari — so the
    // headline must report CPU submission wall-time and say so, never sum
    // the per-pass scopes into a number that can exceed the frame period.
    let clock = 0;
    perfNowSpy.mockImplementation(() => (clock += 100));
    const section = buildPerfSection(null);

    for (let f = 0; f < 6; f++) {
      mark('submit.main');
      measure('submit.main');
      frame();
    }

    expect(headlineBusyText(section)).toBe('submit 100.0ms');

    section.dispose();
  });

  it('acquireGpuFrameSampler returns null while the panel is installed', () => {
    const section = buildPerfSection(null);
    expect(acquireGpuFrameSampler(asGl(new FakeGl()), () => {})).toBeNull();
    section.dispose();
  });

  it('sampler: whole-frame scope samples EVERY frame, inner scopes ignored', () => {
    const gl = new FakeGl();
    const samples: number[] = [];
    const release = acquireGpuFrameSampler(asGl(gl), (ms) => samples.push(ms));
    expect(release).not.toBeNull();

    for (let f = 0; f < 5; f++) {
      gpuBegin(GPU_WHOLE_FRAME_SCOPE);
      const query = gl.activeQuery;
      expect(query).not.toBeNull();
      gl.results.set(query!, (10 + f) * 1e6);
      gpuBegin('main');
      gpuEnd('main');
      gpuEnd(GPU_WHOLE_FRAME_SCOPE);
      frame();
    }
    // A multi-scope timer would rotate and sample 1/N frames; the sampler
    // registers only the whole-frame scope, so all 5 frames land.
    expect(samples).toEqual([10, 11, 12, 13, 14]);

    release!();
    // Hooks are no-ops again — a begin after release opens no query.
    gpuBegin(GPU_WHOLE_FRAME_SCOPE);
    expect(gl.activeQuery).toBeNull();
  });

  it('sampler release does not clobber a panel opened mid-hold', () => {
    const samplerGl = new FakeGl();
    const release = acquireGpuFrameSampler(asGl(samplerGl), () => {});
    expect(release).not.toBeNull();

    const panelGl = new FakeGl();
    const section = buildPerfSection(asGl(panelGl));
    release!();

    // The panel's hooks survived the release: its timer still opens
    // queries on its own context.
    gpuBegin(GPU_WHOLE_FRAME_SCOPE);
    expect(panelGl.activeQuery).not.toBeNull();
    gpuEnd(GPU_WHOLE_FRAME_SCOPE);
    section.dispose();
  });

  it('dispose + re-build re-arms the install — `installed` flag was cleared', () => {
    // First session: install then dispose. The dispose path must reset
    // `installed = false` so the second buildPerfSection takes the
    // install branch again rather than skipping it (which would leave
    // _mark/_measure/_frame as no-ops despite a panel being visible).
    const first = buildPerfSection(null);
    first.dispose();

    // Confirm the dispose actually un-installed by checking mark is a
    // no-op between the two builds.
    perfNowSpy.mockClear();
    mark('between.builds');
    measure('between.builds');
    expect(perfNowSpy.mock.calls.length).toBe(0);

    // Second build re-runs the install branch and rewires the reals.
    const second = buildPerfSection(null);
    perfNowSpy.mockClear();
    mark('test.second');
    measure('test.second');
    expect(perfNowSpy.mock.calls.length).toBeGreaterThan(0);

    second.dispose();
  });
});
