import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/webview/translationPreview.ts'),
      formats: ['iife'],
      name: 'TranslationPreview',
      fileName: () => 'translationPreview.js',
    },
    outDir: 'dist/webview',
    emptyOutDir: false,
    sourcemap: true,
    target: 'es2019',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
