import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bindStatisticGate, markStatisticEmitter } from './statistic-attachment';

/** The hooks take three's full render-callback signature and ignore all of
 *  it; the test only ever needs to fire them. */
type RenderHookArgs = Parameters<THREE.Object3D['onBeforeRender']>;
const NO_ARGS = [] as unknown as RenderHookArgs;

function draw(object: THREE.Object3D): void {
  object.onBeforeRender(...NO_ARGS);
  object.onAfterRender(...NO_ARGS);
}

function trace(): { log: string[]; bind: () => void } {
  const log: string[] = [];
  return {
    log,
    bind: () => bindStatisticGate(() => log.push('open'), () => log.push('close')),
  };
}

afterEach(() => bindStatisticGate(null, null));

describe('markStatisticEmitter', () => {
  it('opens the gate before the draw and shuts it after', () => {
    const { log, bind } = trace();
    bind();
    const mesh = new THREE.Object3D();
    markStatisticEmitter(mesh);
    draw(mesh);
    expect(log).toEqual(['open', 'close']);
  });

  it('leaves the gate shut for a mesh nobody marked', () => {
    const { log, bind } = trace();
    bind();
    draw(new THREE.Object3D());
    expect(log).toEqual([]);
  });

  it('composes with hooks the object already carries', () => {
    const { log, bind } = trace();
    bind();
    const mesh = new THREE.Object3D();
    mesh.onBeforeRender = () => log.push('layer-before');
    mesh.onAfterRender = () => log.push('layer-after');
    markStatisticEmitter(mesh);
    draw(mesh);
    expect(log).toEqual(['open', 'layer-before', 'layer-after', 'close']);
  });

  it('composes the other way round too, so call order decides nothing', () => {
    const { log, bind } = trace();
    bind();
    const mesh = new THREE.Object3D();
    markStatisticEmitter(mesh);
    const before = mesh.onBeforeRender;
    const after = mesh.onAfterRender;
    mesh.onBeforeRender = (...args) => { log.push('layer-before'); before.apply(mesh, args); };
    mesh.onAfterRender = (...args) => { after.apply(mesh, args); log.push('layer-after'); };
    draw(mesh);
    expect(log).toEqual(['layer-before', 'open', 'close', 'layer-after']);
  });
});

// drawBuffers on the default framebuffer accepts only BACK or NONE, so a
// hook firing on the canvas path has to be a no-op rather than a GL error:
// chart mode, the float-RT fallback and the hdr.setEnabled(false) A/B all
// leave the gate unbound while marked meshes keep drawing.
describe('an unbound gate', () => {
  it('is inert for a mesh marked before the binding existed', () => {
    const mesh = new THREE.Object3D();
    markStatisticEmitter(mesh);
    expect(() => draw(mesh)).not.toThrow();
  });

  it('goes inert again when the target disappears mid-session', () => {
    const { log, bind } = trace();
    bind();
    const mesh = new THREE.Object3D();
    markStatisticEmitter(mesh);
    draw(mesh);
    bindStatisticGate(null, null);
    draw(mesh);
    expect(log).toEqual(['open', 'close']);
  });

  it('still runs the layer\'s own hooks', () => {
    const log: string[] = [];
    const mesh = new THREE.Object3D();
    mesh.onBeforeRender = () => log.push('layer-before');
    markStatisticEmitter(mesh);
    draw(mesh);
    expect(log).toEqual(['layer-before']);
  });
});
