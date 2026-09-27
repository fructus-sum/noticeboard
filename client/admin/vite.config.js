import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  base: '/admin/',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../../shared'),   // the repository's shared/ (public values only)
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
