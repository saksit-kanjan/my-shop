/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  // Served under /admin/ by the shop server, next to the POS at / and the display at /display/.
  base: '/admin/',
  cacheDir: '../../node_modules/.vite/apps/backoffice',
  server: {
    port: 4202,
    host: 'localhost',
    proxy: { '/api': 'http://localhost:3000' },
  },
  preview: { port: 4302, host: 'localhost' },
  plugins: [react(), tailwindcss(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  build: {
    outDir: '../../dist/apps/backoffice',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: { transformMixedEsModules: true },
  },
}));
