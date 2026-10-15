export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

function parseSrtTimestamp(ts: string): number | null {
  const m = ts.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!m) return null;
  const [, h, mi, s, ms] = m as unknown as [string, string, string, string, string];
  return Number(h) * 3_600_000 + Number(mi) * 60_000 + Number(s) * 1000 + Number(ms);
}

// VTT allows the hours component to be omitted (MM:SS.mmm), unlike SRT.
function parseVttTimestamp(ts: string): number | null {
  const m = ts.match(/^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/);
  if (!m) return null;
  const [, h, mi, s, ms] = m as unknown as [string, string | undefined, string, string, string];
  return (h ? Number(h) * 3_600_000 : 0) + Number(mi) * 60_000 + Number(s) * 1000 + Number(ms);
}

// Both formats are a sequence of blocks separated by a blank line, each
// with one "start --> end" line somewhere near the top and the cue text
// after it. Any line before the timestamp (a cue number, or VTT's "WEBVTT"
// header if it ends up glued to the first block) is simply ignored rather
// than required/forbidden — this parser only needs the timestamp and the
// text that follows it, matching what the brief actually uses subtitles
// for (display + cue lookup), not full SRT/VTT spec compliance.
function parseCueBlocks(text: string, parseTimestamp: (ts: string) => number | null): SubtitleCue[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0);
    const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeLineIndex === -1) continue;

    const [startRaw, endRaw] = lines[timeLineIndex]!.split('-->').map((part) => part.trim().split(/\s+/)[0]);
    if (!startRaw || !endRaw) continue;
    const startMs = parseTimestamp(startRaw);
    const endMs = parseTimestamp(endRaw);
    if (startMs === null || endMs === null) continue;

    const cueText = lines
      .slice(timeLineIndex + 1)
      .join('\n')
      .trim();
    if (!cueText) continue;

    cues.push({ startMs, endMs, text: cueText });
  }

  return cues;
}

export function parseSrt(text: string): SubtitleCue[] {
  return parseCueBlocks(text, parseSrtTimestamp);
}

export function parseVtt(text: string): SubtitleCue[] {
  return parseCueBlocks(text, parseVttTimestamp);
}

export function parseSubtitleFile(filename: string, text: string): SubtitleCue[] {
  const extension = filename.split('.').pop()?.toLowerCase();
  return extension === 'vtt' ? parseVtt(text) : parseSrt(text);
}
