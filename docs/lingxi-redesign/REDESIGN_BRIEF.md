# Lingxi redesign brief: mini pill player + sidebar library home

Implement two UI changes in this app. Reference mockups are in `mockups/` next to this file. They use a custom `<x-dc>` wrapper, so ignore that and the `<script type="text/x-dc">` block. Read them for markup structure, spacing, colors and copy, not as code to paste.

- `mockups/MiniPill.html`: the reader with the pill player and its menu open
- `mockups/MiniPillStates.html`: collapsed, paused, voice submenu and download states
- `mockups/HomeSidebar.html`: the new library home

First, read the existing reader page, player component, library/home page, and whatever stores playback state (position, speed, voice, Kokoro and offline download status). Reuse the existing logic and only replace the UI. Don't change TTS, pagination or storage behavior unless a new piece of UI needs a value that isn't exposed yet. If one is missing (for example the current chapter title), add a small selector or derived value for it.

## Design tokens (add as CSS variables, keep the existing light theme working)

| Token | Dark value | Use |
|---|---|---|
| `--bg` | `#1b1d1e` | page |
| `--bg-sunken` | `#181a1b` | sidebar |
| `--surface` | `#25292a` | pill, menus |
| `--surface-2` | `#2f3436` | hover, icon tiles |
| `--border` | `#363b3d` | pill, menu borders |
| `--divider` | `#33383a` | separators, empty progress track |
| `--text` | `#e4e6e7` | primary text |
| `--text-muted` | `#9aa0a3` | secondary text |
| `--accent` | `#7cc4a8` | play button, progress, active nav |
| `--on-accent` | `#11241c` | icons and text on the accent |
| `--accent-soft` | `#263b33` | active nav bg, selected row |
| `--warn` | `#e8c98a` | Kokoro / model download |
| `--highlight-sentence` | `rgba(124,196,168,.12)` | sentence being spoken |
| `--highlight-word` | `rgba(124,196,168,.34)` | word being spoken (text stays light) |

Fonts: UI is Manrope (400–700); reading text stays as it is now (or Literata if you're changing it). Radii: pill `999px`, menus `16px`, rows and buttons `8–10px`. Every touch target is at least 40px. Every icon-only button needs an `aria-label`.

## 1. Mini pill player (replaces the current bottom player)

Delete the full-width bottom panel, the six-button speed row, the voice `<select>`, the stop button, the "Download Kokoro" row and the "Download for offline" row. Everything moves into the pill or its menu.

### The pill
A floating, horizontally centered bar, `bottom: 24px`, 64px tall, `--surface` at ~94% opacity with `backdrop-filter: blur(12px)`, 1px `--border`, `box-shadow: 0 16px 36px rgba(0,0,0,.5)`. From left to right:

1. Previous paragraph (40px round ghost button)
2. **Play/pause**: a 48px `--accent` circle. While playing, a 3px ring around it shows **chapter progress** (SVG circle with `stroke-dasharray`, `--on-accent` ring at 22% opacity as the track). No ring while paused.
3. Next paragraph
4. A 1px × 28px divider
5. An info block, two lines, `min-width: 176px`, numbers in `tabular-nums`:
   - Line 1, bold 13px: `Ch. {chapterNumber} · {chapterTitle}` (shows `Paused · Ch. {n}` when paused)
   - Line 2, muted 12px: `p. {page} / {totalPages} · {remaining} left`, where remaining is the time left **in the current chapter at the current speed**. If the document has no chapters, show `¶ {paragraph} of {total}` on line 1.
6. A speed chip (`1.25×`, 32px tall, outlined). Clicking cycles through 0.75 → 1 → 1.25 → 1.5 → 1.75 → 2.
7. A `⋯` button that opens the menu. Give it `aria-expanded` and a filled `--surface-2` background while the menu is open.

### Auto-collapse while reading
After 3 s of playback with no pointer movement, or while the user scrolls, animate the pill (200ms ease) down to a 48px compact pill holding just a 36px play button with its ring and `Ch. {n} · p. {page} / {total}`. Pointer movement, focus, a tap, or any shortcut expands it again. When paused, the pill always stays expanded. Respect `prefers-reduced-motion`.

### Menu (opens upward, 336px wide, anchored above `⋯`)
In order:
1. **Speed**: a row with a − / + stepper (0.05 steps, range 0.5–3) and the value in the middle.
2. **Voice**: avatar letter, voice name, subtitle `on-device` or `needs internet`, and a chevron that opens a **submenu** with a back button. The submenu lists the voices with the selected one checked and a ▶ preview button on the others.
3. **Sleep timer**: Off / 15 / 30 / 45 / 60 min / End of chapter (submenu).
4. A divider.
5. **Download for offline**: subtitle shows status (`Not downloaded · whole book`, then a progress bar with %, then `Saved for offline`).
6. **On-device voices**: when Kokoro isn't installed, a `--warn` tinted icon and a small `Get` button. While downloading, the same row shows `Getting Kokoro · {pct}%`, a Cancel button and a thin `--warn` progress bar. Once done, hide the row.
7. A divider, then a footer with keyboard hints: `Space` play · `←` `→` paragraph · `[` `]` speed.

Close the menu on Esc, an outside click or a selection. Use `role="menu"`/`menuitem`, and arrow keys move between items.

### Shortcuts (only when focus isn't in an input)
`Space` play/pause · `←`/`→` previous/next paragraph · `[`/`]` speed ∓0.25 · `Esc` closes the menu.

### Reader header
Two lines: book title (15px semibold) and `Chapter {n} · {title}` underneath (12px muted). Keep the back, search and theme buttons.

### Spoken-text highlight
Tint the sentence being spoken with `--highlight-sentence` and the current word with `--highlight-word`. Both keep the light text color (no yellow box with dark text). Use `box-decoration-break: clone` so wrapped lines look right. Keep the active paragraph scrolled into view, about 1/3 from the top.

## 2. Library home: sidebar + list

### Layout
A flex row: a 240px sidebar (`--bg-sunken`, 1px right border) and main content (padding `28px 36px`). Below 900px wide, the sidebar becomes a top bar or drawer and the table turns into stacked cards.

### Sidebar
Logo (`灵 Lingxi`). Nav: **Library** (active: `--accent-soft` bg, light-mint text), **Listening** (books with saved audio progress), **Downloads**, **Bookmarks**, **Voices**. If a page doesn't exist yet, link it to a simple placeholder route instead of hiding it. At the bottom, an **Offline storage** card with a progress bar and `{used} of {available}` (use `navigator.storage.estimate()`), then **Settings**.

### Main
- A header row: `Library` h1, a search input (240–260px, filters as you type, `/` focuses it), a grid/list view toggle (remember the choice in localStorage), and an **Add** primary button (`--accent` bg, `--on-accent` text).
- A list inside a 14px-radius bordered container. Columns: thumbnail (44×60, a generated cover in a color from a hash of the title, with the first CJK character or initial) · title + subtitle (`PDF · Chapter n · Title` or `Text · not started`) · progress bar + % · length (`665 pages` or `~13 min`) · last opened (relative time) · actions (a 40px round play button that **starts or resumes listening right away**, filled `--accent` when the book is in progress and outlined otherwise, plus a `⋯` menu with Rename / Download for offline / Delete).
- A header row with uppercase 11px column labels. Sort by clicking a column header (default: last opened).
- Dragging a PDF/EPUB/TXT file anywhere on the page shows a full-page drop overlay.
- Remove the old "Continue Reading" card. The in-progress book sitting at the top of the list (last-opened sort) plus its filled play button does that job now.

## Done when
- The old player panel and its download rows are gone, and the pill plus menu cover every action the old one had.
- The chapter number and page number show in both the expanded and collapsed pill, and they update while playing.
- The keyboard shortcuts work, the menu works by keyboard, and the axe or Lighthouse accessibility check has no new errors.
- Light theme still works (map the tokens to light values).
- Run the existing tests and the build. Then open the reader and the home page in the browser and check them against the mockups at 1280px and 390px wide.

## 3. Settings page (mockups: `mockups/Settings.html`, `mockups/SettingsCustom.html`)

### Layout
Keep the app sidebar with **Settings** active. Remove the separate "Settings" header bar. The content area has a 180px section nav on the left (title "Settings", then Reading, Listening, Chapters, Storage, Appearance, About; active item gets a `--surface` background and white text) and a content column on the right, `max-width: 680px`, padding `36px 48px`. Each section is its own route or anchor. If a section has no settings yet, leave it out of the nav instead of showing an empty page. On narrow screens the section nav becomes a horizontal scrolling tab row.

### Chapters section
- h1 `Chapters` (26px), plus a one-line description in muted 14px.
- A small uppercase label "How chapters are found", then **one** bordered card (14px radius, `#202324` bg) holding three radio rows separated by 1px dividers. Don't use three separate big cards. Each row has a radio, a bold 15px title, a muted 13px description, and a small monospace example chip on the right: Automatic → `Chapter 5`, Custom format → `1 Swindler`, Off → `p. 12 / 665`. The selected row gets an `--accent-soft`-ish bg (`#22302b`) and a 3px inset accent bar on the left. Use a real radio group (`role="radiogroup"`, arrow keys move the selection).
- **Custom format, when selected**, expands inline *inside its own row* (indented under the title, not floating below the card). **Keep the existing data model: a single optional "heading word".** Only the UI changes:
  - Label "Headings start with", then chips: **Just a number** (= empty heading word), **Chapter**, **Part**, **Episode**, **Section**. Clicking a chip sets the heading word, and the chip matching the current value is filled with the accent.
  - Below that, an input labelled "Heading word (optional)", max ~360px wide, placeholder "Other word, e.g. Volume", for anything not covered by the chips. Typing here un-highlights the chips unless the text matches one. Replace the current long uppercase label ("HEADING WORD (LEAVE BLANK IF…)") with this normal-case label plus the hint line below.
  - A hint line: "Will match headings like" followed by 1–2 monospace example chips built from the current word (empty → `301 Title`; "Episode" → `Episode 5 Title`). If the Test on a book box (below) found real headings, show the first real one instead.
- **Test on a book**: a book `<select>`, then a live result card that re-runs detection (debounced ~300ms) whenever the mode or pattern changes:
  - 0 found → a warm `--warn` card titled "No chapters found", the first heading-like line it spotted, and a one-click button that switches to the matching custom preset (e.g. *Use "number + title" format*).
  - Some found → a mint card "{count} chapters found" with the first 3 matches (`Ch. n · title · p. n`) and "View all".
- A footer: a check icon and "Changes save automatically". Save on change, with no Save button.
- The setting is global, as now. Changing it re-indexes chapters for open or cached books (or does so lazily when a book is next opened). Make sure the player pill and library list pick up the new chapter data.
