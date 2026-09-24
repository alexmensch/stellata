// build-seed.sh against a stub checkout whose build:stamped is a sleep that flags any overlap.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const STUB = `mkdir live 2>/dev/null || echo overlap >> log
echo start >> log
trap 'rmdir live; exit 143' TERM
sleep "$STUB_SECONDS" & wait $!
rmdir live
echo done >> log
exit "\${STUB_EXIT:-0}"
`;

interface Run {
  code: number | null;
  stdout: string;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'build-seed-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(join(__dirname, 'build-seed.sh'), join(dir, 'scripts', 'build-seed.sh'));
  writeFileSync(join(dir, 'stub.sh'), STUB);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { 'build:stamped': 'sh stub.sh' } }));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seed(seconds: number, exit = 0): Promise<Run> {
  const child = spawn('bash', [join(dir, 'scripts', 'build-seed.sh')], {
    env: { ...process.env, STUB_SECONDS: String(seconds), STUB_EXIT: String(exit) },
  });
  let stdout = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  return new Promise((resolve) => child.on('close', (code) => resolve({ code, stdout })));
}

const log = (): string[] => readFileSync(join(dir, 'log'), 'utf8').trim().split('\n');
const entries = (): string[] => readdirSync(join(dir, 'build', 'build-seed'));

async function untilStarted(): Promise<void> {
  for (;;) {
    try {
      if (log().includes('start')) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('build-seed.sh', () => {
  it("returns the build's exit status and leaves no entry", async () => {
    const run = await seed(0, 3);
    expect(run.code).toBe(3);
    expect(entries()).toEqual([]);
  });

  it("stops an older run's build before starting its own", async () => {
    const older = seed(10);
    await untilStarted();
    const [a, b] = await Promise.all([older, seed(0)]);
    expect(a.code).toBe(0);
    expect(a.stdout).toContain('superseded by a newer build:seed');
    expect(b.code).toBe(0);
    expect(log()).toEqual(['start', 'start', 'done']);
    expect(entries()).toEqual([]);
  }, 30_000);

  it('never runs two builds at once when several start together', async () => {
    const runs = await Promise.all([seed(1), seed(1), seed(1)]);
    expect(runs.map((r) => r.code)).toEqual([0, 0, 0]);
    expect(log()).not.toContain('overlap');
    expect(log().filter((line) => line === 'done')).toHaveLength(1);
    expect(entries()).toEqual([]);
  }, 30_000);

  it('removes and ignores an entry whose run is dead', async () => {
    const dead = spawnSync('true').pid;
    mkdirSync(join(dir, 'build', 'build-seed'), { recursive: true });
    writeFileSync(join(dir, 'build', 'build-seed', `1.${dead}`), '');
    const run = await seed(0);
    expect(run.code).toBe(0);
    expect(log()).toEqual(['start', 'done']);
    expect(entries()).toEqual([]);
  });
});
