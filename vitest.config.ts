import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e-*.test.ts', 'tests/pressure.test.ts'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: [
        'scripts/lib/**/*.mjs',
        'hud/**/*.mjs',
        'src/**/*.ts',
      ],
      exclude: [
        'node_modules/**',
        'bridge/**',
        'tests/**',
      ],
      thresholds: {
        statements: 30,
        branches: 25,
        functions: 30,
        lines: 30,
      },
    },
  },
});
