// heavy.sh against a private queue folder, a stub command that logs overlap, and a load read from a file.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HEAVY = join(__dirname, 'heavy.sh');

const STUB = `echo "start $1" >> log
sleep "$2"
echo "done $1" >> log
exit "\${3:-0}"
`;

interface Run {
  code: number | null;
  stderr: string;
}

let dir: string;
let queue: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'heavy-'));
  queue = join(dir, 'queue');
  writeFileSync(join(dir, 'stub.sh'), STUB);
  writeFileSync(join(dir, 'load'), '0.5');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function heavy(label: string, seconds: number, opts: { slots?: number; exit?: number; loadWaitS?: number } = {}) {
  const child = spawn('bash', [HEAVY, 'sh', 'stub.sh', label, String(seconds), String(opts.exit ?? 0)], {
    cwd: dir,
    env: {
      ...process.env,
      HEAVY_DIR: queue,
      HEAVY_SLOTS: String(opts.slots ?? 1),
      HEAVY_CORES: '4',
      HEAVY_POLL_S: '0.1',
      HEAVY_LOAD_WAIT_S: String(opts.loadWaitS ?? 600),
      HEAVY_LOAD_CMD: `cat ${join(dir, 'load')}`,
    },
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const done = new Promise<Run>((resolve) => child.on('close', (code) => resolve({ code, stderr })));
  return { child, done };
}

const log = (): string[] => {
  try {
    return readFileSync(join(dir, 'log'), 'utf8').trim().split('\n');
  } catch {
    return [];
  }
};
const tickets = (): string[] => readdirSync(queue).filter((name) => name !== '.lock');
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean): Promise<void> {
  while (!pred()) await pause(50);
}

describe('heavy.sh', () => {
  it("returns the command's exit status and frees its slot", async () => {
    const run = await heavy('a', 0, { exit: 3 }).done;
    expect(run.code).toBe(3);
    expect(log()).toEqual(['start a', 'done a']);
    expect(tickets()).toEqual([]);
  });

  it('a waiter blocks until the holder exits, and holders start in arrival order', async () => {
    const a = heavy('a', 1);
    await until(() => log().length > 0);
    const b = heavy('b', 0);
    await until(() => tickets().length === 2);
    const c = heavy('c', 0);
    await Promise.all([a.done, b.done, c.done]);
    expect(log()).toEqual(['start a', 'done a', 'start b', 'done b', 'start c', 'done c']);
    expect(tickets()).toEqual([]);
  }, 30_000);

  it('runs at most HEAVY_SLOTS commands at once', async () => {
    const runs = [heavy('a', 1, { slots: 2 }), heavy('b', 1, { slots: 2 }), heavy('c', 1, { slots: 2 })];
    await Promise.all(runs.map((r) => r.done));
    let live = 0;
    const concurrency = log().map((l) => (live += l.startsWith('start') ? 1 : -1));
    expect(Math.max(...concurrency)).toBe(2);
    expect(tickets()).toEqual([]);
  }, 30_000);

  it('never admits more than HEAVY_SLOTS when many arrive together', async () => {
    const runs = Array.from({ length: 8 }, (_, i) => heavy(`r${i}`, 0.3, { slots: 2 }));
    await Promise.all(runs.map((r) => r.done));
    let live = 0;
    const concurrency = log().map((l) => (live += l.startsWith('start') ? 1 : -1));
    expect(Math.max(...concurrency)).toBe(2);
    expect(tickets()).toEqual([]);
  }, 60_000);

  it("clears a dead holder's ticket", async () => {
    const dead = spawnSync('true').pid;
    spawnSync('mkdir', ['-p', queue]);
    writeFileSync(join(queue, `1000000000000000000.${dead}`), 'gone');
    const run = await heavy('a', 0).done;
    expect(run.code).toBe(0);
    expect(run.stderr).toContain(`clearing the dead holder ${dead}`);
    expect(tickets()).toEqual([]);
  });

  it('a holder waits while load is at or above the core count', async () => {
    writeFileSync(join(dir, 'load'), '4.0');
    const a = heavy('a', 0);
    await pause(1000);
    expect(log()).toEqual([]);
    writeFileSync(join(dir, 'load'), '3.9');
    expect((await a.done).code).toBe(0);
    expect(log()).toEqual(['start a', 'done a']);
  }, 30_000);

  it('runs anyway once the load wait runs out', async () => {
    writeFileSync(join(dir, 'load'), '9');
    const run = await heavy('a', 0, { loadWaitS: 0 }).done;
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('running anyway');
    expect(log()).toEqual(['start a', 'done a']);
  }, 30_000);

  it.each([
    ['SIGTERM', 143],
    ['SIGINT', 130],
    ['SIGHUP', 129],
  ] as const)('%s on a running holder stops every process it started and frees its slot', async (signal, code) => {
    const marker = `30.${process.pid}${Math.floor(Math.random() * 1e6)}`;
    const a = heavy('a', Number(marker));
    await until(() => log().length > 0);
    a.child.kill(signal);
    expect((await a.done).code).toBe(code);
    expect(tickets()).toEqual([]);
    expect(spawnSync('pgrep', ['-f', `sleep ${marker}`]).status).toBe(1);
  }, 20_000);

  it('a waiter stopped by TERM leaves the queue', async () => {
    const a = heavy('a', 1);
    await until(() => log().length > 0);
    const b = heavy('b', 0);
    await until(() => tickets().length === 2);
    b.child.kill('SIGTERM');
    expect((await b.done).code).toBe(143);
    await a.done;
    expect(log()).toEqual(['start a', 'done a']);
    expect(tickets()).toEqual([]);
  }, 30_000);
});
