// Eclipse-photometry diagnostic HUD: live per-relation gate/geometry
// readout for the focused star (or all active dims when unfocused).

import type { Stellata } from '../stellata';
import { STAR_PASS_DISC } from '../star-pipeline/star-pass';
import { type DebugSection, buildDiagnosticReadout, setReadoutText } from './debug-panel';
import { AU_PC } from '../util/astronomy-constants';

const UPDATE_EVERY_N_FRAMES = 12;

export function buildEclipseSection(stellata: Stellata): DebugSection {
  let visible = true;
  let frameCount = 0;

  const { root, body } = buildDiagnosticReadout({ onResetLatches: () => {} });

  const au = (pc: number) => (pc / AU_PC).toPrecision(3);

  // The disc/glow routing each member resolves to, and how far it sits
  // from the band a partially eclipsed star used to vanish in. Only the
  // BACK member carries a dim, and only a glow-routed one can be moved
  // by it, so the verdict leads with which of those is missing — the
  // band renders identically either side of itself and a bare ratio
  // leaves you guessing which way to move.
  const route = (label: string, idx: number, dim: number) => {
    const r = stellata.starPassRoutingFor(idx, dim);
    const back = dim < 1;
    const head = `${back ? '>' : ' '}${label}`
      + ` ${r.routed === STAR_PASS_DISC ? 'DISC' : 'GLOW'} r=${r.physRatio.toFixed(3)}`;
    const threshold = r.trapBelowDim === null
      ? null
      : `trap<${r.trapBelowDim.toFixed(3)}`;
    if (!back) {
      return `${head}  no dim${threshold === null ? '' : `; would ${threshold}`}`;
    }
    if (r.routed === STAR_PASS_DISC) return `${head}  disc ignores the dim, back off`;
    if (r.trap) return `${head}  <TRAP>`;
    return threshold === null
      ? `${head}  unreachable, close in`
      : `${head}  now ${dim.toFixed(3)}, ${threshold}`;
  };

  const onFrame = () => {
    if (!visible || frameCount++ % UPDATE_EVERY_N_FRAMES !== 0) return;
    const focus = stellata.focus.getFocusedStar();
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
      lines.push(route('pri', r.primaryIdx, r.bufPrimary));
      lines.push(route('sec', r.secondaryIdx, r.bufSecondary));
    }
    if (rows.length > 12) lines.push(`… +${rows.length - 12} more`);
    setReadoutText(body, lines.join('\n'));
  };

  const unsubscribe = stellata.on('frame', onFrame);

  return {
    element: root,
    dispose: () => { unsubscribe(); },
    setVisible: (v: boolean) => { visible = v; },
  };
}
