// First-class time-scrubber widget in the bottom-right meta slot: collapsed
// star-count + live-UTC readout ⇄ app-styled transport controls (T key /
// click the readout). See src/client/solar-system/README.md § Time scrubber widget.

import type { Stellata } from '../stellata';
import { createTimeReadout, formatTimeReadout } from './time-readout';
import {
  TRANSPORT_BUTTONS,
  toLocalDatetimeValue,
  parseLocalDatetimeValue,
  type TransportAction,
} from './time';
import { formatRatePerSecond } from './time-scrubber-widget-pure';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Monochrome line-art transport glyphs (currentColor stroke, styled in
// styles.css § .transport-icon) matching the app's thin-line iconography.
// viewBox 0 0 24 24; every glyph fills the box so reset reads at the same
// weight and size as the triangle/chevron controls.
const TRANSPORT_ICON_PATHS: Record<TransportAction, string[]> = {
  rewind: ['M18 6 L12 12 L18 18', 'M11 6 L5 12 L11 18'],
  play: ['M8 6 L18 12 L8 18 Z'],
  pause: ['M9 6 L9 18', 'M15 6 L15 18'],
  fastForward: ['M6 6 L12 12 L6 18', 'M13 6 L19 12 L13 18'],
  reset: ['M3.51 15a9 9 0 1 0 2.13-9.36L1 10', 'M1 4 L1 10 L7 10'],
};

function transportIcon(action: TransportAction): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('class', 'transport-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of TRANSPORT_ICON_PATHS[action]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

export interface TimeScrubberWidgetDeps {
  meta: HTMLElement;
  stellata: Stellata;
  countLabel: string;
}

export interface TimeScrubberWidget {
  open(): void;
  close(): void;
  toggle(): void;
}

export function createTimeScrubberWidget(
  { meta, stellata, countLabel }: TimeScrubberWidgetDeps,
): TimeScrubberWidget {
  const clock = stellata.timeClock;

  // Collapsed view: star count + live UTC readout (the readout doubles as the
  // open trigger).
  const collapsed = document.createElement('div');
  collapsed.className = 'meta-collapsed';
  const count = document.createElement('div');
  count.className = 'meta-count';
  count.textContent = countLabel;
  const readout = document.createElement('button');
  readout.type = 'button';
  readout.id = 'time-readout';
  readout.className = 'time-readout time-readout-btn';
  readout.title = 'Open time scrubber';
  collapsed.append(count, readout);

  // Expanded view: the scrubber, hidden until opened.
  const scrubber = document.createElement('div');
  scrubber.className = 'scrubber';
  scrubber.hidden = true;

  const header = document.createElement('div');
  header.className = 'scrubber-header';
  const clockReadout = document.createElement('div');
  clockReadout.className = 'time-readout scrubber-time';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'scrubber-close';
  closeBtn.title = 'Close scrubber';
  closeBtn.textContent = '×';
  header.append(clockReadout, closeBtn);

  const rate = document.createElement('div');
  rate.className = 'scrubber-rate';

  const controls = document.createElement('div');
  controls.className = 'scrubber-controls';
  const buttons: Partial<Record<string, HTMLButtonElement>> = {};
  for (const spec of TRANSPORT_BUTTONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'scrubber-btn';
    b.appendChild(transportIcon(spec.action));
    b.title = spec.title;
    b.addEventListener('click', () => {
      clock[spec.action]();
      if (spec.action === 'reset') syncJump();
      refresh();
    });
    controls.append(b);
    buttons[spec.action] = b;
  }

  const jumpRow = document.createElement('div');
  jumpRow.className = 'scrubber-jump';
  const jumpInput = document.createElement('input');
  jumpInput.type = 'datetime-local';
  jumpInput.step = '1';
  const jumpBtn = document.createElement('button');
  jumpBtn.type = 'button';
  jumpBtn.className = 'scrubber-jump-btn';
  jumpBtn.textContent = 'Jump';
  jumpRow.append(jumpInput, jumpBtn);

  const syncJump = (): void => {
    jumpInput.value = toLocalDatetimeValue(stellata.getT() * 1000);
  };
  const doJump = (): void => {
    const ms = parseLocalDatetimeValue(jumpInput.value);
    if (Number.isNaN(ms)) return;
    clock.setTimeAbsolute(ms / 1000);
    refresh();
  };
  jumpBtn.addEventListener('click', doJump);
  jumpInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJump(); });

  scrubber.append(header, rate, controls, jumpRow);
  meta.replaceChildren(collapsed, scrubber);

  // The collapsed readout ticks live UTC on its own interval (harmless while
  // the scrubber is open and the collapsed view is hidden).
  createTimeReadout({ el: readout, stellata });

  // While open, refresh the model-time readout each second; the rate readout
  // and button-disabled states update on demand via refresh().
  let expandedTimer: number | null = null;
  const refresh = (): void => {
    const r = clock.getRate();
    rate.textContent = formatRatePerSecond(r);
    buttons.play!.disabled = r > 0;
    buttons.pause!.disabled = r === 0;
  };
  const tickExpanded = (): void => {
    clockReadout.textContent = formatTimeReadout(stellata.getT());
  };

  const open = (): void => {
    if (!scrubber.hidden) return;
    collapsed.hidden = true;
    scrubber.hidden = false;
    syncJump();
    refresh();
    tickExpanded();
    expandedTimer = window.setInterval(tickExpanded, 1000);
  };
  const close = (): void => {
    if (scrubber.hidden) return;
    scrubber.hidden = true;
    collapsed.hidden = false;
    if (expandedTimer !== null) {
      clearInterval(expandedTimer);
      expandedTimer = null;
    }
  };
  const toggle = (): void => { if (scrubber.hidden) open(); else close(); };

  readout.addEventListener('click', open);
  closeBtn.addEventListener('click', close);

  return { open, close, toggle };
}
