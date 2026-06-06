import { defineConfig } from 'vitest/config';

// Server-side unit + property tests. Node environment (these services use fs,
// process.env, fetch — no DOM). Only *.test.ts files are collected, so the
// production build module graph is untouched.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
