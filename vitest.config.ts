import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/**/*.test.ts'],
    // tests/README.md#suite-wide-timeouts.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/client/**/*.ts', 'scripts/**/*.ts'],
      exclude: [
        'src/client/main.ts',
        'src/client/stellata.ts',
        'src/worker.ts',
        '**/*.test.ts',
        '**/*.d.ts',
        'scripts/dust/sync-dust.ts',
        'scripts/catalog/validate/verify-catalog.ts',
      ],
    },
  },
});
