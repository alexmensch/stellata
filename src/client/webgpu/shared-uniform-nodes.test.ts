import { describe, expect, it } from 'vitest';
import { makeHdrEmitterUniforms } from '../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../frame/shared-uniforms';
import { MIRROR_CAPACITY } from '../star-pipeline/local-pass/star-local-mirror';
import { buildSharedUniformNodes, TEXTURE_SLOTS } from './shared-uniform-nodes';

type SlotMap = Record<string, { value: unknown }>;

const slots = (shared: unknown) => shared as SlotMap;
const valueOf = (shared: unknown, key: string) => slots(shared)[key].value;
const setValue = (shared: unknown, key: string, v: number) => { slots(shared)[key].value = v; };

const mirrored = (shared: unknown) =>
  Object.keys(slots(shared)).filter(
    (k) => !(TEXTURE_SLOTS as readonly string[]).includes(k) && k !== 'uLocalMemberIdx',
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
    for (const t of TEXTURE_SLOTS) expected.delete(t);
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
