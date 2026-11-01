import { describe, expect, it } from "vitest";
import { encodeWavStereo, mixdown } from "./wav";

describe("mixdown and wav", () => {
  it("loops a centered phrase at unity play level", () => {
    const left = new Float32Array([0.5, 0.25]);
    const right = new Float32Array([0.5, 0.25]);
    const mixed = mixdown(
      [
        {
          left,
          right,
          length: 2,
          level: 100,
          pan: 0,
          hasPhrase: true,
        },
      ],
      2,
    );
    expect(mixed.left.length).toBe(4);
    expect(mixed.left[0]).toBeCloseTo(0.5, 5);
    expect(mixed.left[2]).toBeCloseTo(0.5, 5);
    expect(mixed.right[1]).toBeCloseTo(0.25, 5);
  });

  it("writes a stereo PCM header", () => {
    const blob = encodeWavStereo(new Float32Array([0, 0.5]), new Float32Array([0, -0.5]), 48000);
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + 8);
  });
});
