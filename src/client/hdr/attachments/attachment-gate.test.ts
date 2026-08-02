import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  bindAttachmentGate,
  markAbsorber,
  markDiffuseEmitter,
  markOccludingEmitter,
  markStatisticEmitter,
} from './attachment-gate';

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
    bind: () =>
      bindAttachmentGate((a) => log.push(`open:${a}`), () => log.push('close')),
  };
}

afterEach(() => bindAttachmentGate(null, null));

describe('markStatisticEmitter', () => {
  it('opens the gate before the draw and shuts it after', () => {
    const { log, bind } = trace();
    bind();
    const mesh = new THREE.Object3D();
    markStatisticEmitter(mesh);
    draw(mesh);
    expect(log).toEqual(['open:statistic', 'close']);
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
    expect(log).toEqual(['open:statistic', 'layer-before', 'layer-after', 'close']);
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
    expect(log).toEqual(['layer-before', 'open:statistic', 'close', 'layer-after']);
  });
});

// A volumetric emitter opens a different set: attachment 2 as well, and
// attachment 0 masked off, because the resolve owns that pixel once it has
// averaged attachment 2 over the summation patch (../summation/README.md).
// Marking one `markStatisticEmitter` instead would discard every diffuse
// write silently, so which helper a layer calls is part of its contract.
describe('markDiffuseEmitter', () => {
  it('asks for the diffuse attachment, not merely the statistic', () => {
    const { log, bind } = trace();
    bind();
    const mesh = new THREE.Object3D();
    markDiffuseEmitter(mesh);
    draw(mesh);
    expect(log).toEqual(['open:diffuse', 'close']);
  });

  it('is inert on the canvas path, exactly as the statistic mark is', () => {
    const mesh = new THREE.Object3D();
    markDiffuseEmitter(mesh);
    expect(() => draw(mesh)).not.toThrow();
  });
});

// An absorber is neither an emitter nor a measurement: it keeps attachment 0
// (nothing else may assume that attachment is empty behind it) and takes
// attachment 2, because the diffuse field it dims is there until the resolve
// convolves it. Attachment 1 stays shut, so the statistic keeps reading
// un-extincted light — README.md § Known residuals.
describe('markAbsorber', () => {
  it('asks for the diffuse attachment alongside attachment 0', () => {
    const { log, bind } = trace();
    bind();
    const mesh = new THREE.Object3D();
    markAbsorber(mesh);
    draw(mesh);
    expect(log).toEqual(['open:absorption', 'close']);
  });

  it('is inert on the canvas path, exactly as the other two marks are', () => {
    const mesh = new THREE.Object3D();
    markAbsorber(mesh);
    expect(() => draw(mesh)).not.toThrow();
  });
});

// A surface drawn in front of the diffuse field is an emitter AND an occluder,
// so it is the one mark that opens every attachment: light into 0, its
// statistic into 1, and its own opacity into 2. The alternative — a depth-only
// prepass per body, the star pipeline's renderOrder −4 trick — cannot dim by a
// partial alpha, which the ring annulus and the atmosphere limb both need.
describe('markOccludingEmitter', () => {
  it('asks for every attachment, emitting and occluding in one draw', () => {
    const { log, bind } = trace();
    bind();
    const mesh = new THREE.Object3D();
    markOccludingEmitter(mesh);
    draw(mesh);
    expect(log).toEqual(['open:occluding-emitter', 'close']);
  });

  it('is inert on the canvas path, exactly as the other marks are', () => {
    const mesh = new THREE.Object3D();
    markOccludingEmitter(mesh);
    expect(() => draw(mesh)).not.toThrow();
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
    bindAttachmentGate(null, null);
    draw(mesh);
    expect(log).toEqual(['open:statistic', 'close']);
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
