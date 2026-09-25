# Project_Lingxi — Architecture

Offline-first PDF/text reading app with local TTS, shared across Web (PWA) and Android (Capacitor).
Personal use only. No backend, no accounts, no analytics, no network dependency for core function.

Status: **Phase 0 (scaffold), Phase 1 (document model + storage + text library), Phase 2 (PDF extraction), and Phase 3 (web TTS playback + word-level sync) implemented.**

---

## 0. Known dev-tooling vulnerabilities (audited, deferred)

`npm audit` flags 5 vulnerabilities as of Phase 1, all inside the Vite/Vitest dev-tooling dependency
chain (`vite`, `esbuild`, `vite-node`, `vitest`, `@vitest/mocker`) — none in runtime dependencies
(`react`, `react-dom`, `idb`). Every exploit path requires the `vite` dev server or the optional
`vitest --ui` server to be actively running and network-reachable by an untrusted party; we run neither
exposed, and never run `--ui`. The critical-severity one specifically requires `vitest --ui`, which this
project doesn't use. None of these packages are present in the production `dist/` bundle.

Fixes only exist as major-version bumps (`vite` 5→8, `vitest` 2→5) — deliberately not taken, per
instruction not to upgrade majors just to clear warnings. Revisit if: a matching-major patch release
appears, or the dev server / Vitest UI is ever run on a shared or network-exposed machine.

---

## 1. Monorepo / workspace structure

npm workspaces (no Nx/Turborepo — unnecessary at this scale).

```
Project_Lingxi/                # project root
  package.json                 # workspace root, no app code
  ARCHITECTURE.md
  packages/
    core/                      # pure TS, no DOM/React/Capacitor imports
      src/
        model/                 # Document, cursor, segmentation types
        extraction/            # PDF -> text -> structure pipeline
        segmentation/          # Intl.Segmenter-based sentence/word splitting
        playback/              # PlaybackController, TTSEngine interface
        storage/               # LibraryStore (idb-backed)
      test/
  apps/
    web/                       # React + TS + Vite + PWA
      src/
        adapters/tts/          # WebSpeechTTSEngine
        ui/                    # reading view, library, controls
    android/                   # Capacitor project, webDir -> apps/web/dist
      android/                 # native Kotlin: TTS foreground service, plugin
```

`packages/core` has zero platform dependencies (no `window`, no `speechSynthesis`, no Capacitor
imports) so it is trivially unit-testable in Node and reusable unchanged by both apps.

---

## 2. Shared packages/modules

Everything in `packages/core`:

- **Document model** — types + validation.
- **PDF extraction pipeline** — wraps `pdfjs-dist`, produces a `Document`.
- **Segmentation** — `Intl.Segmenter`-based paragraph/sentence/word indexing.
- **ReadingCursor + PlaybackController** — the pause/resume source of truth (§6, §7).
- **LibraryStore** — CRUD over IndexedDB via `idb`.
- **TTSEngine interface** — the contract platform adapters implement; no implementation lives here.

Nothing UI-related is shared as *components* (Android doesn't have a separate UI — it reuses the
built web bundle via Capacitor, see §4) — but all logic behind the UI is shared.

---

## 3. Web app architecture

- React + TypeScript + Vite.
- `WebSpeechTTSEngine` (in `apps/web/src/adapters/tts`) implements `TTSEngine` using
  `speechSynthesis` + `SpeechSynthesisUtterance` `boundary` events.
- State: React Context + `useReducer` around `PlaybackController` and `LibraryStore` — no Redux/Zustand,
  unnecessary for this scope.
- PWA via `vite-plugin-pwa` (§10).
- Screens: Library, Reading view (import PDF / paste text live here too, not a separate screen).

---

## 4. Android / Capacitor architecture

- `apps/android` wraps the **same built web bundle** (`apps/web/dist`) — this is what makes it a shared
  codebase rather than a second app. No parallel Android UI is written.
- Native additions are added only where the WebView/Web APIs are insufficient:
  1. TTS adapter — a custom Capacitor plugin (Kotlin) wrapping Android's native `TextToSpeech` directly,
     implementing the same `TTSEngine` interface as the web adapter (`AndroidTTSEngine`), and forwarding
     `OnRangeStart` word-boundary callbacks to JS for word-level highlighting (§8).
  2. A foreground `Service` owning that `TextToSpeech` instance, so speech continues when the WebView is
     backgrounded/suspended (§13).
- Storage: same IndexedDB `LibraryStore` from `packages/core`, unchanged — Android's system WebView is
  Chromium-based and supports IndexedDB at more than sufficient capacity for personal text documents.
  Native SQLite is **not** added speculatively; only if a concrete storage limitation appears.

---

## 5. Document / PDF data model

All character offsets are **global offsets into `Document.text`** (the full extracted plain text, pages
joined with a structural break marker). Page/paragraph/sentence/word are index arrays over that one
string, so any word can be resolved to its full hierarchical path in O(1) and vice versa.

```ts
type SourceType = 'pdf' | 'pasted-text';

interface Document {
  id: string;
  title: string;
  sourceType: SourceType;
  originalFilename?: string;
  text: string;                 // full extracted/pasted plain text
  structure: DocumentStructure; // segmentation index, see below
  createdAt: number;
  lastOpenedAt: number;
  extractionStatus: 'ok' | 'no-text' | 'error';
}

interface DocumentStructure {
  pages: PageRef[];
  paragraphs: ParagraphRef[];
  sentences: SentenceRef[];
  words: WordRef[];
}

interface PageRef       { index: number; charStart: number; charEnd: number }
interface ParagraphRef  { index: number; pageIndex: number; charStart: number; charEnd: number }
interface SentenceRef   { index: number; paragraphIndex: number; pageIndex: number; charStart: number; charEnd: number; text: string }
interface WordRef       { index: number; sentenceIndex: number; paragraphIndex: number; pageIndex: number; charStart: number; charEnd: number; text: string }

interface PlaybackSettings {
  documentId: string;
  selectedVoiceURI: string | null;
  playbackSpeed: number;        // 0.5–3.0
}
```

Large text is stored in a separate IndexedDB object store from metadata so listing the library doesn't
deserialize full document bodies (§9).

**Decision:** the original PDF binary **is** persisted in V1, as a `Blob` in its own store (`sourceFiles`,
§9), keyed by `documentId`. Enables "view/recover the original file" later without re-importing. Only
written for `sourceType: 'pdf'` documents; pasted-text documents have nothing to store here.

---

## 6. Reading cursor model — pause/resume source of truth

This is the critical piece. **The cursor, not `speechSynthesis`'s internal state, is authoritative.**

```ts
interface ReadingCursor {
  documentId: string;
  wordIndex: number;        // primary source of truth: index into structure.words[]
  charOffset: number;       // = words[wordIndex].charStart — redundant, kept explicit per spec
  pageIndex: number;        // denormalized from words[wordIndex].pageIndex
  paragraphIndex: number;   // denormalized
  sentenceIndex: number;    // denormalized
  updatedAt: number;
}
```

`wordIndex` is the single number the engine actually needs (everything else is derivable from
`structure.words[wordIndex]`), but the full hierarchical path is denormalized onto the persisted record
so it satisfies "document → page → paragraph → sentence → word → character offset" explicitly, is
self-describing without reloading the whole document, and is cross-checkable during testing.

**Persistence points** (written to the `cursors` IndexedDB store, keyed by `documentId`):
- On every **pause** and **stop** (synchronous, before the TTS engine is torn down).
- On `visibilitychange`/`pagehide` (covers "close the app"/tab close/app-switch on Android).
- Periodically during active playback (every few words) as a crash safety net.

**Restoring:** on document open, load the persisted `ReadingCursor` and initialize the in-memory
playback state from it — the UI highlights `structure.words[cursor.wordIndex]` immediately, before
Play is even pressed, satisfying "keep the exact current word highlighted" while paused.

**Never derived from the TTS engine.** `speechSynthesis.paused`/`.pending`/`.speaking` are not read as
state; they're not persisted; resume never asks the browser to resume an existing utterance (see §7 —
utterances are always short-lived and disposable).

---

## 7. TTS / playback architecture

```ts
interface TTSEngine {
  speak(text: string, opts: {
    voiceURI: string | null;
    rate: number;
    // `confirmed` distinguishes a real engine boundary from a best-effort
    // time-based estimate (see §8) — only confirmed events may advance the
    // persisted cursor.
    onWordBoundary?: (charIndexInText: number, confirmed: boolean) => void;
    onEnd: () => void;
    onError: (err: unknown) => void;
  }): void;
  cancel(): void;
  listVoices(): Promise<VoiceInfo[]>;
}
```

**Implemented in `packages/core/src/playback/playbackController.ts`** (Phase 3). One addition beyond
what's described below: every `speak()` call is tagged with an internal generation number, and any
`onEnd`/`onError`/`onWordBoundary` callback whose generation no longer matches the latest one is ignored.
This was added after a real bug found in manual Chrome testing — calling `TTSEngine.cancel()` (from
pause/stop/seek) causes Chrome to fire the *cancelled* utterance's `onerror` with `error: 'canceled'`
shortly afterward, racing with and otherwise clobbering the state pause()/stop() had just set.

Deliberately **no `pause`/`resume` in the interface.** Web Speech API's `pause()`/`resume()` is known to
be unreliable across browsers/voices (Chrome in particular has long-standing bugs where resume silently
fails after a delay). Rather than build pause/resume logic on top of a flaky primitive, `PlaybackController`
(in `packages/core`) never uses it:

- **Utterances are sentence-sized**, not whole-document. `PlaybackController` feeds `TTSEngine.speak()`
  one sentence at a time.
- **Pause** = record the cursor at the last confirmed word boundary, then `TTSEngine.cancel()` (a hard,
  reliable stop). The rest of the in-flight sentence's audio is simply discarded — acceptable since a
  sentence is a few seconds at most.
- **Resume** = build a new utterance from `structure.sentences[cursor.sentenceIndex]`, sliced starting at
  `cursor.wordIndex`'s `charStart`, and call `speak()` again. From the browser's perspective this is a
  brand new utterance, not a resumed one — sidestepping the buggy primitive entirely.
- **Next/Previous chunk** = cancel current utterance, move cursor to the adjacent sentence's first word,
  speak.
- **Click any word to start reading from there** = cancel, set cursor to that word (mid-sentence
  allowed — slice the sentence text from that word forward), speak.
- **Click progress bar** = map click position to a global char offset → nearest word → same as above.

`PlaybackController` is a plain TS state machine (`idle | playing | paused`) driven by these cursor
operations; it holds no reference to `speechSynthesis` directly, only to whatever `TTSEngine` it's given
— identical logic drives both the web and Android adapters.

---

## 8. Word/sentence synchronization strategy

- **Primary signal:** `SpeechSynthesisUtterance`'s `boundary` event, `charIndex` mapped (via the current
  sentence's `WordRef[]`) to the word whose `[charStart, charEnd)` contains it. On each confirmed
  boundary: advance the in-memory cursor, update the highlighted word (a targeted state update, not a
  full document re-render).
- **Known gap:** `boundary` event granularity is inconsistent across browsers/voices — some fire
  per-word, some only per-sentence, some not at all. **Fallback:** an elapsed-time estimator
  (`elapsed / (sentenceText.length / rate)`) interpolates an approximate word position for *display*
  only between confirmed boundaries.
- **Persistence rule:** only **confirmed** boundary events update the persisted cursor. If paused while
  only an estimated (unconfirmed) position is available, the cursor falls back to the start of the
  current sentence rather than persisting a guess — resume is always to a real word, never a guessed one.
- **Android:** the standard Capacitor TTS community plugin does not expose Android's native
  `onRangeStart` word-boundary callback to JS, so **a small custom Capacitor plugin will be built**
  (Kotlin) that wraps `TextToSpeech` directly and forwards `onRangeStart(utteranceId, start, end)` as a
  plugin event — giving true word-level highlighting on Android from V1, matching web. This replaces
  `@capacitor-community/text-to-speech` rather than sitting alongside it (no point depending on a plugin
  we're subsuming). `TTSEngine.onWordBoundary` stays optional in the interface as a defensive fallback
  (sentence-level highlighting) in case a given Android voice/OS version doesn't fire the callback, but
  it is not the primary plan.
- **Confirmed in manual testing (Phase 3):** this is not a theoretical concern. On the Chrome build used
  for manual testing, every available voice was a non-local Google network voice (`localService: false`),
  and it fired **zero** `boundary` events per utterance — only `start`/`end`. `WebSpeechTTSEngine`
  correctly detected this after the first utterance and fell back to the time-based estimator for
  subsequent sentences; the UI's "approximate highlighting" notice appeared as designed, while the
  persisted cursor correctly stayed pinned to confirmed sentence-start positions rather than the
  estimated word shown on screen.

---

## 9. Local storage / database strategy

Single IndexedDB database (`lingxi-db`), accessed via `idb` (tiny promise wrapper, not a query-engine
library like Dexie — keeps us close to the platform, minimal dependency surface). Object stores:

| Store | Key | Contents | Why separate |
|---|---|---|---|
| `documents` | `id` | metadata + `DocumentStructure` (no full text) | Library list/search loads this without deserializing large text bodies |
| `documentText` | `id` | full `text` string | Loaded only when a document is actually opened |
| `cursors` | `documentId` | `ReadingCursor` + `PlaybackSettings` | Written far more frequently (every pause, periodically during play) than the document itself — isolating it keeps those writes cheap and avoids rewriting structure data on every pause |
| `sourceFiles` | `documentId` | original PDF as a `Blob` (pdf documents only) | Large binary kept out of the frequently-read `documents`/`documentText` stores; only touched on import and on-demand "view original" |

No full-text search index — library search is an in-memory filter over already-loaded titles/filenames,
adequate for a personal library and avoids a search dependency.

---

## 10. Offline / PWA strategy

- `vite-plugin-pwa` (dev dependency) generates a manifest + service worker (Workbox) that precaches the
  app shell — JS, CSS, HTML, fonts, and the **locally hosted** `pdf.worker.js` (must not be loaded from a
  CDN, or first-run-without-network would break extraction).
- Service worker's only job is app-shell availability offline; there is no API traffic to cache since
  there is no backend.
- All user content already lives in IndexedDB, which never touches the network regardless of service
  worker state.
- TTS voices are OS/browser-provided already-local resources; nothing to bundle.

---

## 11. PDF extraction pipeline

1. User selects a local PDF (`File`). Never uploaded anywhere.
2. `pdfjs-dist`, worker bundled locally, loads via `getDocument({ data: arrayBuffer })`.
3. Per page: `page.getTextContent()` → page's plain text, appended to the growing global `text` buffer
   with a structural page-break marker; record that page's `[charStart, charEnd)`.
4. If total extracted text is below a small heuristic threshold → `extractionStatus: 'no-text'`, and the
   UI shows the required message instead of a reading view. No OCR in V1.
5. Segmentation pass over the assembled text: paragraphs from pdf.js layout/line-break heuristics,
   sentences via `Intl.Segmenter({ granularity: 'sentence' })` per paragraph, words via
   `Intl.Segmenter({ granularity: 'word' })` per sentence (filtering whitespace-only segments) — builds
   `structure.{pages,paragraphs,sentences,words}` with global char offsets.
6. Persist `Document` (+ separate text store) and an initial `ReadingCursor` at `wordIndex: 0`.

Malformed PDFs: `getDocument`/parsing wrapped in try/catch; on failure nothing is persisted and the user
sees an import error, rather than a broken half-imported library entry.

Pasted text follows the same pipeline from step 5 (no PDF parsing needed, one "page").

---

## 12. Library architecture

`LibraryStore` (in `packages/core`, platform-agnostic):

- `list()` — metadata only, sortable by `lastOpenedAt` (recently opened) or progress (continue reading).
- `search(query)` — in-memory filter over loaded metadata.
- `createFromPdf(file)` / `createFromPastedText(text, title)` — run the pipeline in §11, persist.
- `rename(id, title)`, `delete(id)` (removes from all four stores: metadata, text, cursor, source file).
- `getProgress(id)` — derived from `cursor.charOffset / document.text.length`.

Web UI: a thin React hook wraps this store. Android: identical store, same IndexedDB, reused unchanged.

---

## 13. Android background playback approach

Android suspends/throttles WebView JS when backgrounded, which would kill a pure-JS playback loop. So:

- Actual speech synthesis on Android runs in a **foreground `Service`** (mandatory for background audio
  on Android — requires a persistent notification) that owns the native `TextToSpeech` instance and the
  current utterance queue. This service keeps running even when the WebView is suspended.
- JS communicates with it via the Capacitor plugin bridge: "speak this sentence," receiving
  progress/boundary/end events back as plugin events.
- The **logical cursor and all pause/resume/seek decision-making stays in shared `packages/core`** — the
  Android-native layer is a thin executor (start/stop speaking a given piece of text), not a place where
  playback logic is duplicated.
- Lock-screen/notification playback controls via `MediaSessionCompat`, tied to the same service.

This is genuine native Kotlin work, scoped entirely to the Android implementation phase.

---

## 14. Testing strategy

- **Vitest**, `packages/core` — no DOM needed:
  - segmentation correctness (paragraph/sentence/word boundaries on fixture texts)
  - cursor math: word index ↔ page/paragraph/sentence/charOffset derivation, both directions
  - `LibraryStore` CRUD against `fake-indexeddb` (dev dependency)
  - PDF pipeline against fixture PDFs: normal text PDF, malformed/corrupt PDF, scanned/image-only PDF,
    empty PDF
  - long-document fixture (large generated text) for chunking correctness/performance
- **Playwright** (already used elsewhere in this workspace, no new dependency) for the end-to-end
  critical path in `apps/web`:
  1. import/paste a document
  2. play
  3. pause mid-sentence
  4. reload the page (stands in for "close the app")
  5. reopen the document
  6. press Resume
  7. assert playback resumes from the **persisted word index**, not from word 0
- **Android**: reuses the same web-level test suites since the UI/logic is the same built bundle; the
  native bridge (foreground service, native word-boundary plugin if built) gets a manual device smoke
  test — automated native Android test infra is out of scope for a personal-use app.

---

## 15. Shared vs. platform-specific

**Shared (`packages/core`, 100% of the logic that matters for correctness):**
Document model, PDF extraction pipeline, segmentation, `ReadingCursor` + `PlaybackController`,
`LibraryStore`, `TTSEngine` interface, all UI React components (Android ships the same built web bundle).

**Platform-specific (thin adapters only):**
- Web: `WebSpeechTTSEngine`, PWA/service-worker config.
- Android: native TTS adapter (+ optional custom word-boundary plugin), foreground service for
  background playback, media session controls, Capacitor project config.

---

## Dependencies (full list, nothing speculative)

- `packages/core`: `pdfjs-dist`, `idb`. (`Intl.Segmenter` is a native JS API, no package.)
- `apps/web`: `react`, `react-dom`, `vite`, `vite-plugin-pwa`, `typescript`.
- Dev/test: `vitest`, `fake-indexeddb`, `playwright` (already present in the parent workspace).
- `apps/android` (Android phase only): `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, plus a
  custom local Capacitor plugin (Kotlin, no external package) for native TTS + word boundaries — no
  `@capacitor-community/text-to-speech` dependency, since the custom plugin subsumes it.

## Decisions (resolved)

1. **PDF binary storage** — stored in V1, as a `Blob` in the `sourceFiles` IndexedDB store (§5, §9).
2. **Android word-highlight granularity** — word-level from V1, via a custom native Capacitor plugin
   exposing `TextToSpeech.OnRangeStart` (§4, §8), not deferred to sentence-level.
