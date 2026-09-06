import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In production the site is a separate static host and calls the backend through
// VITE_API_BASE; in development Vite proxies the same paths to a local backend instead.
const backend = process.env['KONMAI_HOST_URL'] ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '^/api/': backend,
      '^/icons/': backend,
      '^/d/': backend,
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
