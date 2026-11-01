/**
 * Sample-clock math for the looper and metronome.
 *
 * Bar quantize uses the nearest whole bar (minimum one bar). The RC-505mkII
 * manual says record length is "quantized" to the measure but does not say
 * whether that rounds to the nearest bar or the next one. Nearest-bar, with
 * a one-bar minimum, is the behavior under test here.
 */

export const MIN_BPM = 40;
export const MAX_BPM = 300;
export const MIN_PHRASE_SEC = 0.1;

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
  return Math.round(clamped * 10) / 10;
}

export function formatBpm(bpm: number): string {
  const rounded = Math.round(bpm * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Integer samples per beat so the grid does not drift. */
export function beatLengthSamples(bpm: number, sampleRate: number): number {
  return Math.max(1, Math.round((60 / clampBpm(bpm)) * sampleRate));
}

export function barLengthSamples(
  bpm: number,
  beatsPerBar: number,
  sampleRate: number,
): number {
  return beatLengthSamples(bpm, sampleRate) * beatsPerBar;
}

/**
 * Next grid boundary at or after `clock`.
 * Boundaries are `origin + n * period`.
 */
export function nextGridSample(clock: number, origin: number, period: number): number {
  if (period <= 0) return clock;
  if (clock <= origin) return origin;
  const elapsed = clock - origin;
  const rem = elapsed % period;
  if (rem === 0) return clock;
  return clock + (period - rem);
}

/**
 * Sample at which a free (first) recording should end when the player
 * asks to close it at `clock`. Length is a whole number of bars, at least one.
 * If the nearest bar is still ahead, the caller waits; if it is behind, the
 * caller trims.
 */
export function masterCloseSample(
  recordStart: number,
  clock: number,
  barLength: number,
): number {
  if (barLength <= 0) return recordStart;
  const recorded = Math.max(0, clock - recordStart);
  let bars = Math.round(recorded / barLength);
  if (bars < 1) bars = 1;
  return recordStart + bars * barLength;
}

export function syncedLength(masterLength: number, multiple: 1 | 2 | 4): number {
  return Math.max(0, masterLength) * multiple;
}

export function minPhraseSamples(sampleRate: number): number {
  return Math.floor(MIN_PHRASE_SEC * sampleRate);
}

export function countInSamples(
  bars: number,
  bpm: number,
  beatsPerBar: number,
  sampleRate: number,
): number {
  return Math.max(0, bars) * barLengthSamples(bpm, beatsPerBar, sampleRate);
}

export interface TapResult {
  bpm: number | null;
  taps: number[];
}

/** Intervals longer than 2 seconds start a fresh tap group. */
export function pushTap(previousTaps: readonly number[], nowMs: number): TapResult {
  const last = previousTaps[previousTaps.length - 1];
  let taps = previousTaps.slice();
  if (last !== undefined && nowMs - last > 2000) taps = [];
  taps.push(nowMs);
  if (taps.length > 6) taps = taps.slice(-6);
  if (taps.length < 2) return { bpm: null, taps };
  const intervals: number[] = [];
  for (let i = 1; i < taps.length; i++) {
    intervals.push(taps[i]! - taps[i - 1]!);
  }
  const recent = intervals.slice(-4);
  const avg = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  if (avg <= 0) return { bpm: null, taps };
  return { bpm: clampBpm(60000 / avg), taps };
}

/**
 * Equal-power pan. Center (0) is unity on both channels.
 * `pan` is -50 (hard left) through 50 (hard right), matching the RC-505.
 */
export function panGains(pan: number): { l: number; r: number } {
  const clamped = Math.min(50, Math.max(-50, pan));
  const p = clamped / 50;
  const angle = ((p + 1) * Math.PI) / 4;
  return {
    l: Math.cos(angle) * Math.SQRT2,
    r: Math.sin(angle) * Math.SQRT2,
  };
}

/** RC-505 play level: 100 is unity, 200 is +6 dB. */
export function levelGain(level: number): number {
  return Math.min(200, Math.max(0, level)) / 100;
}

export function limitSample(x: number): number {
  const a = Math.abs(x);
  if (a <= 0.94) return x;
  const sign = x < 0 ? -1 : 1;
  return sign * (0.94 + Math.tanh(a - 0.94) * 0.06);
}
