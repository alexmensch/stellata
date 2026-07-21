import { bindModalDismissal } from './modal-dismiss';
import { shouldAdviseMobile } from './mobile-advisory-pure';

const STORAGE_KEY = 'stellata.mobile-advisory-dismissed';

/** Show the mobile / small-screen advisory splash if the device looks
 *  like a bare touch device on a narrow viewport. Returns true when the
 *  splash was shown, so the caller can suppress the welcome modal.
 *  Dismissal is per-session (`sessionStorage`), not per-browser — the
 *  underlying viewport constraint is still there on the next visit, so
 *  the advisory re-competes with the welcome modal for the one splash
 *  slot every session instead of ceding it permanently after one close. */
export function maybeShowMobileAdvisory(): boolean {
  if (sessionStorage.getItem(STORAGE_KEY) === '1') return false;

  const signalsAvailable = typeof window.matchMedia === 'function';
  const advise = shouldAdviseMobile({
    width: window.innerWidth,
    coarsePointer: signalsAvailable && window.matchMedia('(pointer: coarse)').matches,
    hasTouch: navigator.maxTouchPoints > 0,
    signalsAvailable,
  });
  if (!advise) return false;

  const modal = document.getElementById('mobile-advisory-modal')!;
  const handle = bindModalDismissal(modal, {
    beforeClose: () => sessionStorage.setItem(STORAGE_KEY, '1'),
  });
  handle.open();
  return true;
}
