import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/server',
  // SWC (not esbuild) compiles the API so Nest gets the decorator metadata it needs to inject by type.
  esbuild: false as const,
  plugins: [
    swc.vite({
      jsc: { target: 'es2022', parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } },
    }),
    nxViteTsPaths(),
  ],
  test: {
    name: 'server',
    watch: false,
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    include: ['src/**/*.spec.ts', 'test/**/*.{spec,e2e-spec}.ts'],
    reporters: ['default'],
  },
}));
