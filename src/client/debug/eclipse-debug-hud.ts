// Eclipse-photometry diagnostic HUD: live per-relation gate/geometry
// readout for the focused star (or all active dims when unfocused).

import type { Stellata } from '../stellata';
import { type DebugSection, buildDiagnosticReadout } from './debug-panel';
import { AU_PC } from '../util/astronomy-constants';

const UPDATE_EVERY_N_FRAMES = 12;

export function buildEclipseSection(stellata: Stellata): DebugSection {
  let visible = true;
  let frameCount = 0;

  const { root, body } = buildDiagnosticReadout({ onResetLatches: () => {} });

  const tintLabel = document.createElement('label');
  tintLabel.style.cssText =
    'display:flex;align-items:center;gap:6px;margin-bottom:6px;'
    + 'cursor:pointer;user-select:none;';
  const tintBox = document.createElement('input');
  tintBox.type = 'checkbox';
  tintBox.addEventListener('change', () => {
    stellata.setDebugDepthBias(tintBox.checked);
  });
  tintLabel.appendChild(tintBox);
  tintLabel.appendChild(document.createTextNode('tint disc cores by depthBias (back=red)'));
  root.insertBefore(tintLabel, body);

  const au = (pc: number) => (pc / AU_PC).toPrecision(3);

  const onFrame = () => {
    if (!visible || frameCount++ % UPDATE_EVERY_N_FRAMES !== 0) return;
    const focus = stellata.getFocusedStar();
    const rows = stellata.eclipseDebugRows(focus);
    const lines = [
      `focus: ${focus ?? 'none'}  active dims: ${stellata.eclipseActiveDimCount}`,
      `relations ${focus === null ? '(cleared gates or dimmed)' : 'touching focus'}: ${rows.length}`,
      '',
    ];
    for (const r of rows.slice(0, 12)) {
      const head = `${r.primaryIdx}→${r.secondaryIdx} T${r.tier}`;
      if (r.gate !== 'clear') {
        const dot = r.planeDot !== null
          ? ` |dotN|=${r.planeDot.toFixed(3)}>${r.sinLimit.toFixed(3)}`
          : '';
        lines.push(`${head} skip:${r.gate}${dot}`);
        continue;
      }
      const res = r.result!;
      const alphaSum = res.alphaPri + res.alphaSec;
      lines.push(
        `${head} d=${au(r.dCamPc)}AU |rel|=${au(r.relPc)}AU Σr=${au(r.discSumPc)}AU`,
      );
      lines.push(
        `  θ/Σα=${alphaSum > 0 ? (res.thetaRad / alphaSum).toFixed(3) : '—'}`
        + ` front=${res.front === 'primary' ? 'pri' : 'sec'}`
        + ` dim→${res.dim.toFixed(3)}`
        + ` buf=${r.bufPrimary.toFixed(3)}/${r.bufSecondary.toFixed(3)}`,
      );
      lines.push(
        `  bias=${r.biasPrimary.toExponential(1)}/${r.biasSecondary.toExponential(1)}`,
      );
    }
    if (rows.length > 12) lines.push(`… +${rows.length - 12} more`);
    body.textContent = lines.join('\n');
  };

  const unsubscribe = stellata.on('frame', onFrame);

  return {
    element: root,
    dispose: () => { unsubscribe(); stellata.setDebugDepthBias(false); },
    setVisible: (v: boolean) => { visible = v; },
  };
}
