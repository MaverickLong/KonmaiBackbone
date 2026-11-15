import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In production the site is a separate static host and calls the backend through
// VITE_API_BASE; in development Vite proxies the same paths to a local backend instead.
const backend = process.env['KONMAI_HOST_URL'] ?? 'http://127.0.0.1:3000';

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '^/api/': backend,
      '^/icons/': backend,
      '^/d/': backend,
    },
  },
  // The server-side build is the prerender script. It stays out of the directory the web server
  // hands out.
  build: isSsrBuild
    ? { outDir: 'dist-prerender', copyPublicDir: false }
    : { outDir: 'dist', sourcemap: true },
  // The script carries its dependencies, because one file starts several times faster than a
  // thousand modules. React picks its development or production build by NODE_ENV as it loads;
  // fixing that here keeps the choice from depending on how the script is started.
  ssr: { noExternal: true },
  define: isSsrBuild ? { 'process.env.NODE_ENV': '"production"' } : {},
}));
