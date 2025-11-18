import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/webview/exportBridge.ts'),
      formats: ['iife'],
      name: 'BabelMarkdownExportBridge',
      fileName: () => 'exportBridge.js',
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
