/**
 * Sample-accurate clock, metronome, and five-track looper.
 *
 * Runs as a classic AudioWorklet script (bundled to IIFE for Safari).
 * Recorded audio is written on a musical clock shifted earlier by the
 * output latency, so a performance that was played in time with the click
 * lands on the beat. Playback itself stays on the unshifted clock, which is
 * what the click uses, so the loop and the metronome stay together.
 */

declare const sampleRate: number;
declare const currentTime: number;
declare const currentFrame: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

import {
  anyRunning,
  createLooperState,
  isSignatureLocked,
  isTempoLocked,
  reduce,
  type LooperEvent,
  type LooperState,
  type MachineEffect,
} from "../looper-machine";
import type { WorkletCommand } from "../protocol";
import {
  barLengthSamples,
  beatLengthSamples,
  levelGain,
  limitSample,
  masterCloseSample,
  nextGridSample,
  panGains,
} from "../timing";
import { TRACK_COUNT, type InputSource, type PendingAction } from "../types";

const FADE = 192;
const MAX_SECONDS = 120;

interface Buf {
  l: Float32Array;
  r: Float32Array;
  length: number;
}

interface TrackAudio {
  current: Buf;
  alt: Buf;
  gainL: number;
  gainR: number;
  recording: boolean;
  synced: boolean;
  recordStart: number;
  recL: Float32Array | null;
  recR: Float32Array | null;
  dubArm: number;
  dubFrom: number;
  dubFadeOutAt: number;
  dubFadeUntil: number;
}

interface Tail {
  track: number;
  until: number;
  start: number;
  length: number;
  synced: boolean;
  copyUndo: boolean;
  input: InputSource;
}

interface Stereo {
  l: number;
  r: number;
}

interface Scheduled {
  sample: number;
  event: LooperEvent;
}

function emptyBuf(): Buf {
  return { l: new Float32Array(0), r: new Float32Array(0), length: 0 };
}

function mod(value: number, length: number): number {
  if (length <= 0) return 0;
  const wrapped = value % length;
  return wrapped < 0 ? wrapped + length : wrapped;
}

function readFrame(channels: Float32Array[] | undefined, index: number): Stereo {
  if (!channels || channels.length === 0) return { l: 0, r: 0 };
  const left = channels[0]?.[index] ?? 0;
  const right = channels.length > 1 ? (channels[1]?.[index] ?? left) : left;
  return { l: left, r: right };
}

class CarbonLooperProcessor extends AudioWorkletProcessor {
  private state: LooperState;
  private audio: TrackAudio[];
  private queue: Scheduled[] = [];
  private pending: (PendingAction | null)[] = [null, null, null, null, null];
  private gridOrigin = 0;
  private gridLocked = false;
  private metroOrigin = 0;
  private beatSamples: number;
  private barSamples: number;
  private metronome = true;
  private countInBars: 0 | 1 = 1;
  private countInUntil = 0;
  private compensation = 0;
  private now = 0;
  private clickFreq = 1800;
  private clickPhase = 0;
  private clickAmp = 0;
  private lastBeat = -1;
  private inputPeak = 0;
  private lastPost = 0;
  private forcePost = true;
  private tail: Tail | null = null;

  constructor() {
    super();
    this.state = createLooperState(sampleRate, 120);
    this.beatSamples = beatLengthSamples(this.state.bpm, sampleRate);
    this.barSamples = barLengthSamples(this.state.bpm, this.state.beatsPerBar, sampleRate);
    this.audio = Array.from({ length: TRACK_COUNT }, () => this.blank());
    this.refreshGains();
    this.port.onmessage = (event: MessageEvent<WorkletCommand>) => {
      this.onMessage(event.data);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const outL = output?.[0];
    if (!outL) return true;
    const outR = output[1] ?? outL;
    const frames = outL.length;
    const blockStart = currentFrame;
    const inst = inputs[0];
    const mic = inputs[1];
    let peak = 0;

    for (let i = 0; i < frames; i++) {
      this.now = blockStart + i;
      this.drain(this.now);
      const inInst = readFrame(inst, i);
      const inMic = readFrame(mic, i);
      peak = Math.max(peak, Math.abs(inInst.l), Math.abs(inInst.r), Math.abs(inMic.l), Math.abs(inMic.r));
      this.capture(inInst, inMic);
      let l = 0;
      let r = 0;
      const origin = this.gridOrigin;
      for (let t = 0; t < TRACK_COUNT; t++) {
        const phase = this.state.tracks[t]!.phase;
        if (phase !== "play" && phase !== "dub") continue;
        const buf = this.audio[t]!.current;
        if (buf.length <= 0) continue;
        const pos = mod(this.now - origin, buf.length) | 0;
        const track = this.audio[t]!;
        l += (buf.l[pos] ?? 0) * track.gainL;
        r += (buf.r[pos] ?? 0) * track.gainR;
      }
      if (this.clickAmp > 0.0008) {
        const click =
          Math.sin((2 * Math.PI * this.clickFreq * this.clickPhase) / sampleRate) * this.clickAmp;
        this.clickPhase += 1;
        this.clickAmp *= Math.exp(-1 / (sampleRate * 0.016));
        l += click;
        r += click;
      } else {
        this.clickAmp = 0;
      }
      this.tickClick();
      outL[i] = limitSample(l);
      outR[i] = limitSample(r);
    }

    this.inputPeak = Math.max(peak, this.inputPeak * 0.85);
    if (this.forcePost || currentTime - this.lastPost > 0.05) this.postState();
    return true;
  }

  private blank(): TrackAudio {
    return {
      current: emptyBuf(),
      alt: emptyBuf(),
      gainL: 1,
      gainR: 1,
      recording: false,
      synced: false,
      recordStart: 0,
      recL: null,
      recR: null,
      dubArm: Number.POSITIVE_INFINITY,
      dubFrom: 0,
      dubFadeOutAt: -1,
      dubFadeUntil: -1,
    };
  }

  private clock(): number {
    return Math.max(this.now, currentFrame);
  }

  private onMessage(command: WorkletCommand) {
    switch (command.type) {
      case "pressRecPlay":
        this.pressRecPlay(command.track, command.audioTime);
        break;
      case "stop":
        this.stopTrack(command.track);
        break;
      case "clear":
        this.cancelPending(command.track);
        this.apply({ type: "clear", track: command.track });
        this.postState();
        break;
      case "undo":
        this.cancelPending(command.track);
        this.apply({ type: "undo", track: command.track });
        this.postState();
        break;
      case "redo":
        this.apply({ type: "redo", track: command.track });
        this.postState();
        break;
      case "allStart":
        this.queue = [];
        this.pending = [null, null, null, null, null];
        this.apply({ type: "allStart" });
        this.postState();
        break;
      case "allStop":
        this.queue = [];
        this.pending = [null, null, null, null, null];
        this.countInUntil = 0;
        this.apply({ type: "allStop" });
        this.postState();
        break;
      case "setBpm": {
        const before = this.state.bpm;
        this.apply({ type: "setBpm", bpm: command.bpm });
        if (this.state.bpm !== before) this.retargetTempo();
        this.postState();
        break;
      }
      case "setBeatsPerBar": {
        const before = this.state.beatsPerBar;
        this.apply({ type: "setBeatsPerBar", beatsPerBar: command.beatsPerBar });
        if (this.state.beatsPerBar !== before) {
          this.barSamples = this.beatSamples * this.state.beatsPerBar;
        }
        this.postState();
        break;
      }
      case "setMetronome":
        this.metronome = command.on;
        this.postState();
        break;
      case "setCountIn":
        this.countInBars = command.bars;
        this.postState();
        break;
      case "setRecAction":
        this.apply({ type: "setRecAction", action: command.action });
        this.postState();
        break;
      case "setSyncMultiple":
        this.apply({ type: "setSyncMultiple", multiple: command.multiple });
        this.postState();
        break;
      case "setLevel":
        this.apply({ type: "setLevel", track: command.track, level: command.level });
        this.postState();
        break;
      case "setPan":
        this.apply({ type: "setPan", track: command.track, pan: command.pan });
        this.postState();
        break;
      case "setInput":
        this.apply({ type: "setInput", track: command.track, input: command.input });
        this.postState();
        break;
      case "setCompensation":
        this.compensation = Math.max(0, Math.min(sampleRate, command.samples | 0));
        break;
      case "getBuffers":
        this.sendBuffers(command.requestId);
        break;
      case "load":
        this.loadProject(command);
        break;
      default:
        break;
    }
  }

  private pressRecPlay(track: number, audioTime: number) {
    if (track < 0 || track >= TRACK_COUNT) return;
    const sample = Math.max(Math.round(audioTime * sampleRate), this.clock());
    const phase = this.state.tracks[track]!.phase;
    if (phase === "rec" && this.audio[track]!.synced) {
      this.postState();
      return;
    }
    if (phase === "rec") {
      this.cancelPending(track);
      const start = this.audio[track]!.recordStart;
      const end = masterCloseSample(start, sample, this.barSamples);
      const next = this.state.recAction === "rec-dub" ? "dub" : "play";
      this.pending[track] = "commit";
      this.schedule(end, {
        type: "commitRec",
        track,
        length: end - start,
        next,
      });
      this.postState();
      return;
    }

    this.cancelPending(track);

    if (phase === "play") {
      const at = this.closeOthers(track, this.anchorSample(sample));
      this.pending[track] = "dub";
      this.schedule(at, { type: "toDub", track });
      this.postState();
      return;
    }
    if (phase === "dub") {
      const at = this.anchorSample(sample);
      this.pending[track] = "play";
      this.schedule(at, { type: "toPlay", track });
      this.postState();
      return;
    }
    if (phase === "stopped") {
      const at = this.anchorSample(sample);
      this.pending[track] = "play";
      this.schedule(at, { type: "toPlay", track });
      this.postState();
      return;
    }

    const armed = this.armStart(sample, track);
    const start = this.closeOthers(track, armed);
    this.pending[track] = "rec";
    this.schedule(start, { type: "startRec", track });
    this.postState();
  }

  private armStart(sample: number, track: number): number {
    const anchored = this.gridLocked || this.state.tracks.some((item) => item.hasPhrase);
    if (!anchored && !this.queue.some((item) => item.event.type === "startRec")) {
      const origin = sample;
      const start = origin + this.countInBars * this.barSamples;
      this.metroOrigin = origin;
      this.gridOrigin = start;
      this.lastBeat = -1;
      this.countInUntil = this.countInBars > 0 ? start : 0;
      return start;
    }
    if (!this.gridLocked && !this.state.tracks.some((item) => item.hasPhrase)) {
      this.cancelOtherArms(track);
      return this.gridOrigin;
    }
    return nextGridSample(sample, this.gridOrigin, this.barSamples);
  }

  private anchorSample(sample: number): number {
    if (!this.gridLocked && !this.state.tracks.some((item) => item.hasPhrase)) return sample;
    return nextGridSample(sample, this.gridOrigin, this.barSamples);
  }

  /** Push other recorders out of rec/dub. Returns when `except` may begin. */
  private closeOthers(except: number, at: number): number {
    let start = at;
    const dubs: number[] = [];
    for (let i = 0; i < TRACK_COUNT; i++) {
      if (i === except) continue;
      const phase = this.state.tracks[i]!.phase;
      const audio = this.audio[i]!;
      if (phase === "dub") {
        dubs.push(i);
      } else if (phase === "rec" && audio.synced) {
        start = Math.max(start, audio.recordStart + Math.max(audio.current.length, 1));
      } else if (phase === "rec") {
        this.cancelPending(i);
        const end = Math.max(at, masterCloseSample(audio.recordStart, at, this.barSamples));
        this.schedule(end, {
          type: "commitRec",
          track: i,
          length: end - audio.recordStart,
          next: "play",
        });
        start = Math.max(start, end);
      }
    }
    for (const track of dubs) {
      this.cancelPending(track);
      this.schedule(start, { type: "toPlay", track });
    }
    return start;
  }

  private cancelOtherArms(except: number) {
    this.queue = this.queue.filter((item) => {
      const track = "track" in item.event ? item.event.track : -1;
      if (track === except) return true;
      if (item.event.type === "startRec") {
        this.pending[track] = null;
        return false;
      }
      return true;
    });
  }

  private stopTrack(track: number) {
    this.cancelPending(track);
    const phase = this.state.tracks[track]?.phase;
    if (phase === "rec" || phase === "dub" || phase === "play") {
      this.apply({ type: "stop", track });
    }
    if (!this.state.tracks.some((item) => item.hasPhrase || item.phase === "rec" || item.phase === "play" || item.phase === "dub")) {
      this.gridLocked = false;
      this.countInUntil = 0;
    }
    this.postState();
  }

  private cancelPending(track: number) {
    this.queue = this.queue.filter((item) => !("track" in item.event) || item.event.track !== track);
    this.pending[track] = null;
  }

  private schedule(sample: number, event: LooperEvent) {
    if (sample <= this.clock()) {
      this.apply(event);
      return;
    }
    let index = this.queue.length;
    while (index > 0 && this.queue[index - 1]!.sample > sample) index -= 1;
    this.queue.splice(index, 0, { sample, event });
  }

  private drain(sample: number) {
    while (this.queue.length > 0 && this.queue[0]!.sample <= sample) {
      const item = this.queue.shift()!;
      this.apply(item.event);
    }
  }

  private apply(event: LooperEvent) {
    if ("track" in event) this.pending[event.track] = null;
    const before = this.state.bpm;
    const result = reduce(this.state, event);
    this.state = result.state;
    if (this.state.bpm !== before) this.retargetTempo();
    for (const effect of result.effects) this.applyEffect(effect);
    this.refreshGains();
    this.forcePost = true;
    if (!this.state.tracks.some((track) => track.hasPhrase || track.phase === "rec")) {
      this.gridLocked = false;
    }
  }

  private applyEffect(effect: MachineEffect) {
    switch (effect.type) {
      case "beginRec":
        this.beginRec(effect.track);
        break;
      case "cancelRec":
        this.cancelRec(effect.track);
        break;
      case "commitPhrase":
        this.commitPhrase(effect.track, effect.length, effect.then);
        this.port.postMessage({ type: "loopClosed" });
        break;
      case "snapshotUndo":
        this.snapshot(effect.track);
        this.armDub(effect.track);
        if (this.tail && this.tail.track === effect.track) this.tail.copyUndo = true;
        break;
      case "endDub":
        this.audio[effect.track]!.dubFadeOutAt = this.now;
        this.audio[effect.track]!.dubFadeUntil = this.now + Math.max(FADE, this.compensation);
        break;
      case "swapUndo":
        this.swap(effect.track);
        if (this.tail?.track === effect.track) this.tail = null;
        break;
      case "clearBuffers":
        this.audio[effect.track] = this.blank();
        if (this.tail?.track === effect.track) this.tail = null;
        this.refreshGains();
        break;
      case "resetCycle":
        this.gridOrigin = this.now;
        this.metroOrigin = this.now;
        this.lastBeat = -1;
        this.gridLocked = this.state.masterLengthSamples > 0;
        break;
      case "message":
        this.port.postMessage({ type: "notice", text: effect.text });
        break;
      default:
        break;
    }
  }

  private beginRec(track: number) {
    const audio = this.audio[track]!;
    audio.recording = true;
    audio.recordStart = this.now;
    audio.dubFadeUntil = -1;
    audio.dubFadeOutAt = -1;
    this.gridLocked = true;
    this.countInUntil = 0;
    if (this.state.masterLengthSamples > 0) {
      const length = this.state.masterLengthSamples * this.state.syncMultiple;
      audio.synced = true;
      audio.current = {
        l: new Float32Array(length),
        r: new Float32Array(length),
        length,
      };
      audio.alt = emptyBuf();
      audio.recL = null;
      audio.recR = null;
      const next = this.state.recAction === "rec-dub" ? "dub" : "play";
      this.schedule(this.now + length, { type: "commitRec", track, length, next });
    } else {
      audio.synced = false;
      const initial = Math.max(this.barSamples, 1);
      audio.recL = new Float32Array(initial);
      audio.recR = new Float32Array(initial);
      audio.current = emptyBuf();
    }
  }

  private cancelRec(track: number) {
    const audio = this.audio[track]!;
    audio.recording = false;
    audio.synced = false;
    audio.recL = null;
    audio.recR = null;
    if (this.tail?.track === track) this.tail = null;
  }

  private commitPhrase(track: number, length: number, then: "play" | "dub") {
    const audio = this.audio[track]!;
    const safe = Math.max(1, length | 0);
    if (!audio.synced) {
      const left = new Float32Array(safe);
      const right = new Float32Array(safe);
      const have = Math.min(safe, audio.recL?.length ?? 0);
      if (audio.recL && audio.recR && have > 0) {
        left.set(audio.recL.subarray(0, have));
        right.set(audio.recR.subarray(0, have));
      }
      const fade = Math.min(FADE, Math.floor(safe / 4));
      for (let i = 0; i < fade; i++) {
        const gain = fade === 0 ? 1 : i / fade;
        left[i] = (left[i] ?? 0) * gain;
        right[i] = (right[i] ?? 0) * gain;
      }
      if (this.compensation <= 0) {
        for (let i = 0; i < fade; i++) {
          const gain = fade === 0 ? 0 : 1 - i / fade;
          const index = safe - fade + i;
          left[index] = (left[index] ?? 0) * gain;
          right[index] = (right[index] ?? 0) * gain;
        }
      }
      audio.current = { l: left, r: right, length: safe };
    }
    audio.recording = false;
    audio.recL = null;
    audio.recR = null;
    audio.alt = emptyBuf();
    if (this.compensation > 0) {
      this.tail = {
        track,
        until: audio.recordStart + safe + this.compensation,
        start: audio.recordStart,
        length: safe,
        synced: audio.synced,
        copyUndo: false,
        input: this.state.tracks[track]!.input,
      };
    }
    if (then === "play") {
      audio.dubFadeUntil = -1;
    }
  }

  private armDub(track: number) {
    const audio = this.audio[track]!;
    audio.dubArm = this.now + this.compensation;
    audio.dubFrom = this.now;
    audio.dubFadeOutAt = -1;
    audio.dubFadeUntil = -1;
  }

  private snapshot(track: number) {
    const audio = this.audio[track]!;
    const copyL = new Float32Array(audio.current.length);
    const copyR = new Float32Array(audio.current.length);
    copyL.set(audio.current.l.subarray(0, audio.current.length));
    copyR.set(audio.current.r.subarray(0, audio.current.length));
    audio.alt = { l: copyL, r: copyR, length: audio.current.length };
  }

  private swap(track: number) {
    const audio = this.audio[track]!;
    const current = audio.current;
    audio.current = audio.alt;
    audio.alt = current;
    audio.dubFadeUntil = -1;
  }

  private capture(inst: Stereo, mic: Stereo) {
    if (this.tail && this.now <= this.tail.until) {
      this.writeTail(this.tail.input === "mic" ? mic : inst);
    } else if (this.tail) {
      this.tail = null;
    }

    let rec = -1;
    for (let track = 0; track < TRACK_COUNT; track++) {
      const phase = this.state.tracks[track]!.phase;
      if (phase === "rec" || phase === "dub") {
        rec = track;
        break;
      }
    }
    if (rec >= 0) {
      const source = this.state.tracks[rec]!.input === "mic" ? mic : inst;
      if (this.state.tracks[rec]!.phase === "rec") this.writeRec(rec, source);
    }
    for (let track = 0; track < TRACK_COUNT; track++) {
      const audio = this.audio[track]!;
      const dubbing = this.state.tracks[track]!.phase === "dub";
      const fading = audio.dubFadeUntil >= this.now;
      if ((dubbing && this.now >= audio.dubArm) || fading) {
        const source = this.state.tracks[track]!.input === "mic" ? mic : inst;
        this.writeDub(track, source);
      }
    }
  }

  private writeRec(track: number, source: Stereo) {
    const audio = this.audio[track]!;
    const musical = this.now - this.compensation;
    const into = musical - audio.recordStart;
    if (into < 0) return;
    if (audio.synced) {
      const length = audio.current.length;
      if (into >= length) return;
      const index = mod(musical - this.gridOrigin, length) | 0;
      const gain = this.edgeGain(into, length);
      audio.current.l[index] = source.l * gain;
      audio.current.r[index] = source.r * gain;
      return;
    }
    const index = into | 0;
    const cap = (sampleRate * MAX_SECONDS) | 0;
    if (index >= cap) {
      this.schedule(this.now, {
        type: "commitRec",
        track,
        length: this.barSamples * Math.max(1, Math.floor(cap / this.barSamples)),
        next: this.state.recAction === "rec-dub" ? "dub" : "play",
      });
      return;
    }
    if (!audio.recL || !audio.recR || index >= audio.recL.length) {
      const nextLen = Math.min(cap, Math.max(index + 1, (audio.recL?.length ?? this.barSamples) * 2));
      const left = new Float32Array(nextLen);
      const right = new Float32Array(nextLen);
      if (audio.recL && audio.recR) {
        left.set(audio.recL);
        right.set(audio.recR);
      }
      audio.recL = left;
      audio.recR = right;
    }
    audio.recL[index] = source.l;
    audio.recR[index] = source.r;
  }

  private writeDub(track: number, source: Stereo) {
    const audio = this.audio[track]!;
    const length = audio.current.length;
    if (length <= 0) return;
    const musical = this.now - this.compensation;
    const into = musical - audio.dubFrom;
    if (into < 0) return;
    const index = mod(musical - this.gridOrigin, length) | 0;
    let gain = into < FADE ? into / FADE : 1;
    if (audio.dubFadeOutAt >= 0) {
      const span = Math.max(1, audio.dubFadeUntil - audio.dubFadeOutAt);
      gain *= Math.max(0, (audio.dubFadeUntil - this.now) / span);
    }
    audio.current.l[index] = (audio.current.l[index] ?? 0) + source.l * gain;
    audio.current.r[index] = (audio.current.r[index] ?? 0) + source.r * gain;
  }

  private writeTail(source: Stereo) {
    const tail = this.tail;
    if (!tail) return;
    const musical = this.now - this.compensation;
    const into = musical - tail.start;
    if (into < 0 || into >= tail.length) return;
    const audio = this.audio[tail.track]!;
    const index = tail.synced ? (mod(musical - this.gridOrigin, tail.length) | 0) : (into | 0);
    if (index < 0 || index >= audio.current.length) return;
    const gain = this.edgeGain(into, tail.length);
    audio.current.l[index] = source.l * gain;
    audio.current.r[index] = source.r * gain;
    if (tail.copyUndo && audio.alt.length === audio.current.length) {
      audio.alt.l[index] = source.l * gain;
      audio.alt.r[index] = source.r * gain;
    }
  }

  private edgeGain(into: number, length: number): number {
    const fade = Math.min(FADE, Math.max(1, Math.floor(length / 4)));
    if (into < fade) return into / fade;
    if (into > length - fade) return Math.max(0, (length - into) / fade);
    return 1;
  }

  private tickClick() {
    if (this.now < this.metroOrigin || this.beatSamples <= 0) return;
    const beatIndex = Math.floor((this.now - this.metroOrigin) / this.beatSamples);
    if (beatIndex === this.lastBeat) return;
    this.lastBeat = beatIndex;
    const audible = this.metronome || this.now < this.countInUntil;
    if (!audible) return;
    this.triggerClick(beatIndex % this.state.beatsPerBar === 0);
  }

  private triggerClick(downbeat: boolean) {
    this.clickPhase = 0;
    this.clickFreq = downbeat ? 1960 : 1180;
    this.clickAmp = downbeat ? 0.38 : 0.2;
  }

  private retargetTempo() {
    const elapsed = Math.max(0, this.now - this.metroOrigin);
    const fraction = this.beatSamples > 0 ? elapsed / this.beatSamples : 0;
    this.beatSamples = beatLengthSamples(this.state.bpm, sampleRate);
    this.barSamples = this.beatSamples * this.state.beatsPerBar;
    this.metroOrigin = this.now - fraction * this.beatSamples;
    this.lastBeat = Math.floor(Math.max(0, this.now - this.metroOrigin) / this.beatSamples);
  }

  private refreshGains() {
    for (let track = 0; track < TRACK_COUNT; track++) {
      const source = this.state.tracks[track]!;
      const pan = panGains(source.pan);
      const gain = levelGain(source.level);
      this.audio[track]!.gainL = gain * pan.l;
      this.audio[track]!.gainR = gain * pan.r;
    }
  }

  private postState() {
    this.lastPost = currentTime;
    this.forcePost = false;
    const tracks = this.state.tracks.map((track, index) => {
      const audio = this.audio[index]!;
      let position = 0;
      if (track.lengthSamples > 0 && (track.phase === "play" || track.phase === "dub")) {
        position = mod(this.now - this.gridOrigin, track.lengthSamples) / track.lengthSamples;
      }
      let recProgress = 0;
      if (track.phase === "rec") {
        const target = audio.synced ? audio.current.length : this.barSamples;
        const into = Math.max(0, this.now - audio.recordStart);
        recProgress = target > 0 ? Math.min(0.999, (into % target) / target) : 0;
        if (audio.synced && target > 0) recProgress = Math.min(1, into / target);
      }
      return {
        phase: track.phase,
        hasPhrase: track.hasPhrase,
        canUndo: track.canUndo,
        canRedo: track.canRedo,
        level: track.level,
        pan: track.pan,
        input: track.input,
        lengthSamples: track.lengthSamples,
        originalBpm: track.originalBpm,
        position,
        recProgress,
        pending: this.pending[index] ?? null,
      };
    });
    let beat = -1;
    let bar = 0;
    if (this.now >= this.metroOrigin && this.beatSamples > 0) {
      const beats = Math.floor((this.now - this.metroOrigin) / this.beatSamples);
      beat = beats % this.state.beatsPerBar;
      bar = Math.floor(beats / this.state.beatsPerBar);
    }
    const running =
      anyRunning(this.state) ||
      this.pending.some((item) => item !== null) ||
      this.now < this.countInUntil;
    this.port.postMessage({
      type: "state",
      bpm: this.state.bpm,
      beatsPerBar: this.state.beatsPerBar,
      recAction: this.state.recAction,
      syncMultiple: this.state.syncMultiple,
      metronome: this.metronome,
      countInBars: this.countInBars,
      beat,
      bar,
      countIn: this.now < this.countInUntil,
      anyRunning: running,
      tempoLocked: isTempoLocked(this.state),
      signatureLocked: isSignatureLocked(this.state),
      masterLengthSamples: this.state.masterLengthSamples,
      inputPeak: this.inputPeak,
      tracks,
    });
  }

  private sendBuffers(requestId: string) {
    const tracks = this.audio.map((audio, index) => {
      const track = this.state.tracks[index]!;
      const length = track.hasPhrase ? audio.current.length : 0;
      const left = new Float32Array(length);
      const right = new Float32Array(length);
      if (length > 0) {
        left.set(audio.current.l.subarray(0, length));
        right.set(audio.current.r.subarray(0, length));
      }
      return {
        length,
        hasPhrase: track.hasPhrase,
        level: track.level,
        pan: track.pan,
        input: track.input,
        originalBpm: track.originalBpm,
        left: left.buffer,
        right: right.buffer,
      };
    });
    const transfer = tracks.flatMap((track) => [track.left, track.right]);
    this.port.postMessage(
      {
        type: "buffers",
        requestId,
        sampleRate,
        bpm: this.state.bpm,
        beatsPerBar: this.state.beatsPerBar,
        recAction: this.state.recAction,
        syncMultiple: this.state.syncMultiple,
        masterLengthSamples: this.state.masterLengthSamples,
        masterTrack: this.state.masterTrack,
        tracks,
      },
      transfer,
    );
  }

  private loadProject(command: Extract<WorkletCommand, { type: "load" }>) {
    this.queue = [];
    this.pending = [null, null, null, null, null];
    this.tail = null;
    this.countInUntil = 0;
    let next = createLooperState(sampleRate, command.bpm);
    next = {
      ...next,
      bpm: command.bpm,
      beatsPerBar: command.beatsPerBar,
      recAction: command.recAction,
      syncMultiple: command.syncMultiple,
      masterLengthSamples: command.masterLengthSamples,
      masterTrack: command.masterTrack,
    };
    this.audio = command.tracks.map((track) => {
      const audio = this.blank();
      const length = track.length;
      const left = new Float32Array(track.left);
      const right = new Float32Array(track.right);
      if (length > 0) {
        audio.current = { l: left, r: right, length };
      }
      return audio;
    });
    while (this.audio.length < TRACK_COUNT) this.audio.push(this.blank());
    next = {
      ...next,
      tracks: command.tracks.map((track, index) => {
        const base = next.tracks[index]!;
        return {
          ...base,
          phase: track.length > 0 ? "stopped" : "empty",
          hasPhrase: track.length > 0,
          lengthSamples: track.length,
          level: track.level,
          pan: track.pan,
          input: track.input,
          originalBpm: track.originalBpm,
        };
      }) as LooperState["tracks"],
    };
    this.state = next;
    this.beatSamples = beatLengthSamples(next.bpm, sampleRate);
    this.barSamples = this.beatSamples * next.beatsPerBar;
    this.gridLocked = next.masterLengthSamples > 0;
    this.gridOrigin = this.clock();
    this.metroOrigin = this.gridOrigin;
    this.refreshGains();
    this.postState();
  }
}

registerProcessor("carbon-looper", CarbonLooperProcessor);
