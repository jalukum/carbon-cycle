import { describe, expect, it } from "vitest";
import {
  barLengthSamples,
  beatLengthSamples,
  clampBpm,
  countInSamples,
  levelGain,
  masterCloseSample,
  minPhraseSamples,
  nextGridSample,
  panGains,
  pushTap,
  syncedLength,
} from "./timing";

describe("tempo clamps and bar length", () => {
  it("clamps tempo to 40–300 BPM", () => {
    expect(clampBpm(20)).toBe(40);
    expect(clampBpm(400)).toBe(300);
    expect(clampBpm(120)).toBe(120);
    expect(clampBpm(Number.NaN)).toBe(120);
    expect(clampBpm(99.96)).toBe(100);
  });

  it("computes integer beat and bar lengths", () => {
    expect(beatLengthSamples(120, 48000)).toBe(24000);
    expect(barLengthSamples(120, 4, 48000)).toBe(96000);
    expect(barLengthSamples(120, 3, 48000)).toBe(72000);
    expect(beatLengthSamples(100, 48000)).toBe(28800);
    expect(barLengthSamples(90, 3, 44100)).toBe(88200);
  });

  it("counts in whole bars", () => {
    expect(countInSamples(1, 120, 4, 48000)).toBe(96000);
    expect(countInSamples(0, 120, 4, 48000)).toBe(0);
  });

  it("uses a 0.1 second minimum phrase", () => {
    expect(minPhraseSamples(48000)).toBe(4800);
    expect(minPhraseSamples(44100)).toBe(4410);
  });
});

describe("grid and record-length quantize", () => {
  it("finds the next boundary on an arbitrary grid origin", () => {
    expect(nextGridSample(1000, 1000, 1000)).toBe(1000);
    expect(nextGridSample(1001, 1000, 1000)).toBe(2000);
    expect(nextGridSample(500, 1000, 1000)).toBe(1000);
    expect(nextGridSample(2000, 0, 500)).toBe(2000);
    expect(nextGridSample(2001, 0, 500)).toBe(2500);
  });

  it("rounds a first loop to the nearest bar, minimum one", () => {
    const bar = 96000;
    expect(masterCloseSample(0, 96000, bar)).toBe(96000);
    expect(masterCloseSample(0, 96100, bar)).toBe(96000);
    expect(masterCloseSample(0, 140000, bar)).toBe(96000);
    expect(masterCloseSample(0, 150000, bar)).toBe(192000);
    expect(masterCloseSample(0, 400, bar)).toBe(96000);
    expect(masterCloseSample(1000, 1000 + 96000, bar)).toBe(1000 + 96000);
  });

  it("locks later loops to the master length or a multiple", () => {
    expect(syncedLength(96000, 1)).toBe(96000);
    expect(syncedLength(96000, 2)).toBe(192000);
    expect(syncedLength(96000, 4)).toBe(384000);
  });
});

describe("tap tempo", () => {
  it("averages recent tap intervals", () => {
    let taps: number[] = [];
    let bpm: number | null = null;
    for (const t of [0, 500, 1000, 1500]) {
      const result = pushTap(taps, t);
      taps = result.taps;
      bpm = result.bpm;
    }
    expect(bpm).toBe(120);
  });

  it("starts over after a long gap", () => {
    const first = pushTap([], 0);
    const second = pushTap(first.taps, 500);
    expect(second.bpm).toBe(120);
    const reset = pushTap(second.taps, 500 + 2500);
    expect(reset.bpm).toBeNull();
    expect(reset.taps).toEqual([3000]);
  });

  it("clamps very fast tapping", () => {
    let taps: number[] = [];
    let bpm: number | null = null;
    for (const t of [0, 100, 200, 300]) {
      const result = pushTap(taps, t);
      taps = result.taps;
      bpm = result.bpm;
    }
    expect(bpm).toBe(300);
  });
});

describe("level and pan", () => {
  it("maps play level 100 to unity and 200 to double", () => {
    expect(levelGain(100)).toBe(1);
    expect(levelGain(200)).toBe(2);
    expect(levelGain(0)).toBe(0);
    expect(levelGain(250)).toBe(2);
  });

  it("keeps center pan at unity on both channels", () => {
    const center = panGains(0);
    expect(center.l).toBeCloseTo(1, 5);
    expect(center.r).toBeCloseTo(1, 5);
    const left = panGains(-50);
    expect(left.l).toBeCloseTo(Math.SQRT2, 5);
    expect(left.r).toBeCloseTo(0, 5);
    const right = panGains(50);
    expect(right.l).toBeCloseTo(0, 5);
    expect(right.r).toBeCloseTo(Math.SQRT2, 5);
  });
});
