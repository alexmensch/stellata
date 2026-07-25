// Probe-name SVG labels, one per drawn marker. See README.md § Labels.

import * as THREE from 'three';
import type { Stellata } from '../../stellata';
import { setStyle } from '../../overlays/dirty-attr';
import { LABEL_OFFSET_PX } from '../planets/planet-labels';
import { probeLabelText } from './probe-trajectory';

export function createProbeLabels(stellata: Stellata): void {
  const group = document.getElementById('probe-labels') as unknown as SVGGElement | null;
  if (!group) return;

  const entries: SVGTextElement[] = [];
  const tmp = new THREE.Vector3();

  function rebuildEntries(): void {
    for (const el of entries) el.remove();
    entries.length = 0;
    const NS = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < stellata.probeField.probeCount(); i++) {
      const text = document.createElementNS(NS, 'text') as SVGTextElement;
      text.setAttribute('class', 'probe-label');
      text.setAttribute('text-anchor', 'start');
      text.setAttribute('dominant-baseline', 'central');
      group!.appendChild(text);
      entries.push(text);
    }
  }

  // Poison sentinel so the first matching-state write still lands — the
  // container carries no inline display in index.html, so a boolean
  // initialised to `false` would no-op the first hide (same shape as the
  // planet-label group gate).
  let lastGroupDisplay = '\0';
  function setGroupVisible(on: boolean): void {
    lastGroupDisplay = setStyle(group!, 'display', on ? '' : 'none', lastGroupDisplay);
  }
  setGroupVisible(false);

  stellata.on('frame', () => {
    if (entries.length !== stellata.probeField.probeCount()) rebuildEntries();
    if (entries.length === 0 || stellata.getMonochrome()
        || !stellata.detailPermits('probeLabels')) {
      setGroupVisible(false);
      return;
    }
    const camera = stellata.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    setGroupVisible(true);
    for (let i = 0; i < entries.length; i++) {
      const el = entries[i];
      // Always-on while the marker is drawn: a probe is a discovery
      // affordance and its glyph carries no name of its own, so there is
      // no resolvability gate beyond the marker's own visibility.
      if (!stellata.probeField.localPositionInto(i, tmp)) {
        el.style.display = 'none';
        continue;
      }
      const traj = stellata.probeField.probeAt(i);
      if (traj === null) {
        el.style.display = 'none';
        continue;
      }
      const label = probeLabelText(traj, stellata.getT());
      if (el.textContent !== label) el.textContent = label;
      tmp.applyMatrix4(camera.matrixWorldInverse);
      if (tmp.z >= -camera.near) {
        el.style.display = 'none';
        continue;
      }
      tmp.applyMatrix4(camera.projectionMatrix);
      el.style.display = '';
      el.setAttribute('x', ((tmp.x + 1) * 0.5 * w + LABEL_OFFSET_PX).toFixed(1));
      el.setAttribute('y', ((1 - tmp.y) * 0.5 * h + LABEL_OFFSET_PX).toFixed(1));
    }
  });
}
