import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const webPkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const corePkg = JSON.parse(readFileSync(new URL('../../packages/core/package.json', import.meta.url), 'utf-8'));

// Friendlier names than the npm package names, for the About page's credits
// list — same handful of direct runtime dependencies across web + core
// (core isn't separately published/licensed, it's bundled straight into the
// app), not a transitive-dependency audit.
const DISPLAY_NAMES: Record<string, string> = {
  react: 'React',
  'react-dom': 'React DOM',
  'kokoro-js': 'Kokoro TTS',
  'pdfjs-dist': 'PDF.js',
  idb: 'idb',
};

function licenseOf(depName: string): string {
  const pkg = JSON.parse(readFileSync(new URL(`../../node_modules/${depName}/package.json`, import.meta.url), 'utf-8'));
  return pkg.license ?? 'Unknown';
}

const directDepNames = [
  ...Object.keys(webPkg.dependencies as Record<string, string>),
  ...Object.keys(corePkg.dependencies as Record<string, string>),
].filter((name) => !name.startsWith('@lingxi/'));

const thirdPartyLicenses = [...new Set(directDepNames)].map((name) => ({
  name: DISPLAY_NAMES[name] ?? name,
  license: licenseOf(name),
}));

export default defineConfig({
  plugins: [react()],
  worker: {
    // Kokoro TTS runs inside a Worker (see src/tts/kokoro/kokoro.worker.ts) so
    // ONNX inference never blocks the UI thread. kokoro-js/@huggingface
    // transformers are ESM packages, so the worker bundle must be ESM too.
    format: 'es',
  },
  optimizeDeps: {
    // onnxruntime-web resolves its WASM binary at runtime via a path that
    // esbuild's dependency pre-bundling doesn't handle correctly.
    exclude: ['onnxruntime-web'],
  },
  define: {
    __APP_VERSION__: JSON.stringify(webPkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __THIRD_PARTY_LICENSES__: JSON.stringify(thirdPartyLicenses),
  },
});
