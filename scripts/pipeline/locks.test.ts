import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { holdLocks, lockSpecs, type HeldLocks } from './locks';

describe('lockSpecs', () => {
  it('takes its own lock exclusive and the others shared, all in step-name order', () => {
    expect(lockSpecs({ step: 'build:clouds', exclusive: true, shared: ['build:catalog', 'build:binaries'] }))
      .toEqual(['sh:build-binaries', 'sh:build-catalog', 'ex:build-clouds']);
  });

  it('holds a step it also reads from exclusive, once', () => {
    expect(lockSpecs({ step: 'a', exclusive: true, shared: ['a', 'b'] })).toEqual(['ex:a', 'sh:b']);
  });

  it('takes only the shared locks for a checked manual step', () => {
    expect(lockSpecs({ step: 'refresh:astro', exclusive: false, shared: ['build:request'] })).toEqual(['sh:build-request']);
  });
});

describe('holdLocks', () => {
  let dir: string;
  const quiet = (): void => {};

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'locks-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function race(first: Promise<HeldLocks>, second: () => Promise<HeldLocks>, holdMs: number): Promise<string[]> {
    const events: string[] = [];
    const held = await first;
    events.push('first acquired');
    const pending = second().then((h) => { events.push('second acquired'); return h; });
    await new Promise((r) => setTimeout(r, holdMs));
    events.push('first releasing');
    await held.release();
    await (await pending).release();
    return events;
  }

  it('serialises two holders of one step\'s exclusive lock', async () => {
    const events = await race(
      holdLocks(dir, { step: 'a', exclusive: true, shared: [] }, quiet),
      () => holdLocks(dir, { step: 'a', exclusive: true, shared: [] }, quiet),
      300,
    );
    expect(events).toEqual(['first acquired', 'first releasing', 'second acquired']);
  });

  it('keeps a writer out while a reader holds its shared lock', async () => {
    const events = await race(
      holdLocks(dir, { step: 'reader', exclusive: true, shared: ['writer'] }, quiet),
      () => holdLocks(dir, { step: 'writer', exclusive: true, shared: [] }, quiet),
      300,
    );
    expect(events).toEqual(['first acquired', 'first releasing', 'second acquired']);
  });

  it('lets two readers of one writer run together', async () => {
    const events = await race(
      holdLocks(dir, { step: 'r1', exclusive: true, shared: ['writer'] }, quiet),
      () => holdLocks(dir, { step: 'r2', exclusive: true, shared: ['writer'] }, quiet),
      300,
    );
    expect(events).toEqual(['first acquired', 'second acquired', 'first releasing']);
  });

  it('tells the caller when it has to wait', async () => {
    const first = await holdLocks(dir, { step: 'a', exclusive: true, shared: [] }, quiet);
    let waited = false;
    const second = holdLocks(dir, { step: 'a', exclusive: true, shared: [] }, () => { waited = true; });
    await new Promise((r) => setTimeout(r, 1300));
    await first.release();
    await (await second).release();
    expect(waited).toBe(true);
  });

  it('reports a holder killed mid-step, still releases, and frees the lock', async () => {
    const held = await holdLocks(dir, { step: 'a', exclusive: true, shared: [] }, quiet);
    process.kill(held.pid, 'SIGKILL');
    const next = await holdLocks(dir, { step: 'a', exclusive: true, shared: [] }, quiet);
    expect(held.died()).toBe(true);
    await held.release();
    await next.release();
    expect(next.died()).toBe(false);
  });
});
