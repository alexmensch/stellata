// The GLSL chunks mirror numbers that also live in TypeScript. Nothing
// at compile time ties the two sides together, so pin them here.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { L_THRESH, LUMA_WEIGHTS, TOE_CURVATURE } from '../tonemap-pure';
import {
  LUMA_CEIL,
  extendedThresholdSbFromSolidAngle,
  footprintRadiusPc,
  pxPerRadianFromSolidAngle,
} from './emission-pure';
import '../hdr-pipeline';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

const tonemapChunk = read('../tonemap.glsl');
const emissionChunk = read('./emission.glsl');
const extendedEmitterChunk = read('./extended-emitter.glsl');

function lumaWeights(chunk: string): number[] {
  const m = chunk.match(
    /const vec3 STELLATA_LUMA_WEIGHTS = vec3\(([^)]+)\);/,
  );
  if (m === null) throw new Error('STELLATA_LUMA_WEIGHTS not declared');
  return m[1].split(',').map((s) => Number(s.trim()));
}

describe('shared chunk constants', () => {
  it('both chunks declare the same Rec.709 luma weights as tonemap-pure', () => {
    expect(lumaWeights(tonemapChunk)).toEqual([...LUMA_WEIGHTS]);
    expect(lumaWeights(emissionChunk)).toEqual([...LUMA_WEIGHTS]);
  });

  it('tonemap.glsl runs the same faint-end toe as tonemap-pure', () => {
    const knee = tonemapChunk.match(/const float STELLATA_TOE_KNEE = ([\d.]+);/);
    const curvature = tonemapChunk.match(
      /const float STELLATA_TOE_CURVATURE = ([\d.]+);/,
    );
    const magPerLog2 = tonemapChunk.match(
      /const float STELLATA_MAG_PER_LOG2 = ([\d.]+);/,
    );
    expect(knee).not.toBeNull();
    expect(curvature).not.toBeNull();
    expect(magPerLog2).not.toBeNull();
    expect(Number(knee![1])).toBe(L_THRESH);
    expect(Number(curvature![1])).toBeCloseTo(TOE_CURVATURE, 6);
    expect(Number(magPerLog2![1])).toBeCloseTo(2.5 * Math.log10(2), 6);
  });

  it('emission.glsl clamps at the same ceiling as emission-pure', () => {
    const m = emissionChunk.match(/const float STELLATA_LUMA_CEIL = ([\d.]+);/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(LUMA_CEIL);
  });

  // The plate scale a layer recovers from uOmegaPxArcsec2. Its arcsec
  // conversion is a GLSL literal, so nothing but this pins it to
  // ARCSEC_TO_RAD — and a wrong plate scale mis-sizes a resolution floor
  // silently rather than failing to compile.
  it('emission.glsl recovers px-per-radian exactly as emission-pure does', () => {
    const m = emissionChunk.match(
      /const float STELLATA_ARCSEC_TO_RAD = ([\d.e-]+);/,
    );
    expect(m).not.toBeNull();
    const arcsecToRad = Number(m![1]);
    for (const omega of [4, 40, 4_000, 40_000]) {
      const shader = 1 / (arcsecToRad * Math.sqrt(omega));
      expect(shader).toBeCloseTo(pxPerRadianFromSolidAngle(omega), 6);
    }
  });

  // The isobar reads the extended-source threshold back out of the same
  // uniform the gain runs on, and the log conversion is a GLSL literal — so
  // nothing but this pins it to Math.log10. Ω = 0 is in the sweep because
  // both sides floor it: the CPU mirror silently returned -Infinity until
  // this case existed.
  it('emission.glsl recovers the extended threshold exactly as emission-pure does', () => {
    const m = emissionChunk.match(/const float STELLATA_LOG10 = ([\d.]+);/);
    expect(m).not.toBeNull();
    const log10 = Number(m![1]);
    for (const omega of [0, 4, 40_000, 478_630.09]) {
      const shader = 7.8 + (2.5 * Math.log(Math.max(omega, 1e-12))) / log10;
      expect(shader).toBeCloseTo(extendedThresholdSbFromSolidAngle(omega, 7.8), 9);
    }
    expect(Number.isFinite(extendedThresholdSbFromSolidAngle(0, 7.8))).toBe(true);
  });

  // How far a raymarch step smooths its profile, and therefore whether the
  // display convolution averages a resolved field or an aliased cusp
  // (summation/README.md § Footprint). Both the √12 and the arcsec
  // conversion are GLSL literals; too small leaves the cusp, too large dims
  // the core, and neither failure mode stops the shader compiling.
  it('emission.glsl derives the same footprint radius as emission-pure does', () => {
    const sqrt12 = emissionChunk.match(/const float STELLATA_SQRT12 = ([\d.]+);/);
    const arcsec = emissionChunk.match(/const float STELLATA_ARCSEC_TO_RAD = ([\d.e-]+);/);
    expect(sqrt12).not.toBeNull();
    expect(arcsec).not.toBeNull();
    expect(Number(sqrt12![1])).toBeCloseTo(Math.sqrt(12), 12);
    for (const omega of [4, 4_000, 40_000]) {
      for (const distancePc of [1, 785_000, 2_000_000]) {
        const pxPerRadian = 1 / (Number(arcsec![1]) * Math.sqrt(omega));
        const shader = distancePc / (pxPerRadian * Number(sqrt12![1]));
        expect(shader).toBeCloseTo(footprintRadiusPc(distancePc, omega), 6);
      }
    }
  });

  // A stage that pastes the unit already has ln(10) and π in scope, so a
  // local copy is both redundant and free to drift to fewer digits — which
  // is what two of these had done. Redeclaring one is legal GLSL and
  // silently shadows nothing, so only this catches it.
  it('no consumer of the unit redeclares a constant it already has', () => {
    for (const stage of [
      '../../star-pipeline/star.vert.glsl',
      '../../solar-system/planets/glare/planet.vert.glsl',
      '../../milkyway/milkyway.frag.glsl',
      '../../local-group/emission/local-group-emission.frag.glsl',
      '../../local-group/emission/local-group-emission.vert.glsl',
    ]) {
      const src = read(stage);
      // Directly, or through the composite that pulls the unit in.
      expect(src).toMatch(/#include <stellata_(hdr_emission|extended_emitter)>/);
      expect(src).not.toMatch(/const float (LOG10|PI_CONST|PI)\s*=/);
    }
  });
});

// Both chunks can land in one fragment stage from H4 on (a per-pixel
// magnitude needs the unit and the operator together), and three pastes
// every #include textually — so each declaration has to be guarded, and
// the two weight declarations have to share one guard.
describe('include guards', () => {
  const guarded = (chunk: string, macro: string) =>
    new RegExp(`#ifndef ${macro}\\s*\\n#define ${macro}`).test(chunk);

  it('guards each chunk against double inclusion', () => {
    expect(guarded(tonemapChunk, 'STELLATA_TONEMAP')).toBe(true);
    expect(guarded(emissionChunk, 'STELLATA_HDR_EMISSION')).toBe(true);
    expect(guarded(extendedEmitterChunk, 'STELLATA_EXTENDED_EMITTER')).toBe(true);
  });

  it('shares one guard for the duplicated luma-weight declaration', () => {
    for (const chunk of [tonemapChunk, emissionChunk]) {
      expect(guarded(chunk, 'STELLATA_LUMA_WEIGHTS_DECLARED')).toBe(true);
    }
  });

  it('closes every #ifndef it opens', () => {
    for (const chunk of [tonemapChunk, emissionChunk, extendedEmitterChunk]) {
      const opens = chunk.match(/^#ifndef /gm)?.length ?? 0;
      const closes = chunk.match(/^#endif/gm)?.length ?? 0;
      expect(closes).toBe(opens);
    }
  });

  // Keeps the guards' reason alive: stellata_extended_emitter pulls both
  // into one stage, and the LG vertex stage takes the unit on its own for
  // the plate scale — so a fragment stage gets stellata_hdr_emission from
  // two paste paths at once.
  it('the composite chunk pulls both into one stage', () => {
    expect(extendedEmitterChunk).toContain('#include <stellata_hdr_emission>');
    expect(extendedEmitterChunk).toContain('#include <stellata_tonemap>');
  });

  it('has live consumers on both the composite and the bare unit', () => {
    expect(read('../../milkyway/milkyway.frag.glsl'))
      .toContain('#include <stellata_extended_emitter>');
    expect(read('../../local-group/emission/local-group-emission.frag.glsl'))
      .toContain('#include <stellata_extended_emitter>');
    expect(read('../../local-group/emission/local-group-emission.vert.glsl'))
      .toContain('#include <stellata_hdr_emission>');
  });
});

// An unregistered or misspelled chunk name throws inside the renderer's
// program build — first frame on a GPU, which CI does not have. Resolve
// the same way three does (recursively, through the real ShaderChunk
// registry) so the name is checked here instead.
describe('chunk resolution', () => {
  const resolve = (src: string): string =>
    src.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => {
      const chunk = (THREE.ShaderChunk as Record<string, string>)[name];
      if (chunk === undefined) throw new Error(`Can not resolve #include <${name}>`);
      return resolve(chunk);
    });

  const STAGES = [
    '../../milkyway/milkyway.frag.glsl',
    '../../local-group/emission/local-group-emission.frag.glsl',
    '../../local-group/emission/local-group-emission.vert.glsl',
  ];

  it('every stellata include on an extended-source stage resolves', () => {
    for (const stage of STAGES) {
      const resolved = resolve(read(stage));
      expect(resolved).not.toMatch(/#include\s*<stellata_/);
    }
  });

  it('the composite pulls its callees in ahead of the call', () => {
    for (const stage of STAGES.slice(0, 2)) {
      const resolved = resolve(read(stage));
      expect(resolved.indexOf('float stellataSurfaceBrightnessLuminance('))
        .toBeLessThan(resolved.indexOf('void stellataEmitExtendedSource('));
      expect(resolved.indexOf('vec3 stellataTonemapUndithered('))
        .toBeLessThan(resolved.indexOf('void stellataEmitExtendedSource('));
    }
  });

  // The luma weights land in the resolved text twice — once per chunk —
  // and the shared guard is what makes the second paste inert. Assert the
  // guard reaches the stage, not the text count.
  it('carries the shared guard onto every stage that pastes both chunks', () => {
    for (const stage of STAGES.slice(0, 2)) {
      const resolved = resolve(read(stage));
      expect(resolved).toContain('#ifndef STELLATA_LUMA_WEIGHTS_DECLARED');
    }
  });
});
