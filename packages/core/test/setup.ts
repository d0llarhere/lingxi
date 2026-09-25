// Polyfills global indexedDB for Vitest's Node environment so storage code
// can be tested without a browser.
import 'fake-indexeddb/auto';
