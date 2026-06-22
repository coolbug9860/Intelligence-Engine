import { defineConfig } from 'vitest/config';

// Server-side unit + property tests. Node environment (these services use fs,
// process.env, fetch — no DOM). Only *.test.ts files are collected, so the
// production build module graph is untouched.
export default defineConfig({
  test: {
    environment: 'node',
    // Server/service tests run in node (default). Component tests opt into a
    // jsdom environment per-file via a `// @vitest-environment jsdom` docblock.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
