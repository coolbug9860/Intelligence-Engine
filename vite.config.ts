import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // NOTE: No `define` block here — GEMINI_API_KEY and all secrets live
  // server-side only (server.ts reads process.env directly at runtime).
  // Never put API keys in the Vite define block; they get baked into the
  // public JS bundle and are readable by anyone in DevTools.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
  },
});
