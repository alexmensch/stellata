import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { StarPipeline } from './star-pipeline';
import { MIRROR_CAPACITY } from './local-pass/star-local-mirror';
import { makeStarPipelineOptions as makeOpts } from './star-pipeline-mock';

describe('StarPipeline', () => {
  it('adds three meshes to the scene with the expected renderOrders', () => {
    const opts = makeOpts();
    const pipe = new StarPipeline(opts);

    const meshes = opts.scene.children.filter(
      (c): c is THREE.Mesh => (c as THREE.Mesh).isMesh,
    );
    expect(meshes).toHaveLength(3);
    expect(meshes).toContain(pipe.coreMaskMesh);
    expect(meshes).toContain(pipe.discMesh);
    expect(meshes).toContain(pipe.glowMesh);
    expect(pipe.coreMaskMesh.renderOrder).toBe(-4);
    expect(pipe.discMesh.renderOrder).toBe(0);
    expect(pipe.glowMesh.renderOrder).toBe(1);
    expect(pipe.coreMaskMesh.visible).toBe(false);
    expect(pipe.discMesh.frustumCulled).toBe(false);
    expect(pipe.glowMesh.frustumCulled).toBe(false);
    expect(pipe.coreMaskMesh.frustumCulled).toBe(false);
  });

  it('shares one geometry across all three meshes', () => {
    const pipe = new StarPipeline(makeOpts());
    expect(pipe.coreMaskMesh.geometry).toBe(pipe.geometry);
    expect(pipe.discMesh.geometry).toBe(pipe.geometry);
    expect(pipe.glowMesh.geometry).toBe(pipe.geometry);
  });

  it('shares uniform value-objects by reference across the three passes', () => {
    const opts = makeOpts();
    const pipe = new StarPipeline(opts);
    // Shared keys map to the same value-objects on every pass; only
    // uRenderMode is per-material.
    expect(pipe.discMaterial.uniforms.uCameraPos).toBe(opts.sharedUniforms.uCameraPos);
    expect(pipe.glowMaterial.uniforms.uCameraPos).toBe(opts.sharedUniforms.uCameraPos);
    expect(pipe.coreMaskMaterial.uniforms.uCameraPos).toBe(opts.sharedUniforms.uCameraPos);
    expect(pipe.discMaterial.uniforms.uTime).toBe(pipe.glowMaterial.uniforms.uTime);
    // uRenderMode differs per pass.
    expect(pipe.discMaterial.uniforms.uRenderMode.value).toBe(1);
    expect(pipe.glowMaterial.uniforms.uRenderMode.value).toBe(0);
    expect(pipe.coreMaskMaterial.uniforms.uRenderMode.value).toBe(2);
  });

  // Integer-uniform precision must match between vert and frag. ShaderMaterial
  // auto-injects `precision highp int;` into both stages; RawShaderMaterial
  // doesn't, and the default int precision diverges per stage (vert: highp,
  // frag: mediump on some platforms) — so any shared int uniform (uRenderMode,
  // uSpectMask, uHideFocusIdx, uPinFocusToCenter) trips the linker's
  // "Precisions of uniform ... differ between VERTEX and FRAGMENT shaders."
  // check and the program won't link. Pin the explicit precision in both
  // sources.
  it('star.vert.glsl and star.frag.glsl both declare precision highp int', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const vert = readFileSync(join(here, 'star.vert.glsl'), 'utf8');
    const frag = readFileSync(join(here, 'star.frag.glsl'), 'utf8');
    expect(vert).toMatch(/precision\s+highp\s+int\s*;/);
    expect(frag).toMatch(/precision\s+highp\s+int\s*;/);
  });

  // Vertex-attribute budget. WebGL2 guarantees only MAX_VERTEX_ATTRIBS >= 16,
  // and many real GPUs (Apple Silicon, Intel iGPUs) report exactly 16. Our
  // star pipeline uses RawShaderMaterial precisely so three.js doesn't auto-
  // inject `attribute vec3 position; attribute vec3 normal; attribute vec2
  // uv;` into the vertex prefix — those three locations would otherwise be
  // burned without being read by the shader. If a future change swaps the
  // material back to ShaderMaterial, raise `INJECTED` to 3; if WebGL2's
  // minimum spec gets bumped, raise `LIMIT`. Crossing either threshold
  // silently is what culled every star in the eclipse-photometry land —
  // this test makes the budget explicit.
  it('star.vert.glsl in-declaration count fits inside the WebGL2 attribute budget', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, 'star.vert.glsl'), 'utf8');
    // The shader has two compile variants keyed on LOCAL_DEPTH_PASS
    // (main pass vs the local-pass mirror draw); each must fit the
    // budget on its own. Resolve the #ifdef/#ifndef/#else blocks for
    // that one macro and count `in` declarations per variant.
    const declaredInVariant = (localPass: boolean): number => {
      const stack: boolean[] = [];
      let count = 0;
      for (const line of src.split('\n')) {
        const t = line.trim();
        if (t.startsWith('#ifdef LOCAL_DEPTH_PASS')) { stack.push(localPass); continue; }
        if (t.startsWith('#ifndef LOCAL_DEPTH_PASS')) { stack.push(!localPass); continue; }
        if (t.startsWith('#else')) { stack.push(!stack.pop()!); continue; }
        if (t.startsWith('#endif')) { stack.pop(); continue; }
        if (stack.every(Boolean) && /^in\s/.test(line)) count++;
      }
      return count;
    };
    const INJECTED = 0; // RawShaderMaterial; ShaderMaterial would be 3.
    const LIMIT = 16;   // WebGL2 minimum MAX_VERTEX_ATTRIBS.
    expect(declaredInVariant(false) + INJECTED).toBeLessThanOrEqual(LIMIT);
    expect(declaredInVariant(true) + INJECTED).toBeLessThanOrEqual(LIMIT);
  });

  // The GLSL literal can't read the TS constant, so pin the two sides
  // together here: a MIRROR_CAPACITY change must touch the shader's
  // uniform array length and its suppression loop in the same diff.
  it('star.vert.glsl sizes uLocalMemberIdx to MIRROR_CAPACITY', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, 'star.vert.glsl'), 'utf8');
    expect(src).toContain(`uniform int uLocalMemberIdx[${MIRROR_CAPACITY}];`);
    expect(src).toContain(`for (int k = 0; k < ${MIRROR_CAPACITY}; k++)`);
  });

  it('binds the caller-owned localPositions buffer to iPosition', () => {
    const opts = makeOpts(2);
    opts.localPositions.set([1, 2, 3, 4, 5, 6]);
    const pipe = new StarPipeline(opts);
    const attr = pipe.geometry.getAttribute('iPosition') as THREE.InstancedBufferAttribute;
    expect(attr).toBe(pipe.iPositionAttr);
    // Buffer identity preserved — recenterOrigin rewrites this same
    // Float32Array in place and bumps needsUpdate.
    expect(attr.array).toBe(opts.localPositions);
    expect(attr.usage).toBe(THREE.DynamicDrawUsage);
  });

  it('binds the caller-owned compositeSuppress buffer to iCompositeSuppress', () => {
    const opts = makeOpts(3);
    opts.compositeSuppress.set([1, 0, 1]);
    const pipe = new StarPipeline(opts);
    const attr = pipe.geometry.getAttribute('iCompositeSuppress') as THREE.InstancedBufferAttribute;
    expect(attr).toBe(pipe.iCompositeSuppressAttr);
    expect(attr.array).toBe(opts.compositeSuppress);
    expect(attr.usage).toBe(THREE.DynamicDrawUsage);
  });

  it('configures disc material with calibrated blend defaults', () => {
    const pipe = new StarPipeline(makeOpts());
    expect(pipe.discMaterial.blending).toBe(THREE.CustomBlending);
    expect(pipe.discMaterial.blendSrc).toBe(THREE.OneFactor);
    expect(pipe.discMaterial.blendDst).toBe(THREE.OneFactor);
    expect(pipe.discMaterial.blendEquation).toBe(THREE.MaxEquation);
    expect(pipe.discMaterial.depthWrite).toBe(true);
    expect(pipe.discMaterial.depthTest).toBe(true);
    expect(pipe.discMaterial.transparent).toBe(true);
  });

  it('configures glow material as additive with depth-test only', () => {
    const pipe = new StarPipeline(makeOpts());
    expect(pipe.glowMaterial.blending).toBe(THREE.AdditiveBlending);
    expect(pipe.glowMaterial.depthWrite).toBe(false);
    expect(pipe.glowMaterial.depthTest).toBe(true);
    expect(pipe.glowMaterial.transparent).toBe(true);
  });

  it('configures core-mask material as depth-only (colorWrite off)', () => {
    const pipe = new StarPipeline(makeOpts());
    expect(pipe.coreMaskMaterial.depthWrite).toBe(true);
    expect(pipe.coreMaskMaterial.depthTest).toBe(true);
    expect(pipe.coreMaskMaterial.colorWrite).toBe(false);
  });

  it('setMonochromeBlend(true) swaps disc + glow into multiply', () => {
    const pipe = new StarPipeline(makeOpts());
    pipe.setMonochromeBlend(true);
    expect(pipe.discMaterial.blending).toBe(THREE.MultiplyBlending);
    expect(pipe.discMaterial.depthWrite).toBe(false);
    expect(pipe.discMaterial.depthTest).toBe(false);
    expect(pipe.glowMaterial.blending).toBe(THREE.MultiplyBlending);
    expect(pipe.glowMaterial.depthTest).toBe(false);
    // Without this three.js drops the blendFunc entirely and the discs
    // draw with the previous material's state — see disc-blend.test.ts.
    expect(pipe.discMaterial.premultipliedAlpha).toBe(true);
    expect(pipe.glowMaterial.premultipliedAlpha).toBe(true);
  });

  it('setMonochromeBlend(false) restores the calibrated defaults', () => {
    const pipe = new StarPipeline(makeOpts());
    pipe.setMonochromeBlend(true);
    pipe.setMonochromeBlend(false);
    expect(pipe.discMaterial.blending).toBe(THREE.CustomBlending);
    expect(pipe.discMaterial.blendEquation).toBe(THREE.MaxEquation);
    expect(pipe.discMaterial.depthWrite).toBe(true);
    expect(pipe.discMaterial.depthTest).toBe(true);
    expect(pipe.glowMaterial.blending).toBe(THREE.AdditiveBlending);
    expect(pipe.glowMaterial.depthTest).toBe(true);
    expect(pipe.discMaterial.premultipliedAlpha).toBe(false);
    expect(pipe.glowMaterial.premultipliedAlpha).toBe(false);
  });

  it('dispose() releases geometry + all three materials and detaches meshes', () => {
    const opts = makeOpts();
    const pipe = new StarPipeline(opts);
    const geomSpy = vi.spyOn(pipe.geometry, 'dispose');
    const discSpy = vi.spyOn(pipe.discMaterial, 'dispose');
    const glowSpy = vi.spyOn(pipe.glowMaterial, 'dispose');
    const maskSpy = vi.spyOn(pipe.coreMaskMaterial, 'dispose');

    pipe.dispose();

    expect(geomSpy).toHaveBeenCalledOnce();
    expect(discSpy).toHaveBeenCalledOnce();
    expect(glowSpy).toHaveBeenCalledOnce();
    expect(maskSpy).toHaveBeenCalledOnce();
    expect(opts.scene.children).toHaveLength(0);
  });
});
