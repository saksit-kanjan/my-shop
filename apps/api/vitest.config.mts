import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/api',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'api',
    watch: false,
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    include: ['src/**/*.{test,spec}.ts'],
    reporters: ['default'],
  },
}));
