# Lingxi: remaining Settings pages (Reading, Listening, Appearance, About)

Mockups are in `mockups/`. Ignore the `<x-dc>` wrapper and the `<script type="text/x-dc">` block; use them only for layout, spacing, colors and copy. Text in `[brackets]` is a placeholder for real data. Reuse the settings layout already built for Chapters and Storage: the 180px section nav plus a 680px content column, the same tokens, and autosave on change (no Save buttons).

Section nav order: **Reading · Listening · Chapters · Storage · Appearance · About**.

Shared building blocks (make them small reusable components if they don't exist yet):
- **Settings card**: a bordered card (14px radius, `#202324`) whose rows are separated by 1px lines. Each row has the label on the left (14px semibold, with an optional 12px muted hint under it) and the control on the right, and is at least 52px tall.
- **Segmented control**: a `#1a1c1d` track with 30px buttons; the selected one gets `#33383a` and white text. Use `role="radiogroup"`.
- **Switch**: 40×22, accent when on, `#3a3f41` when off, `role="switch"` with `aria-checked`.
- Section labels are 12px uppercase muted text above each card.

## Reading (`mockups/SettingsReading.html`)
- A **live preview** box at the top: a short paragraph rendered with the current settings, including the sentence and word highlight. It updates instantly as controls change.
- Card 1:
  - Font size: slider 14–28px, small A / big A on either end, value shown.
  - Line spacing: Tight / Normal / Loose.
  - Text width: Narrow / Medium / Wide (e.g. 560 / 680 / 820px max).
  - Paragraph spacing: Small / Medium / Large.
  - Alignment: Left / Justified.
- Card 2: Font: Serif / Sans / Easy-read (Atkinson Hyperlegible or similar). Each button is labelled in its own font.
- Card 3:
  - Highlight while listening: Sentence + word / Sentence / Off.
  - Auto-scroll to follow the voice (switch; hint: "Pauses for a few seconds when you scroll yourself"). Implement that pause: after the user scrolls by hand, stop auto-scrolling for ~5 s.
- No page-by-page or pagination option.
- Store these as reader CSS variables so the reader picks them up without a reload.

## Listening (`mockups/SettingsListening.html`)
Defaults for new books. The player can still override voice and speed per book.
- **Voice** card:
  - Default voice: a dropdown showing the avatar letter, name and "on-device"/"online", with a ▶ preview button next to it.
  - On-device voices (Kokoro): status "Installed · works offline" with **Remove**, or "Not installed" with **Install** (and a progress bar while downloading). Use the same state as the pill menu and Storage.
  - Allow online voices: switch. When off, hide online voices from every voice picker. If the current default is online, fall back to an on-device voice, or show a warning when none is installed.
- **Playback** card:
  - Default speed: 0.75× … 2×.
  - Skip buttons jump by: Sentence / Paragraph / 15 s. This sets what the pill's previous/next buttons do in the reader.
  - Pause between paragraphs: None / Short (~300ms) / Long (~800ms).
  - Skip page numbers and headers: switch. Before speaking, filter out lines like "Page 12" and running headers that repeat on most pages.
- **Sleep timer** card:
  - Default length: 15 / 30 / 45 / 60 min / End of chapter. This preselects the option in the pill menu.
  - Fade out at the end: switch. Ramp the volume down over the last ~10 s.

## Appearance (`mockups/SettingsAppearance.html`)
- **Theme**: four preview cards in a radiogroup: System (split light/dark preview), Light, Dark, Sepia. The selected card has an accent border and a ✓. Sepia needs its own token set (paper `#f1e7d0`, ink `#3b2f1e`, accent `#8a6a3b`). The header's sun/moon toggle stays and keeps the same setting in sync.
- **Accent color**: five round swatches (Jade `#7cc4a8`, Sky `#8fb4e8`, Amber `#e8c98a`, Rose `#e8a3b0`, Lavender `#c3b4f0`), with the selected one ringed and its name shown on the right. It sets `--accent` app-wide; derive `--accent-soft` and `--on-accent` from it. Check that text on the accent keeps 4.5:1 contrast in both light and dark themes, and darken the accent in the light theme if needed.
- **Motion**: Reduce motion: Follow system / On / Off. It controls pill and menu animations.

## About (`mockups/SettingsAbout.html`)
- A header card: app icon, "Lingxi", version and build date (inject them at build time, e.g. from package.json and the Vite `define`), an update status line, and a **Check for updates** button. If there's no update mechanism, have the button reload the service worker and show "You're on the latest version" or "Update ready, reload".
- A links card: **Report a bug** (opens a new-issue URL with the version and user agent filled in), **Source code** (repo link), **What's new** (a simple changelog view or modal). If the repo is private or not set yet, hide Report a bug and Source code.
- **Credits and licenses**: list the main libraries actually used (read package.json, include Kokoro and PDF.js if present) with their license names, plus "View all open-source licenses", which shows a generated list (e.g. `rollup-plugin-license` output or a static JSON).

## Done when
- All six settings tabs exist in that order and every control saves on change and survives a reload.
- Reading changes show live in the preview and in the reader. The Listening defaults are used by new books and the pill.
- Theme, accent and reduce motion apply across the whole app, including the pill and menus.
- Build and tests pass. Check each page at 1280px and 390px wide; on mobile the section nav becomes a horizontal tab row.
