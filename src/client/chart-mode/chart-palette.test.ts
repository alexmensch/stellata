import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHART_PAPER, paperClearColour } from './chart-palette';

const PAPER_DISPLAY = [245 / 255, 242 / 255, 234 / 255];

/** What the WebGL backend writes: `Color.getRGB` in the renderer's output
 *  space, since the chart clear lands on the canvas and not a target
 *  (three's `getUnlitUniformColorSpace`). */
function webglClearsWith(c: THREE.Color): number[] {
  const rgb = { r: 0, g: 0, b: 0 };
  c.getRGB(rgb, THREE.SRGBColorSpace);
  return [rgb.r, rgb.g, rgb.b];
}

/** What the WebGPU backend writes: the working-space components verbatim
 *  (`Background.update` → `renderer._clearColor.getRGB`, whose default
 *  space is the working one — `outputColorSpace` never enters). */
function webgpuClearsWith(c: THREE.Color): number[] {
  return [c.r, c.g, c.b];
}

describe('the chart paper reaches the canvas as its authored value', () => {
  it('lands on #f5f2ea through the WebGL clear', () => {
    const written = webglClearsWith(paperClearColour(THREE.SRGBColorSpace));
    for (let i = 0; i < 3; i++) expect(written[i]).toBeCloseTo(PAPER_DISPLAY[i], 5);
  });

  // The boot pins outputColorSpace to the working space, so nothing on that
  // path encodes the clear — the ported shaders own their own transfer
  // (`../webgpu/README.md` § Output colour space).
  it('lands on #f5f2ea through the WebGPU clear', () => {
    const written = webgpuClearsWith(paperClearColour(THREE.LinearSRGBColorSpace));
    for (let i = 0; i < 3; i++) expect(written[i]).toBeCloseTo(PAPER_DISPLAY[i], 5);
  });

  // The regression this pins: the authored hex read in the default space is
  // the linear decode, which the WebGPU clear wrote straight out as #e9e2d2.
  it('is what a space-agnostic read of the hex would have got wrong', () => {
    const naive = new THREE.Color(CHART_PAPER);
    expect(webgpuClearsWith(naive)[0]).toBeLessThan(PAPER_DISPLAY[0] - 0.03);
    expect(new THREE.Color().setRGB(naive.r, naive.g, naive.b, THREE.SRGBColorSpace)
      .getHex(THREE.SRGBColorSpace)).toBe(0xe9e2d2);
  });
});
