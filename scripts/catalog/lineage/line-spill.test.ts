import { existsSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { LineSpill } from './line-spill';
import { encodeLineageLine, paramsText, type LineageLine } from './lineage-row-pure';

const line = (key: string, params: Record<string, string> = {}): LineageLine => encodeLineageLine({
  stage: 'demo', key, role: 'outcome', code: 'demo.kept', params: paramsText(params), evidence: ['gaia:1'],
}) as LineageLine;

describe('LineSpill', () => {
  const spills: LineSpill[] = [];
  const spill = (batch?: number): LineSpill => {
    const s = new LineSpill(batch);
    spills.push(s);
    return s;
  };
  afterEach(() => {
    for (const s of spills.splice(0)) s.dispose();
  });

  it('gives back every line in push order, across batch boundaries', () => {
    const s = spill(2);
    const lines = ['spine:3', 'spine:1', 'spine:2', 'spine:5', 'spine:4'].map((k) => line(k, { av: '0.0123' }));
    for (const l of lines) s.push(l);
    expect(s.lines()).toEqual(lines);
  });

  it('round-trips characters past ASCII', () => {
    const s = spill();
    const lines = [line('name:α Cen'), line('spine:\u{1F600}')];
    for (const l of lines) s.push(l);
    expect(s.lines()).toEqual(lines);
  });

  it('gives back no lines when none were pushed', () => {
    expect(spill().lines()).toEqual([]);
  });

  it('refuses a line pushed after its lines were read', () => {
    const s = spill();
    s.lines();
    expect(() => s.push(line('spine:1'))).toThrow(/pushed after its lines were read/);
  });

  it('dispose deletes its file and may be called again', () => {
    const s = new LineSpill();
    expect(existsSync(s.dir)).toBe(true);
    s.dispose();
    s.dispose();
    expect(existsSync(s.dir)).toBe(false);
  });
});
