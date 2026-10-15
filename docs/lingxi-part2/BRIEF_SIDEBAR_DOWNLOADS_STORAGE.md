# Lingxi: sidebar, Downloads page, Settings → Storage

Read the mockups in `mockups/`. Ignore the `<x-dc>` wrapper and the `<script type="text/x-dc">` block; use them only for layout, spacing, colors and copy. Use the same design tokens as the earlier redesign (`--bg`, `--surface`, `--accent` #7cc4a8, `--warn` #e8c98a, etc.). Text in `[brackets]` in the mockups is a placeholder for real data.

Before writing code, read the current sidebar, the Downloads/offline code, the storage-estimate code and the mini pill player. Reuse them; don't duplicate them.

## 1. Sidebar
- The nav contains only **Library**, **Downloads**, and **Settings** pinned at the bottom.
- Remove **Listening**, **Bookmarks** and **Voices** (their routes and their nav items).
- The "Offline storage" card is renamed **Storage** and is **only shown on the Downloads page**, not on Library or Settings. It shows "Storage · Manage ›", a bar, and `{used} of {available}`, and the whole card is a link to **Settings → Storage**.

## 2. Downloads page (`mockups/Downloads.html`, `mockups/DownloadsPlaying.html`)
**What it lists:** only audio stored locally by this app, meaning
- audio generated and downloaded from books in the Library ("From book" tag), and
- audio files the user imported ("Imported" tag, `--warn` tint).

It does not list book files (PDF/text).

**Header:** "Downloads" h1, the subtitle "Audio saved on this device · plays offline", a search box, and a **`⋯` button** opening a menu with:
- **Import audio…** opens a file picker (`accept="audio/*"`: mp3, m4a, wav, ogg, multiple files). Store the files locally (IndexedDB/OPFS, whatever the app already uses for offline audio). The Import button lives only in this menu, not as a visible button.
- **Sort by** (Last played / Name / Size / Date added).
- **Manage storage** goes to Settings → Storage.

**Filters:** All · From books · Imported.

**List rows:** thumbnail (book cover glyph, or a music-note icon for imported files) · title + tag + detail (book items show the chapter range, voice and speed; imported items show the subtitle file name if one is attached) · "Where you left off" progress bar + position (`Ch. 2 · 14:05` or `32:10`) · length · size · play/resume button (filled accent when partly played) · row `⋯` (Rename, Attach subtitles…, Delete). The row that is playing gets the accent-soft background, a 3px left accent bar and an animated equalizer icon in place of its thumbnail.

**In-page player (plays audio in the browser):**
- Use the **same mini pill component** as the reader, in an "audio file" variant:
  - Buttons are **−15 s / play-pause / +15 s** (instead of previous/next paragraph).
  - Info line 1 is the title; line 2 is `{position} / {duration} · resumes here next time`. For book audio, show `Ch. n · p. n` like the reader does.
  - A **seek bar** sits inside the pill under the controls (draggable, keyboard: ←/→ = 5 s).
  - Speed chip + `⋯` menu, same as the reader.
- **Pill menu for audio files:** Speed stepper · **Subtitles** row with an on/off switch and the current file name · **Import subtitles…** (`.srt` / `.vtt`, attached to that audio item and stored with it) · **Sleep timer** (Off/15/30/45/60 min/End of track, showing the time left when active).
- **Subtitles display:** the current cue shows centered above the pill in a dark translucent box (18px, max 640px wide). Parse SRT/VTT into cues and match them to `audio.currentTime`.
- **Resume:** save the position per item (every ~5 s, on pause, and on `pagehide`). Pressing play on a row continues from there. Also save speed per item.
- Use `navigator.mediaSession` so the OS media keys and lock screen show the title and the play/pause/seek controls.
- Leaving the Downloads page keeps audio playing, with the pill visible app-wide until it's stopped (if that's simple with the current player state; otherwise pause on leave).

## 3. Settings → Storage (`mockups/SettingsStorage.html`)
A new **Storage** tab in the settings section nav (Reading, Listening, Chapters, **Storage**, Appearance, About).

- **Summary:** the large used figure ("383 MB used of 10 GB available") from `navigator.storage.estimate()`, plus a segmented bar with one color per category.
- **What's using space:** one card with a row per category: color dot, name, description, size, action.
  - Downloaded audio → **Delete all…**
  - Imported audio → **Delete all…**
  - Voice model (Kokoro) → **Remove** (the description explains it can be re-downloaded)
  - Book files → *not deletable here*; an **Open Library** link instead
  - Cache → **Clear** (no confirmation needed)
- **Audio files:** a checkbox list of every downloaded and imported audio item with its size. Selecting items shows "{n} selected · {size}" and a **Delete selected** button.
- Every destructive action except Clear cache opens a confirmation dialog that names what will be deleted and how much space comes back. Afterwards, refresh the numbers and show a toast ("Freed 120 MB").
- Destructive buttons use a muted red outline (`#5a3434` border, `#f0b4b4` text). Selected checkboxes are red-tinted, as in the mockup.

## Done when
- The sidebar shows only Library, Downloads and Settings, and the Storage card appears only on Downloads, linking to Settings → Storage.
- Importing an mp3 plus an .srt works: it plays in the pill, subtitles show, and after a reload it resumes at the same spot.
- Every deletable category can be deleted from Settings → Storage, and the numbers update.
- Build and tests pass. Check both pages in the browser at 1280px and 390px wide.
