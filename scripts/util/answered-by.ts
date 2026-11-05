// Which network services answered a TypeScript pull, handed back to record.ts through a file. See README.md (answered-by.ts entry).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const ANSWERED_BY_ENV = 'PIPELINE_ANSWERED_BY';

export function readAnsweredBy(file: string): string[] {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as string[] : [];
}

/** Records nothing outside `record.ts`, which names the file. */
export function reportService(name: string): void {
  const file = process.env[ANSWERED_BY_ENV];
  if (!file) return;
  const answered = readAnsweredBy(file);
  if (!answered.includes(name)) writeFileSync(file, JSON.stringify([...answered, name]));
}
