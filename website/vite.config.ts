import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' ? '/Lattice/' : '/',
  root: resolve(import.meta.dirname),
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, '..', 'build'),
    emptyOutDir: true,
  },
});
