import { describe, expect, it } from 'vitest';
import { makeHdrEmitterUniforms } from '../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../frame/shared-uniforms';
import { MIRROR_CAPACITY } from '../star-pipeline/local-pass/star-local-mirror';
import { buildSharedUniformNodes, TEXTURE_SLOTS } from './shared-uniform-nodes';

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

  it('vector slots hold the WebGL map value objects by reference — no sync needed', () => {
    const { shared, registry } = build();
    expect(registry.nodes.uCameraPos.value).toBe(shared.uCameraPos.value);
    expect(registry.nodes.uViewport.value).toBe(shared.uViewport.value);
    expect(registry.nodes.uWorldOffset.value).toBe(shared.uWorldOffset.value);
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
