import type { Stellata } from '../stellata';
import type { DebugSection } from '../debug/debug-panel';
import {
  formatRate,
  toLocalDatetimeValue,
  parseLocalDatetimeValue,
  TRANSPORT_BUTTONS,
} from './time';

// Debug-panel "Time" section: transport controls over the VirtualClock
// behind Stellata.getT(). Lets a developer scrub binary orbits and planet
// positions far faster than 1:1 wall-clock. The rate readout updates on
// each action; the virtual instant itself is shown by the always-on main
// #time-readout. See src/client/solar-system/README.md § Time scrubber.

export function buildTimeSection(stellata: Stellata): DebugSection {
  const clock = stellata.timeClock;
  const body = document.createElement('div');

  const readout = document.createElement('div');
  readout.style.cssText =
    'font-family:monospace; font-size:14px; text-align:center; margin-bottom:6px;';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:4px; margin-bottom:8px;';

  const makeButton = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.style.cssText = 'flex:1; padding:4px 0; cursor:pointer; font-size:13px;';
    b.addEventListener('click', () => { onClick(); refresh(); });
    return b;
  };

  const buttons: Partial<Record<string, HTMLButtonElement>> = {};
  for (const spec of TRANSPORT_BUTTONS) {
    buttons[spec.action] = makeButton(spec.glyph, spec.title, () => {
      clock[spec.action]();
      if (spec.action === 'reset') { syncPickerToClock(); error.textContent = ''; }
    });
  }
  const playBtn = buttons.play!;
  const pauseBtn = buttons.pause!;
  row.append(buttons.rewind!, playBtn, pauseBtn, buttons.fastForward!, buttons.reset!);

  const jumpRow = document.createElement('div');
  jumpRow.style.cssText = 'display:flex; gap:4px; align-items:center;';
  const jumpInput = document.createElement('input');
  jumpInput.type = 'datetime-local';
  jumpInput.step = '1';
  jumpInput.style.cssText = 'flex:1; min-width:0; font-family:monospace; font-size:11px; padding:3px;';
  const syncPickerToClock = (): void => {
    jumpInput.value = toLocalDatetimeValue(stellata.getT() * 1000);
  };
  syncPickerToClock();
  const jumpBtn = document.createElement('button');
  jumpBtn.type = 'button';
  jumpBtn.textContent = 'Jump';
  jumpBtn.style.cssText = 'cursor:pointer; padding:3px 8px; font-size:11px;';
  jumpRow.append(jumpInput, jumpBtn);

  const error = document.createElement('div');
  error.style.cssText = 'color:#c00; font-size:10px; min-height:13px; margin-top:2px;';

  const doJump = (): void => {
    const ms = parseLocalDatetimeValue(jumpInput.value);
    if (Number.isNaN(ms)) { error.textContent = 'Pick a date first'; return; }
    error.textContent = '';
    clock.setTimeAbsolute(ms / 1000);
    refresh();
  };
  jumpBtn.addEventListener('click', doJump);
  jumpInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJump(); });

  function refresh(): void {
    const rate = clock.getRate();
    readout.textContent = formatRate(rate);
    playBtn.disabled = rate > 0;
    pauseBtn.disabled = rate === 0;
  }
  refresh();

  body.append(readout, row, jumpRow, error);

  return {
    element: body,
    dispose: () => {},
    setVisible: () => {},
  };
}
