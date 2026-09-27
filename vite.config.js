import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` emits a single self-contained dist/index.html that can be
// opened directly from disk (no server needed) or hosted anywhere.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 4000,
    reportCompressedSize: false,
  },
  server: { host: true, open: true },
});
