import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
