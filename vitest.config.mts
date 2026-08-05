import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Every mock is created per-test; never let one leak into the next.
    restoreMocks: true,
    unstubEnvs: true,
    // A deliberately non-UTC zone. The action always reasons in UTC, so a test
    // that only passes when local time is UTC is a test that is hiding a bug.
    env: {
      TZ: 'Pacific/Auckland',
    },
  },
});
