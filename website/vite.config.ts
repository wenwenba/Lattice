import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname),
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, '..', 'build'),
    emptyOutDir: true,
  },
});
