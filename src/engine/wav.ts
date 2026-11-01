import { levelGain, limitSample, panGains } from "./timing";

export interface MixTrack {
  left: Float32Array;
  right: Float32Array;
  length: number;
  level: number;
  pan: number;
  hasPhrase: boolean;
}

/** Mix looped tracks for `repeats` cycles of the longest phrase. */
export function mixdown(
  tracks: readonly MixTrack[],
  repeats: number,
): { left: Float32Array; right: Float32Array } {
  const cycle = tracks.reduce((max, track) => {
    if (!track.hasPhrase) return max;
    return Math.max(max, track.length);
  }, 0);
  const times = Math.max(1, repeats);
  const total = cycle * times;
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  if (cycle === 0) return { left, right };
  for (let i = 0; i < total; i++) {
    let l = 0;
    let r = 0;
    for (const track of tracks) {
      if (!track.hasPhrase || track.length <= 0) continue;
      const index = i % track.length;
      const gain = levelGain(track.level);
      const pan = panGains(track.pan);
      l += (track.left[index] ?? 0) * gain * pan.l;
      r += (track.right[index] ?? 0) * gain * pan.r;
    }
    left[i] = limitSample(l);
    right[i] = limitSample(r);
  }
  return { left, right };
}

function floatTo16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function writeString(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

export function encodeWavStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): Blob {
  const frames = Math.min(left.length, right.length);
  const buffer = new ArrayBuffer(44 + frames * 4);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + frames * 4, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, frames * 4, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    view.setInt16(offset, floatTo16(left[i] ?? 0), true);
    view.setInt16(offset + 2, floatTo16(right[i] ?? 0), true);
    offset += 4;
  }
  return new Blob([buffer], { type: "audio/wav" });
}
