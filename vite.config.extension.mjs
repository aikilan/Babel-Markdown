import { defineConfig } from 'vite';
import { builtinModules } from 'module';
import { resolve } from 'path';

const external = [
  'vscode',
  ...builtinModules,
  ...builtinModules.map((mod) => `node:${mod}`),
];

export default defineConfig({
  ssr: {
    noExternal: ['markdown-it', 'sanitize-html'],
  },
  build: {
    ssr: true,
    lib: {
      entry: resolve(__dirname, 'src/extension.ts'),
      formats: ['cjs'],
      fileName: () => 'extension.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'node18',
    rollupOptions: {
      external,
      output: {
        entryFileNames: 'extension.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        exports: 'named',
      },
    },
  },
});
