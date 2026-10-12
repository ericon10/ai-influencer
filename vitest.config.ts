import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'src/studio/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
})
