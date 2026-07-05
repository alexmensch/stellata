import { describe, it, expect } from 'vitest';
import { bindShiftPan } from './shift-pan';

type FakeControls = { noPan: boolean; keys: string[] };

function setup() {
  const controls: FakeControls = { noPan: false, keys: [] };
  const target = new EventTarget();
  const dispose = bindShiftPan(controls as never, target);
  const key = (type: 'keydown' | 'keyup', code: string) => {
    const e = new Event(type);
    (e as unknown as { code: string }).code = code;
    target.dispatchEvent(e);
  };
  return { controls, key, dispose };
}

describe('bindShiftPan', () => {
  it('starts with pan disabled and the pan slot bound to Shift', () => {
    const { controls } = setup();
    expect(controls.noPan).toBe(true);
    expect(controls.keys[2]).toBe('ShiftLeft');
  });

  it('enables pan while a Shift key is held and disables it on release', () => {
    const { controls, key } = setup();
    key('keydown', 'ShiftLeft');
    expect(controls.noPan).toBe(false);
    key('keyup', 'ShiftLeft');
    expect(controls.noPan).toBe(true);
  });

  it('retargets the pan slot to whichever Shift is pressed', () => {
    const { controls, key } = setup();
    key('keydown', 'ShiftRight');
    expect(controls.keys[2]).toBe('ShiftRight');
    expect(controls.noPan).toBe(false);
  });

  it('ignores non-Shift keys', () => {
    const { controls, key } = setup();
    key('keydown', 'KeyA');
    expect(controls.noPan).toBe(true);
  });

  it('detaches its listeners on dispose', () => {
    const { controls, key, dispose } = setup();
    dispose();
    key('keydown', 'ShiftLeft');
    expect(controls.noPan).toBe(true);
  });
});
