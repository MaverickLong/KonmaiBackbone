import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// During development the host backend is reached through Vite's proxy so the same-origin
// assumptions of the production setup (nginx in front of both) hold.
const backend = process.env['KONMAI_HOST_URL'] ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '^/api/': backend,
      '^/icons/': backend,
      '^/d/': backend,
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
