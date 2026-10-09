import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// O build vai direto para o dist/ da raiz, servido pela API em /c/:token e /assets/*.
export default defineConfig({
  plugins: [preact()],
  base: '/',
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
  },
});
