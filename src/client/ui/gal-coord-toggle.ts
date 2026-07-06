import {
  setGalCoordFormat,
  getGalCoordFormat,
  onGalCoordFormatChange,
  type GalCoordFormat,
} from './gal-coord-format';

export function bindGalCoordFormatToggle() {
  const host = document.getElementById('gal-coord-toggle')!;
  const buttons = host.querySelectorAll<HTMLButtonElement>('button[data-galfmt]');
  const sync = () => {
    const f = getGalCoordFormat();
    buttons.forEach((btn) => btn.classList.toggle('on', btn.dataset.galfmt === f));
  };
  for (const btn of Array.from(buttons)) {
    btn.addEventListener('click', () => setGalCoordFormat(btn.dataset.galfmt as GalCoordFormat));
  }
  onGalCoordFormatChange(sync);
  sync();
}
