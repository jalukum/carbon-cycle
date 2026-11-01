/**
 * Built-in instruments. They live on the audio graph, not in the worklet,
 * and feed both the speakers and the looper's instrument input.
 */

export type InstrumentMode = "synth" | "drums";

interface Voice {
  gain: GainNode;
  oscs: OscillatorNode[];
  born: number;
  release(time: number): void;
}

const DRUM_NAMES: Record<number, string> = {
  35: "Sub",
  36: "Kick",
  37: "Rim",
  38: "Snare",
  39: "Clap",
  42: "Hat",
  45: "Tom L",
  46: "Open",
  47: "Tom M",
  49: "Crash",
  50: "Tom H",
  51: "Ride",
  56: "Cowbell",
  62: "Conga",
  70: "Shaker",
  75: "Clave",
};

export const DRUM_PADS: { note: number; name: string }[] = [
  { note: 36, name: "Kick" },
  { note: 38, name: "Snare" },
  { note: 37, name: "Rim" },
  { note: 39, name: "Clap" },
  { note: 42, name: "Hat" },
  { note: 46, name: "Open" },
  { note: 45, name: "Tom L" },
  { note: 47, name: "Tom M" },
  { note: 50, name: "Tom H" },
  { note: 49, name: "Crash" },
  { note: 51, name: "Ride" },
  { note: 70, name: "Shaker" },
  { note: 56, name: "Cowbell" },
  { note: 62, name: "Conga" },
  { note: 35, name: "Sub" },
  { note: 75, name: "Clave" },
];

export function drumName(note: number): string {
  return DRUM_NAMES[note] ?? "Perc";
}

export class InstrumentRack {
  readonly output: GainNode;
  private readonly synthBus: GainNode;
  private readonly ctx: AudioContext;
  private voices = new Map<number, Voice>();
  private held = new Set<number>();
  private waiting = new Set<number>();
  private sustain = false;
  private noise: AudioBuffer;
  private mode: InstrumentMode = "synth";

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0.95;
    this.synthBus = ctx.createGain();

    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 28;
    highpass.Q.value = 0.7;

    const dry = ctx.createGain();
    dry.gain.value = 0.82;
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.014;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.22;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.0045;
    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime);
    lfo.start();

    this.synthBus.connect(highpass);
    highpass.connect(dry);
    highpass.connect(delay);
    delay.connect(wet);
    dry.connect(this.output);
    wet.connect(this.output);

    const length = Math.floor(ctx.sampleRate * 1.2);
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  setMode(mode: InstrumentMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.allNotesOff();
  }

  getMode(): InstrumentMode {
    return this.mode;
  }

  setSustain(on: boolean) {
    this.sustain = on;
    if (!on) {
      for (const note of this.waiting) {
        if (!this.held.has(note)) this.release(note);
      }
      this.waiting.clear();
    }
  }

  noteOn(note: number, velocity = 0.85) {
    if (this.mode === "drums") {
      this.playDrum(note, velocity);
      return;
    }
    const vel = Math.min(1, Math.max(0.05, velocity));
    this.held.add(note);
    this.waiting.delete(note);
    this.startVoice(note, vel);
  }

  noteOff(note: number) {
    if (this.mode === "drums") return;
    this.held.delete(note);
    if (this.sustain) {
      this.waiting.add(note);
      return;
    }
    this.release(note);
  }

  allNotesOff() {
    this.held.clear();
    this.waiting.clear();
    const now = this.ctx.currentTime;
    for (const voice of this.voices.values()) voice.release(now);
    this.voices.clear();
  }

  private startVoice(note: number, velocity: number) {
    const existing = this.voices.get(note);
    const now = this.ctx.currentTime;
    if (existing) existing.release(now);
    if (this.voices.size >= 12) {
      let oldestNote = note;
      let oldestBorn = Infinity;
      for (const [key, voice] of this.voices) {
        if (voice.born < oldestBorn) {
          oldestBorn = voice.born;
          oldestNote = key;
        }
      }
      this.release(oldestNote);
    }

    const freq = 440 * 2 ** ((note - 69) / 12);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.85;
    const open = Math.min(6400, Math.max(900, freq * 7));
    const close = Math.min(2800, Math.max(280, freq * 2.4));
    filter.frequency.setValueAtTime(Math.max(80, freq), now);
    filter.frequency.exponentialRampToValueAtTime(open, now + 0.035);
    filter.frequency.exponentialRampToValueAtTime(close, now + 0.42);

    const gain = this.ctx.createGain();
    const peak = 0.11 * (0.4 + 0.6 * velocity);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.7), now + 0.32);
    filter.connect(gain);
    gain.connect(this.synthBus);

    const oscs: OscillatorNode[] = [];
    const partials: Array<{ type: OscillatorType; mult: number; detune: number; amount: number }> = [
      { type: "sawtooth", mult: 1, detune: -7, amount: 0.52 },
      { type: "sawtooth", mult: 1, detune: 9, amount: 0.42 },
      { type: "triangle", mult: 0.5, detune: 0, amount: 0.32 },
    ];
    for (const partial of partials) {
      const osc = this.ctx.createOscillator();
      osc.type = partial.type;
      osc.frequency.setValueAtTime(freq * partial.mult, now);
      osc.detune.setValueAtTime(partial.detune, now);
      const level = this.ctx.createGain();
      level.gain.value = partial.amount;
      osc.connect(level);
      level.connect(filter);
      osc.start(now);
      oscs.push(osc);
    }

    const voice: Voice = {
      gain,
      oscs,
      born: now,
      release(time: number) {
        const param = gain.gain;
        param.cancelScheduledValues(time);
        const current = Math.max(0.0001, param.value);
        param.setValueAtTime(current, time);
        param.exponentialRampToValueAtTime(0.0001, time + 0.38);
        for (const osc of oscs) {
          try {
            osc.stop(time + 0.4);
          } catch {
            /* already stopped */
          }
        }
      },
    };
    this.voices.set(note, voice);
    window.setTimeout(() => {
      if (this.voices.get(note) === voice && !this.held.has(note) && !this.waiting.has(note)) {
        this.voices.delete(note);
      }
    }, 800);
  }

  private release(note: number) {
    const voice = this.voices.get(note);
    if (!voice) return;
    voice.release(this.ctx.currentTime);
    this.voices.delete(note);
  }

  private playDrum(note: number, velocity: number) {
    const now = this.ctx.currentTime;
    const vel = Math.min(1, Math.max(0.15, velocity));
    switch (note) {
      case 35:
        this.tone(now, 78, 42, 0.42, vel * 0.95, "sine");
        break;
      case 36:
        this.tone(now, 168, 52, 0.28, vel * 0.9, "sine");
        this.noiseBurst(now, 0.04, 180, 0.22 * vel, "bandpass");
        break;
      case 38:
        this.tone(now, 196, 140, 0.16, vel * 0.35, "triangle");
        this.noiseBurst(now, 0.18, 1800, 0.45 * vel, "highpass");
        break;
      case 37:
        this.tone(now, 420, 180, 0.06, vel * 0.4, "square");
        this.noiseBurst(now, 0.03, 2400, 0.18 * vel, "highpass");
        break;
      case 39:
        this.noiseBurst(now, 0.12, 1400, 0.4 * vel, "bandpass");
        this.noiseBurst(now + 0.012, 0.1, 1800, 0.28 * vel, "bandpass");
        break;
      case 42:
        this.noiseBurst(now, 0.045, 7000, 0.28 * vel, "highpass");
        break;
      case 46:
        this.noiseBurst(now, 0.28, 6200, 0.26 * vel, "highpass");
        break;
      case 45:
        this.tone(now, 140, 70, 0.28, vel * 0.55, "sine");
        break;
      case 47:
        this.tone(now, 180, 96, 0.24, vel * 0.5, "sine");
        break;
      case 50:
        this.tone(now, 240, 130, 0.2, vel * 0.48, "sine");
        break;
      case 49:
        this.noiseBurst(now, 0.7, 5000, 0.32 * vel, "highpass");
        this.tone(now, 320, 180, 0.4, vel * 0.12, "triangle");
        break;
      case 51:
        this.tone(now, 420, 280, 0.45, vel * 0.16, "triangle");
        this.noiseBurst(now, 0.35, 4000, 0.12 * vel, "highpass");
        break;
      case 70:
        this.noiseBurst(now, 0.08, 6500, 0.2 * vel, "highpass");
        break;
      case 56:
        this.tone(now, 587, 540, 0.18, vel * 0.28, "square");
        break;
      case 62:
        this.tone(now, 220, 110, 0.22, vel * 0.45, "sine");
        break;
      case 75:
        this.tone(now, 2100, 1400, 0.05, vel * 0.22, "square");
        break;
      default:
        this.noiseBurst(now, 0.08, 3000, 0.22 * vel, "bandpass");
        break;
    }
  }

  private tone(
    time: number,
    fromHz: number,
    toHz: number,
    duration: number,
    amount: number,
    type: OscillatorType,
  ) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, fromHz), time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, toHz), time + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, amount), time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(gain);
    gain.connect(this.output);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  private noiseBurst(
    time: number,
    duration: number,
    cutoff: number,
    amount: number,
    kind: BiquadFilterType,
  ) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = kind;
    filter.frequency.value = cutoff;
    filter.Q.value = kind === "bandpass" ? 0.8 : 0.7;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, amount), time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.output);
    source.start(time);
    source.stop(time + duration + 0.02);
  }
}
