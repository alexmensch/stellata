import * as THREE from 'three';
import type { Stellata } from '../../stellata';
import { type DebugSection, buildDiagnosticReadout } from '../../debug/debug-panel';
import { DUST_STEPS } from '../../star-pipeline/extinction/dust-raymarch-pure';
import { ARCMIN_TO_RAD, PINNED_CELL_RAD } from './froxel-pins';

// Froxel-fill geometry + rebuild-rate readout. The rebuild rate is half the
// measurement: a view-parameterised grid rebuilds on any camera change, so
// "fills per 60 frames" going to zero on an idle camera is the property the
// design gate traded the displacement-ε predicate for.

const WINDOW_FRAMES = 60;

export function buildFroxelSection(stellata: Stellata): DebugSection {
  let visible = true;
  let windowFrames = 0;
  let windowFills = 0;
  let lastFills = 0;
  let fillsPerWindow = 0;
  const abs = new THREE.Vector3();

  const { root, body } = buildDiagnosticReadout({
    onResetLatches: () => { windowFrames = 0; windowFills = 0; fillsPerWindow = 0; },
  });

  const onFrame = () => {
    const spike = stellata.froxelFill;
    if (spike === null) {
      if (visible) body.textContent = 'froxel fill: no dust field attached';
      return;
    }
    const stats = spike.stats(stellata.camera, stellata.absCameraPosition(abs));
    windowFrames++;
    windowFills += stats.fills - lastFills;
    lastFills = stats.fills;
    if (windowFrames >= WINDOW_FRAMES) {
      fillsPerWindow = windowFills;
      windowFrames = 0;
      windowFills = 0;
    }

    if (!visible) return;

    const prepassFetches = stellata.catalog.count * DUST_STEPS;
    const cells = stats.cellsX * stats.cellsY;
    body.textContent =
      `fill: ${stats.enabled ? 'ON' : 'OFF'}   ` +
      `stellata.setFroxelFillEnabled(${stats.enabled ? 'false' : 'true'})\n` +
      `bench: debug.froxelBench()\n` +
      `\n` +
      `cell ${(PINNED_CELL_RAD / ARCMIN_TO_RAD).toFixed(2)}'  ` +
      `fov ${stellata.camera.fov.toFixed(1)}°  ` +
      `aspect ${stellata.camera.aspect.toFixed(3)}  ` +
      `dpr ${stellata.renderer.getPixelRatio()}\n` +
      `grid ${stats.cellsX}x${stats.cellsY} x${stats.slices} = ` +
      `${(cells / 1e3).toFixed(1)}k cells, ${(stats.texels / 1e6).toFixed(2)}M texels, ` +
      `${stats.mib.toFixed(1)} MiB\n` +
      `\n` +
      `fill step ${stats.fillStepPc.toFixed(2)} pc  ` +
      `axis ray ${stats.axisSamples ?? 'misses coverage'} samples\n` +
      `predicted ${(stats.predictedFetches / 1e6).toFixed(1)}M fetches/fill = ` +
      `${(stats.predictedFetches / prepassFetches).toFixed(1)}x the star prepass\n` +
      `\n` +
      `fills total ${stats.fills}  per ${WINDOW_FRAMES} frames ${fillsPerWindow}`;
    root.style.color = stats.enabled && fillsPerWindow > 0 ? '#0f0' : '#999';
  };

  const unsubscribe = stellata.on('frame', onFrame);

  return {
    element: root,
    dispose: () => { unsubscribe(); },
    setVisible: (v: boolean) => { visible = v; },
  };
}
