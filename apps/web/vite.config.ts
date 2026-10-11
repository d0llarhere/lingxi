import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
});
