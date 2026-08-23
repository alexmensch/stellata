import { defineConfig } from 'vitest/config';

// Standalone so the runner sits outside the repo's include globs and never
// costs `pnpm test` a file. Imports are relative, so root staying here is
// fine.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['.claude/skills/decode-view/*.decode.ts'],
    // Without this the decode never reaches the terminal: vitest buffers
    // console output from passing tests and drops it.
    disableConsoleIntercept: true,
    testTimeout: 30_000,
  },
});
