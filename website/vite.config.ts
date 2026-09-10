import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import vue from 'unplugin-vue/vite';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' ? '/Lattice/' : '/',
  root: resolve(import.meta.dirname),
  publicDir: false,
  plugins: [vue()],
  build: {
    outDir: resolve(import.meta.dirname, '..', 'build'),
    emptyOutDir: true,
  },
});
