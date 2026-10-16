// Copies onnxruntime-web's WASM runtime into public/ort so Vite's dev server
// can serve it directly — optimizeDeps.exclude: ['onnxruntime-web'] in
// vite.config.ts means these can't be imported straight out of node_modules.
// Plain fs calls (no shell) so this runs identically on Windows/macOS/Linux.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const destDir = join(here, '..', 'public', 'ort');

// npm workspaces hoist shared deps to the repo root node_modules; only fall
// back to the local one if a workspace install ever de-hoists it.
const candidates = [
  join(here, '..', '..', '..', 'node_modules', 'onnxruntime-web', 'dist'),
  join(here, '..', 'node_modules', 'onnxruntime-web', 'dist'),
];
const srcDir = candidates.find((dir) => existsSync(dir));
if (!srcDir) {
  throw new Error('Could not find onnxruntime-web/dist — run npm install first.');
}

const files = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];

mkdirSync(destDir, { recursive: true });
for (const file of files) {
  copyFileSync(join(srcDir, file), join(destDir, file));
}
