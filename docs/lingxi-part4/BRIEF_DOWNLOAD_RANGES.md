# Lingxi: download for offline by chapter or page range

Mockups: `mockups/DownloadRange.html` (chapters) and `mockups/DownloadRangePages.html` (pages). Ignore the `<x-dc>` wrapper and script block. `[brackets]` are placeholders for real data. Use the same tokens as before.

Read the existing offline-download / audio-generation code first and extend it. Don't write a second pipeline.

## Where it opens
Every "Download for offline" entry opens the same **dialog**:
- the mini pill `⋯` menu in the reader
- the Library row `⋯` menu
- (optional) the row `⋯` on Downloads for a book item: "Download more…", which opens the dialog starting right after the last saved chapter

## The dialog (520px wide, 20px radius, dimmed backdrop, focus trapped, Esc closes)
1. Title "Download for offline" + book title (+ page count) underneath.
2. A segmented control: **Whole book · Chapters · Pages**. Default to **Chapters** when the book has chapters (per the Chapters setting), otherwise **Pages**. If chapters are off or none are detected, disable the Chapters option and give it a tooltip saying why.
3. The range for the chosen mode:
   - **Chapters**: `From` and `To` dropdowns listing every chapter (`Ch. n · title`), with search when there are more than 20. `To` can't be before `From`; picking an earlier one moves `From` back too. Quick chips: **This chapter · Next 10 chapters · Next 25 · Rest of book**, all relative to the current reading position.
   - **Pages**: `From page` and `To page` number inputs (`of {total}` shown inside the second). Clamp to 1…total and keep From ≤ To. Quick chips: **From current page (n) · Next 50 pages · Next 100 · To the end**. Note: "Starts and ends on whole paragraphs…"; snap the range outward to whole paragraphs or sentences so audio never cuts mid-sentence.
   - **Whole book**: no inputs, only the summary.
4. **Voice**: defaults to the book's current voice and can be changed (dropdown in Chapters mode; a "Change" link in the footer is fine too). The audio is generated with that voice. Speed is *not* baked in, because playback speed is applied when playing.
5. **Summary box**: a bar showing the whole book with three segments: already saved (dark mint), newly selected (accent) and the rest (track). Under it:
   - a legend ("Already saved · Ch. 1–5", "New · Ch. 6–15")
   - `{n} chapters · p. a–b · about {estimated size}` (for pages mode: `{n} pages · Ch. x–y · about {size}`). Estimate size from characters × bytes-per-character measured on the audio already generated, or a constant until there's data.
   - **Skip what's already saved**: only generate missing paragraphs. If the whole selection is already saved, disable the button and show "Already downloaded".
6. Footer: **Cancel** + primary **Download {n chapters | n pages | whole book}**.

## After pressing Download
- Close the dialog right away. Downloads run in the background (queue, one job at a time, resumable after a reload).
- The Downloads page shows the job in its list with a progress bar and Pause/Cancel. The pill menu's "Download for offline" row shows `Downloading Ch. 6–15 · 34%`.
- Store downloaded audio **per paragraph or chunk**, keyed by book + voice + position, so overlapping ranges merge and are never stored twice. On the Downloads page a book appears **once**, with its saved ranges summarised (`Ch. 1–15` or `p. 1–120, 300–340`).
- Settings → Storage counts everything correctly, and deleting can be done per book there (later: per range).
- When offline, playback uses saved chunks. If playback reaches an unsaved part while offline, pause and show a toast: "Not downloaded past Ch. 15 · Download more".

## Done when
- You can download Ch. 6–15, then p. 100–200, then the whole book, and only the missing audio is generated each time.
- Ranges survive a reload, show correctly on Downloads, and play offline (test with DevTools set to offline).
- Build and tests pass, and the dialog works by keyboard and at 390px wide (where it becomes a bottom sheet).
