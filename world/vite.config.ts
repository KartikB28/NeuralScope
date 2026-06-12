import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'node:path';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    fs: { allow: [path.resolve(__dirname, '..')] },
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:43117', ws: true },
      '/api': { target: 'http://127.0.0.1:43117' },
    },
  },
});
