// Brand-box info modal (About + Credits tabs) plus the Share affordance.
// See src/client/modals/README.md.

import { bindModalDismissal } from './modal-dismiss';

const SHARE_REST = '⧉';
const SHARE_OK = '✓';
const SHARE_FAIL = '⨯';
const SHARE_FLASH_MS = 1500;

type Tab = 'about' | 'credits';

export function bindBrandModals(starCount: number) {
  const aboutBtn = document.getElementById('brand-about')!;
  const aboutModal = document.getElementById('about-modal')!;
  const versionEl = document.getElementById('about-version');
  if (versionEl) versionEl.textContent = `v${import.meta.env.VITE_APP_VERSION}`;
  const starCountEl = document.getElementById('about-star-count');
  if (starCountEl) starCountEl.textContent = starCount.toLocaleString();

  const tabAbout = document.getElementById('about-tab-about')!;
  const tabCredits = document.getElementById('about-tab-credits')!;
  const paneAbout = document.getElementById('about-pane')!;
  const paneCredits = document.getElementById('credits-pane')!;
  const showTab = (which: Tab) => {
    const isAbout = which === 'about';
    paneAbout.hidden = !isAbout;
    paneCredits.hidden = isAbout;
    tabAbout.classList.toggle('is-active', isAbout);
    tabCredits.classList.toggle('is-active', !isAbout);
    tabAbout.setAttribute('aria-selected', isAbout ? 'true' : 'false');
    tabCredits.setAttribute('aria-selected', isAbout ? 'false' : 'true');
  };
  tabAbout.addEventListener('click', () => showTab('about'));
  tabCredits.addEventListener('click', () => showTab('credits'));

  const aboutHandle = bindModalDismissal(aboutModal);
  aboutBtn.addEventListener('click', () => {
    showTab('about');
    aboutHandle.open();
  });

  const shareBtn = document.getElementById('brand-share');
  const glyphEl = shareBtn?.querySelector<HTMLElement>('.share-glyph') ?? null;
  if (shareBtn && glyphEl) {
    let revertTimer: number | undefined;
    const flash = (g: string) => {
      glyphEl.textContent = g;
      if (revertTimer !== undefined) window.clearTimeout(revertTimer);
      revertTimer = window.setTimeout(() => {
        glyphEl.textContent = SHARE_REST;
        revertTimer = undefined;
      }, SHARE_FLASH_MS);
    };
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        flash(SHARE_OK);
      } catch {
        flash(SHARE_FAIL);
      }
    });
  }
}
