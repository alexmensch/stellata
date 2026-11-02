import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { holdLocks, lockSpecs, type Release } from './locks';

describe('lockSpecs', () => {
  it('takes its own lock exclusive and the others shared, all in step-name order', () => {
    expect(lockSpecs({ own: 'sid:stamp', shared: ['build:catalog', 'build:binaries'] }))
      .toEqual(['sh:build-binaries', 'sh:build-catalog', 'ex:sid-stamp']);
  });

  it('holds a step it also reads from exclusive, once', () => {
    expect(lockSpecs({ own: 'a', shared: ['a', 'b'] })).toEqual(['ex:a', 'sh:b']);
  });
});

describe('holdLocks', () => {
  let dir: string;
  const quiet = (): void => {};

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'locks-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function race(first: Promise<Release>, second: () => Promise<Release>, holdMs: number): Promise<string[]> {
    const events: string[] = [];
    const releaseFirst = await first;
    events.push('first acquired');
    const pending = second().then((release) => { events.push('second acquired'); return release; });
    await new Promise((r) => setTimeout(r, holdMs));
    events.push('first releasing');
    await releaseFirst();
    await (await pending)();
    return events;
  }

  it('serialises two holders of one step\'s exclusive lock', async () => {
    const events = await race(
      holdLocks(dir, { own: 'a', shared: [] }, quiet),
      () => holdLocks(dir, { own: 'a', shared: [] }, quiet),
      300,
    );
    expect(events).toEqual(['first acquired', 'first releasing', 'second acquired']);
  });

  it('keeps a writer out while a reader holds its shared lock', async () => {
    const events = await race(
      holdLocks(dir, { own: 'reader', shared: ['writer'] }, quiet),
      () => holdLocks(dir, { own: 'writer', shared: [] }, quiet),
      300,
    );
    expect(events).toEqual(['first acquired', 'first releasing', 'second acquired']);
  });

  it('lets two readers of one writer run together', async () => {
    const events = await race(
      holdLocks(dir, { own: 'r1', shared: ['writer'] }, quiet),
      () => holdLocks(dir, { own: 'r2', shared: ['writer'] }, quiet),
      300,
    );
    expect(events).toEqual(['first acquired', 'second acquired', 'first releasing']);
  });

  it('tells the caller when it has to wait', async () => {
    const release = await holdLocks(dir, { own: 'a', shared: [] }, quiet);
    let waited = false;
    const second = holdLocks(dir, { own: 'a', shared: [] }, () => { waited = true; });
    await new Promise((r) => setTimeout(r, 1300));
    await release();
    await (await second)();
    expect(waited).toBe(true);
  });
});
