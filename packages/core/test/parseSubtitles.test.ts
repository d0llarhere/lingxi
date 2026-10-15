import { describe, expect, it } from 'vitest';
import { parseSrt, parseSubtitleFile, parseVtt } from '../src/subtitles/parseSubtitles';

describe('parseSrt', () => {
  it('parses a standard multi-cue SRT file', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:04,000',
      'Hello world',
      '',
      '2',
      '00:00:05,500 --> 00:00:08,250',
      'Second line',
      '',
    ].join('\n');

    const cues = parseSrt(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ startMs: 1000, endMs: 4000, text: 'Hello world' });
    expect(cues[1]).toEqual({ startMs: 5500, endMs: 8250, text: 'Second line' });
  });

  it('includes hours in the timestamp and joins multi-line cue text', () => {
    const srt = ['1', '01:02:03,004 --> 01:02:05,000', 'Line one', 'Line two', ''].join('\n');
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.startMs).toBe(1 * 3_600_000 + 2 * 60_000 + 3 * 1000 + 4);
    expect(cues[0]!.text).toBe('Line one\nLine two');
  });

  it('skips blocks with no timestamp line instead of throwing', () => {
    const srt = ['not a cue', '', '1', '00:00:01,000 --> 00:00:02,000', 'Real cue', ''].join('\n');
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.text).toBe('Real cue');
  });

  it('returns an empty array for empty input', () => {
    expect(parseSrt('')).toEqual([]);
  });
});

describe('parseVtt', () => {
  it('parses a WEBVTT file, ignoring the header', () => {
    const vtt = ['WEBVTT', '', '00:00:01.000 --> 00:00:04.000', 'Hello from VTT', ''].join('\n');
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toEqual({ startMs: 1000, endMs: 4000, text: 'Hello from VTT' });
  });

  it('accepts timestamps without an hours component', () => {
    const vtt = ['WEBVTT', '', '00:01.500 --> 00:04.000', 'Short form', ''].join('\n');
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.startMs).toBe(1500);
  });

  it('handles a cue identifier line like SRT numbering', () => {
    const vtt = ['WEBVTT', '', 'cue-1', '00:00:01.000 --> 00:00:02.000', 'Identified cue', ''].join('\n');
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.text).toBe('Identified cue');
  });
});

describe('parseSubtitleFile', () => {
  it('dispatches .srt files to the SRT parser', () => {
    const srt = ['00:00:01,000 --> 00:00:02,000', 'srt cue', ''].join('\n');
    expect(parseSubtitleFile('movie.srt', srt)).toEqual([{ startMs: 1000, endMs: 2000, text: 'srt cue' }]);
  });

  it('dispatches .vtt files to the VTT parser', () => {
    const vtt = ['WEBVTT', '', '00:00:01.000 --> 00:00:02.000', 'vtt cue', ''].join('\n');
    expect(parseSubtitleFile('movie.vtt', vtt)).toEqual([{ startMs: 1000, endMs: 2000, text: 'vtt cue' }]);
  });

  it('is case-insensitive about the extension', () => {
    const vtt = ['WEBVTT', '', '00:00:01.000 --> 00:00:02.000', 'vtt cue', ''].join('\n');
    expect(parseSubtitleFile('movie.VTT', vtt)).toHaveLength(1);
  });
});
