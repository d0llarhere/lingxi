// Configures pdf.js's worker for the browser. This is Vite-specific (the
// `?url` asset import), which is why it lives here rather than in
// packages/core — core stays free of bundler-specific code and just calls
// getDocument(); this side-effect module only needs to run once, before any
// extraction happens, to set the shared GlobalWorkerOptions singleton.
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
