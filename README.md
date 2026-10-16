# Lingxi

A PDF/text reader with synced text-to-speech playback, offline downloads, and highlighted
word-by-word read-along. Everything runs locally in your browser — your books and audio never
leave your device unless you explicitly opt into an online voice.

## Features

- Read PDFs and plain text, with automatic chapter and page detection.
- Listen with synced, word-level highlighting as it reads.
- Download audio for offline listening, by chapter or page range.
- On-device text-to-speech (Kokoro) — no account, no server, works offline.
- Optional online voice (Microsoft Edge's "Aria") if you deploy your own free relay — see
  [`apps/tts-proxy/README.md`](apps/tts-proxy/README.md).
- Import your own audio files and attach subtitles.
- Storage management: see and clear exactly what's using space on your device.

## Prerequisites

- [Node.js](https://nodejs.org) 18.18+ or 20+, and npm (ships with Node).

Setup is identical on Windows, macOS, and Linux.

## Setup

```
git clone <this-repo-url>
cd project-lingxi
npm install
npm run dev:web
```

Then open the URL printed in the terminal (typically `http://localhost:5173`).

`npm install` also generates `apps/web/public/ort/` automatically (the on-device speech model's
WASM runtime) — nothing to do manually.

## Where your data lives

Everything — your books, reading position, downloaded audio, and settings — is stored locally in
your browser's IndexedDB and Cache Storage. There is no account and no backend database; closing
the tab or app doesn't lose anything, but clearing your browser's site data for Lingxi will.

## Voices

- **Kokoro** (on-device) — the default. Installs a ~93MB voice model the first time you use it,
  then works completely offline. No setup required.
- **Aria** (online, optional) — Microsoft's online neural voice. Requires deploying your own free
  relay server, since this is a public repo with no shared default deployment. See
  [`apps/tts-proxy/README.md`](apps/tts-proxy/README.md) for a one-click deploy option. If you
  don't set this up, Lingxi works fully offline with Kokoro alone.

## Monorepo layout

```
apps/web          The React app (Vite)
apps/tts-proxy     Optional relay server for the Aria online voice
packages/core      Shared types, storage, and playback logic used by apps/web
```

## Running tests

```
npm test
```

Runs the `packages/core` test suite (Vitest).

## License

MIT — see [`LICENSE`](LICENSE).

## Known limitations

- The Kokoro voice model is a one-time ~93MB download before on-device speech works.
- PDF text extraction quality depends on how the source PDF was produced (scanned PDFs without
  embedded text won't extract cleanly).
- The Aria online voice depends on an unofficial Microsoft endpoint and a self-deployed relay — see
  the caveat in `apps/tts-proxy/README.md`.
