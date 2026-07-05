import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';

// Make camera translation explicit: orbit on a plain drag, pan only while
// a Shift key is held. See src/client/camera/controls/README.md § Shift-drag
// panning.

// TrackballControls forces any drag into a pan while keys[STATE.PAN] is the
// held key AND noPan is false; STATE.PAN is index 2 of the keys array. Its
// own keydown/keyup run in the bubble phase, so a capture-phase listener
// (which fires first) can retarget the slot to whichever Shift is down and
// lift the noPan gate before TrackballControls reads them.
const PAN_KEY_SLOT = 2;

function isShift(code: string): boolean {
  return code === 'ShiftLeft' || code === 'ShiftRight';
}

export function bindShiftPan(
  controls: TrackballControls,
  target: EventTarget = window,
): () => void {
  // Off by default: a plain drag orbits and right-drag no longer secretly
  // pans. A held Shift lifts the gate for the duration of that press only.
  controls.noPan = true;
  controls.keys = ['', '', 'ShiftLeft'];

  const onKeyDown = (e: Event) => {
    const code = (e as KeyboardEvent).code;
    if (!isShift(code)) return;
    controls.keys[PAN_KEY_SLOT] = code;
    controls.noPan = false;
  };
  const onKeyUp = (e: Event) => {
    if (!isShift((e as KeyboardEvent).code)) return;
    controls.noPan = true;
  };

  target.addEventListener('keydown', onKeyDown, { capture: true });
  target.addEventListener('keyup', onKeyUp, { capture: true });
  return () => {
    target.removeEventListener('keydown', onKeyDown, { capture: true });
    target.removeEventListener('keyup', onKeyUp, { capture: true });
  };
}
