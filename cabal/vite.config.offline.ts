import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: 'dist-offline',
    rollupOptions: {
      input: 'offline-sign.html',
    },
  },
  define: {
    global: 'globalThis',
  },
});
