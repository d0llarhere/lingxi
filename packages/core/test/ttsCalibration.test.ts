import { describe, expect, it } from 'vitest';
import { calibrateCharsPerSecond, measureCharsPerSecond } from '../src/playback/ttsCalibration';

describe('measureCharsPerSecond', () => {
  it('computes chars/sec at rate=1', () => {
    // 100 chars spoken in 5000ms at rate 1 => 20 chars/sec.
    expect(measureCharsPerSecond(100, 5000, 1)).toBe(20);
  });

  it('normalizes the measurement back to a rate=1 baseline', () => {
    // The same audio duration at rate 2 implies the underlying voice speaks
    // twice as fast at rate 1, so the normalized measurement should be half.
    expect(measureCharsPerSecond(100, 5000, 2)).toBe(10);
  });

  it('returns null for zero or negative text length', () => {
    expect(measureCharsPerSecond(0, 5000, 1)).toBeNull();
    expect(measureCharsPerSecond(-5, 5000, 1)).toBeNull();
  });

  it('returns null for zero or negative duration', () => {
    expect(measureCharsPerSecond(100, 0, 1)).toBeNull();
    expect(measureCharsPerSecond(100, -1, 1)).toBeNull();
  });

  it('returns null for zero or negative rate', () => {
    expect(measureCharsPerSecond(100, 5000, 0)).toBeNull();
    expect(measureCharsPerSecond(100, 5000, -1)).toBeNull();
  });
});

describe('calibrateCharsPerSecond', () => {
  it('blends the previous estimate and a new measurement by the smoothing factor', () => {
    expect(calibrateCharsPerSecond(15, 20, 0.5)).toBe(17.5);
  });

  it('ignores the new measurement entirely when smoothing is 0', () => {
    expect(calibrateCharsPerSecond(15, 100, 0)).toBe(15);
  });

  it('adopts the new measurement entirely when smoothing is 1', () => {
    expect(calibrateCharsPerSecond(15, 20, 1)).toBe(20);
  });

  it('converges toward a consistently higher real rate over repeated utterances', () => {
    let estimate = 15;
    for (let i = 0; i < 10; i++) {
      estimate = calibrateCharsPerSecond(estimate, 20, 0.5);
    }
    expect(estimate).toBeCloseTo(20, 2);
  });
});
