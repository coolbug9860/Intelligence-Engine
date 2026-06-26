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
  build: {
    rollupOptions: {
      output: {
        // Split large, rarely-changing vendor code into separate cacheable
        // chunks. Keeps the main app chunk small and silences Render's
        // >500 KB single-bundle warning.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Keep html2canvas in its own async chunk (it's dynamically imported
          // only for snapshot export — must NOT be pulled into eager vendor).
          if (id.includes('html2canvas')) return;
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) {
            return 'react-vendor';
          }
          if (id.includes('motion') || id.includes('framer-motion')) return 'motion';
          if (id.includes('lucide-react')) return 'icons';
          return 'vendor';
        },
      },
    },
  },
});
