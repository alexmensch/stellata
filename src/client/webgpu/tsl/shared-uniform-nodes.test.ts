import { describe, expect, it } from 'vitest';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { MIRROR_CAPACITY } from '../../star-pipeline/local-pass/star-mirror-slots';
import { STAR_RENDER_DEFAULTS } from '../../filters/filter-state';
import { buildSharedUniformNodes, FRAME_TEXTURE_SLOTS } from './shared-uniform-nodes';

type SlotMap = Record<string, { value: unknown }>;

const slots = (shared: unknown) => shared as SlotMap;
const valueOf = (shared: unknown, key: string) => slots(shared)[key].value;
const setValue = (shared: unknown, key: string, v: number) => { slots(shared)[key].value = v; };

const mirrored = (shared: unknown) =>
  Object.keys(slots(shared)).filter(
    (k) => !(FRAME_TEXTURE_SLOTS as readonly string[]).includes(k) && k !== 'uLocalMemberIdx',
  );

const scalarSlotKeys = (shared: unknown) =>
  mirrored(shared).filter((k) => typeof valueOf(shared, k) === 'number');

const objectSlotKeys = (shared: unknown) =>
  mirrored(shared).filter((k) => typeof valueOf(shared, k) === 'object');

function build() {
  const shared = buildSharedUniforms({
    pixelRatio: 2,
    fovYRad: 0.75,
    viewportW: 1600,
    viewportH: 900,
    hdr: makeHdrEmitterUniforms(),
  });
  return { shared, registry: buildSharedUniformNodes(shared) };
}

describe('buildSharedUniformNodes', () => {
  it('mirrors every WebGL slot: same keys minus textures, member array split into two ivec4s', () => {
    const { shared, registry } = build();
    const expected = new Set<string>(Object.keys(shared));
    for (const t of FRAME_TEXTURE_SLOTS) expected.delete(t);
    expected.delete('uLocalMemberIdx');
    expected.add('uLocalMemberIdx0');
    expected.add('uLocalMemberIdx1');
    expect(new Set(Object.keys(registry.nodes))).toEqual(expected);
  });

  it('two ivec4 slots cover the mirror capacity exactly', () => {
    expect(MIRROR_CAPACITY).toBe(8);
  });

  it('every vector slot holds the WebGL map value object by reference — no sync needed', () => {
    const { shared, registry } = build();
    const nodes = registry.nodes as unknown as Record<string, { value: unknown }>;
    const vectorKeys = objectSlotKeys(shared);
    expect(vectorKeys).toEqual(['uCameraPos', 'uViewport', 'uWorldOffset']);
    for (const k of vectorKeys) {
      expect(nodes[k].value, k).toBe(valueOf(shared, k));
    }
  });

  // sync() picks its scalar keys reflectively, so a slot can be mirrored as
  // a node and still never be copied into — it would then hold its
  // construction value forever. A unique value per key is what catches a
  // gap in that coverage; spot-checking a handful of slots cannot.
  it('sync reaches every mirrored scalar slot, not just the spot-checked ones', () => {
    const { shared, registry } = build();
    const nodes = registry.nodes as unknown as Record<string, { value: unknown }>;
    const keys = scalarSlotKeys(shared);
    keys.forEach((k, i) => { setValue(shared, k, 1000 + i); });
    registry.sync();
    keys.forEach((k, i) => {
      expect(nodes[k].value, k).toBe(1000 + i);
    });
  });

  it('sync copies every scalar slot, including the hdr emitter and int/uint slots', () => {
    const { shared, registry } = build();
    shared.uLimitMag.value = 9.25;
    shared.uExposure.value = 123.5;
    shared.uSpectMask.value = 0x155;
    shared.uHideFocusIdx.value = 42;
    registry.sync();
    expect(registry.nodes.uLimitMag.value).toBe(9.25);
    expect(registry.nodes.uExposure.value).toBe(123.5);
    expect(registry.nodes.uSpectMask.value).toBe(0x155);
    expect(registry.nodes.uHideFocusIdx.value).toBe(42);
  });

  it('sync splits the member-index array across the two ivec4s', () => {
    const { shared, registry } = build();
    shared.uLocalMemberIdx.value.set([10, 11, 12, 13, 14, 15, 16, 17]);
    registry.sync();
    expect(registry.nodes.uLocalMemberIdx0.value.toArray()).toEqual([10, 11, 12, 13]);
    expect(registry.nodes.uLocalMemberIdx1.value.toArray()).toEqual([14, 15, 16, 17]);
  });

  it('declares GPU-side integer types for the mask and index slots', () => {
    const { registry } = build();
    expect(registry.nodes.uSpectMask.nodeType).toBe('uint');
    expect(registry.nodes.uHideFocusIdx.nodeType).toBe('int');
    expect(registry.nodes.uLocalMemberIdx0.nodeType).toBe('ivec4');
  });
});

// The debug panel's "Star disc" knobs are already scalar slots on the
// shared map, so on a WebGPU boot they reach the TSL graphs through the
// per-frame sync with no plumbing of their own. What this pins is that a
// NEW knob cannot be added as a non-shared uniform, which would reach the
// GLSL pipeline and silently miss the TSL one.
describe('the debug-panel star-disc seam', () => {
  const KNOB_SLOTS: Record<keyof typeof STAR_RENDER_DEFAULTS, readonly string[]> = {
    // One knob, two slots: the derived -log(threshold) rides a uniform so
    // the fragment stage does not recompute a log per fragment.
    visibleThreshold: ['uVisibleThreshold', 'uVisibleK'],
    coreThreshold: ['uCoreThreshold'],
    discardThreshold: ['uDiscardThreshold'],
    distNMin: ['uDistNMin'],
    distNMax: ['uDistNMax'],
    lumBiasMin: ['uLumBiasMin'],
    lumBiasMax: ['uLumBiasMax'],
    sizeKnee: ['uSizeKnee'],
  };

  it('covers every knob the programmatic setter accepts', () => {
    expect(Object.keys(KNOB_SLOTS).sort())
      .toEqual(Object.keys(STAR_RENDER_DEFAULTS).sort());
  });

  it('lands every knob slot in the node mirror, live per frame', () => {
    const { shared, registry } = build();
    const nodes = registry.nodes as unknown as SlotMap;
    for (const [knob, keys] of Object.entries(KNOB_SLOTS)) {
      for (const key of keys) {
        expect(nodes[key], `${knob} -> ${key}`).toBeDefined();
        setValue(shared, key, 0.125);
      }
    }
    registry.sync();
    for (const keys of Object.values(KNOB_SLOTS)) {
      for (const key of keys) expect(nodes[key].value).toBe(0.125);
    }
  });
});
