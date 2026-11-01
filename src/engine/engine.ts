/**
 * Typed facade for Carbon Cycle's audio core.
 *
 * UI code talks only to AudioEngine. The looper, clock, and metronome run in
 * an AudioWorklet so loop boundaries stay on the sample clock. The synth and
 * drum kit are Web Audio graphs on the main thread; their output is a second
 * input to the worklet, beside the microphone.
 *
 * Latency: AudioContext is created with latencyHint "interactive". Recording
 * is shifted earlier by outputLatency (plus an optional nudge) so notes played
 * against the click land on the beat. Live monitoring does not go through the
 * looper, so you hear yourself without waiting for that compensation.
 */

import { InstrumentRack } from "./instruments";
import { attachMidi, type MidiStatus } from "./midi";
import type { BuffersWire, StateWire, WorkletCommand, WorkletNotice } from "./protocol";
import { hasProject, loadProject, saveProject, type StoredProject } from "./storage";
import {
  defaultSnapshot,
  emptyTrackSnapshot,
  type BeatsPerBar,
  type EngineSnapshot,
  type InputSource,
  type InstrumentMode,
  type RecAction,
  type SyncMultiple,
} from "./types";
import { barLengthSamples, clampBpm, pushTap } from "./timing";
import { encodeWavStereo, mixdown } from "./wav";

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private instruments: InstrumentRack | null = null;
  private micStream: MediaStream | null = null;
  private micGain: GainNode | null = null;
  private monitorGain: GainNode | null = null;
  private snap: EngineSnapshot = defaultSnapshot();
  private listeners = new Set<() => void>();
  private taps: number[] = [];
  private previousBpm = 120;
  private midi: MidiStatus | null = null;
  private requests = new Map<string, (buffers: BuffersWire) => void>();
  private messageTimer = 0;
  private wake: WakeLockSentinel | null = null;
  private nudgeMs = 0;
  private booted = false;

  constructor() {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          void this.ctx?.resume();
          void this.syncWake();
        }
      });
    }
  }

  getState(): EngineSnapshot {
    return this.snap;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private patch(partial: Partial<EngineSnapshot>) {
    this.snap = { ...this.snap, ...partial };
    this.emit();
  }

  private flash(text: string) {
    this.patch({ message: text });
    window.clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => {
      if (this.snap.message === text) this.patch({ message: null });
    }, 2600);
  }

  dismissMessage() {
    this.patch({ message: null });
  }

  async unlock(): Promise<void> {
    if (this.booted && this.ctx) {
      await this.ctx.resume();
      this.patch({ audioUnlocked: true });
      return;
    }
    try {
      await this.boot();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Audio couldn't start.";
      this.patch({ error: message, audioUnlocked: true });
      this.flash(message);
      return;
    }
    this.patch({ audioUnlocked: true });
  }

  private async boot() {
    const nav = navigator as AudioSessionNav;
    if (nav.audioSession) {
      try {
        nav.audioSession.type = "playback";
      } catch {
        /* Older browsers have no audio session. */
      }
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error("This browser has no Web Audio.");
    this.ctx = new Ctor({ latencyHint: "interactive" });
    await this.ctx.resume();
    const silent = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const blip = this.ctx.createBufferSource();
    blip.buffer = silent;
    blip.connect(this.ctx.destination);
    blip.start();

    this.instruments = new InstrumentRack(this.ctx);
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 18;
    compressor.ratio.value = 2.2;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;
    const master = this.ctx.createGain();
    master.gain.value = 0.9;
    this.instruments.output.connect(master);

    this.monitorGain = this.ctx.createGain();
    this.monitorGain.gain.value = 0.85;
    this.monitorGain.connect(master);
    master.connect(compressor);
    compressor.connect(this.ctx.destination);

    const url = `${import.meta.env.BASE_URL}looper-processor.js`;
    await this.ctx.audioWorklet.addModule(url);
    this.node = new AudioWorkletNode(this.ctx, "carbon-looper", {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
    });
    this.instruments.output.connect(this.node, 0, 0);
    this.node.connect(master);
    this.node.port.onmessage = (event: MessageEvent<WorkletNotice>) => {
      this.onNotice(event.data);
    };

    this.booted = true;
    this.patch({
      workletReady: true,
      error: null,
      baseLatencyMs: Math.round((this.ctx.baseLatency || 0) * 1000),
      outputLatencyMs: Math.round((this.ctx.outputLatency || 0) * 1000),
    });
    this.pushCompensation();
    this.post({ type: "setMetronome", on: this.snap.metronome });
    this.post({ type: "setCountIn", bars: this.snap.countInBars });
    void this.refreshSavedFlag();
    void this.startMidi();
  }

  private onNotice(notice: WorkletNotice) {
    if (notice.type === "state") {
      this.applyState(notice);
      return;
    }
    if (notice.type === "notice") {
      this.flash(notice.text);
      return;
    }
    if (notice.type === "loopClosed") {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(12);
      }
      return;
    }
    if (notice.type === "buffers") {
      const resolve = this.requests.get(notice.requestId);
      if (resolve) {
        this.requests.delete(notice.requestId);
        resolve(notice);
      }
    }
  }

  private applyState(state: StateWire) {
    const bar = barLengthSamples(state.bpm, state.beatsPerBar, this.ctx?.sampleRate || 48000);
    const tracks = state.tracks.map((track) => ({
      ...emptyTrackSnapshot(),
      ...track,
      lengthBars: bar > 0 && track.lengthSamples > 0 ? track.lengthSamples / bar : 0,
    }));
    this.snap = {
      ...this.snap,
      bpm: state.bpm,
      beatsPerBar: state.beatsPerBar,
      recAction: state.recAction,
      syncMultiple: state.syncMultiple,
      metronome: state.metronome,
      countInBars: state.countInBars,
      beat: state.beat,
      bar: state.bar,
      countIn: state.countIn,
      anyRunning: state.anyRunning,
      tempoLocked: state.tempoLocked,
      signatureLocked: state.signatureLocked,
      masterLengthSamples: state.masterLengthSamples,
      masterBars: bar > 0 && state.masterLengthSamples > 0 ? state.masterLengthSamples / bar : 0,
      inputPeak: state.inputPeak,
      tracks,
    };
    this.emit();
    void this.syncWake();
  }

  private post(command: WorkletCommand) {
    this.node?.port.postMessage(command);
  }

  private pushCompensation() {
    if (!this.ctx) return;
    const output = this.ctx.outputLatency || 0;
    const base = this.ctx.baseLatency || 0;
    const auto = output > 0 ? output : base;
    const seconds = Math.min(0.2, Math.max(0, auto + this.nudgeMs / 1000));
    this.post({ type: "setCompensation", samples: Math.round(seconds * this.ctx.sampleRate) });
    this.patch({
      baseLatencyMs: Math.round(base * 1000),
      outputLatencyMs: Math.round(output * 1000),
      compensationMs: Math.round(seconds * 1000),
      nudgeMs: this.nudgeMs,
    });
  }

  private async syncWake() {
    if (!("wakeLock" in navigator)) return;
    const want = this.snap.anyRunning && document.visibilityState === "visible";
    try {
      if (want && !this.wake) {
        this.wake = await navigator.wakeLock.request("screen");
        this.wake.addEventListener("release", () => {
          this.wake = null;
        });
      } else if (!want && this.wake) {
        await this.wake.release();
        this.wake = null;
      }
    } catch {
      this.wake = null;
    }
  }

  private async startMidi() {
    this.midi?.stop();
    const status = await attachMidi({
      noteOn: (note, velocity) => this.noteOn(note, velocity),
      noteOff: (note) => this.noteOff(note),
      sustain: (down) => this.setSustain(down),
      panic: () => this.instruments?.allNotesOff(),
    });
    this.midi = status;
    this.patch({
      midiAvailable: status.available,
      midiInputs: status.inputs,
      midiReason: status.reason,
    });
  }

  private audioTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  toggleAll() {
    if (this.snap.anyRunning) this.allStop();
    else this.allStart();
  }

  allStart() {
    this.post({ type: "allStart" });
  }

  allStop() {
    this.instruments?.allNotesOff();
    this.post({ type: "allStop" });
  }

  setBpm(bpm: number) {
    const next = clampBpm(bpm);
    if (!this.snap.tempoLocked && next !== this.snap.bpm) this.previousBpm = this.snap.bpm;
    this.post({ type: "setBpm", bpm: next });
  }

  nudgeBpm(delta: number) {
    this.setBpm(this.snap.bpm + delta);
  }

  tap() {
    const result = pushTap(this.taps, performance.now());
    this.taps = result.taps;
    if (result.bpm == null) {
      this.flash(this.taps.length < 2 ? "Keep tapping." : "Tap closer together.");
      return;
    }
    this.setBpm(result.bpm);
  }

  revertTempo() {
    this.setBpm(this.previousBpm);
  }

  toggleMetronome() {
    const on = !this.snap.metronome;
    this.patch({ metronome: on });
    this.post({ type: "setMetronome", on });
  }

  toggleCountIn() {
    const bars: 0 | 1 = this.snap.countInBars === 0 ? 1 : 0;
    this.patch({ countInBars: bars });
    this.post({ type: "setCountIn", bars });
  }

  toggleTimeSignature() {
    const beats: BeatsPerBar = this.snap.beatsPerBar === 4 ? 3 : 4;
    this.post({ type: "setBeatsPerBar", beatsPerBar: beats });
  }

  setRecAction(action: RecAction) {
    this.patch({ recAction: action });
    this.post({ type: "setRecAction", action });
  }

  setSyncMultiple(multiple: SyncMultiple) {
    this.post({ type: "setSyncMultiple", multiple });
  }

  async trackRecPlay(track: number) {
    const source = this.snap.tracks[track]?.input;
    if (source === "mic" && !this.snap.micGranted) {
      const ok = await this.enableMic();
      if (!ok) return;
    }
    this.post({ type: "pressRecPlay", track, audioTime: this.audioTime() });
  }

  trackStop(track: number) {
    this.post({ type: "stop", track });
  }

  trackClear(track: number) {
    this.post({ type: "clear", track });
  }

  trackUndo(track: number) {
    this.post({ type: "undo", track });
  }

  trackRedo(track: number) {
    this.post({ type: "redo", track });
  }

  setTrackLevel(track: number, level: number) {
    this.post({ type: "setLevel", track, level });
  }

  setTrackPan(track: number, pan: number) {
    this.post({ type: "setPan", track, pan });
  }

  setTrackInput(track: number, input: InputSource) {
    const tracks = this.snap.tracks.map((item, index) =>
      index === track ? { ...item, input } : item,
    );
    this.patch({ tracks });
    this.post({ type: "setInput", track, input });
    if (input === "mic" && !this.snap.micGranted) void this.enableMic();
  }

  setInstrument(mode: InstrumentMode) {
    this.instruments?.setMode(mode);
    this.patch({ instrument: mode, sustain: mode === "drums" ? false : this.snap.sustain });
  }

  setOctave(octave: number) {
    const next = Math.min(6, Math.max(1, Math.round(octave)));
    this.instruments?.allNotesOff();
    this.patch({ octave: next });
  }

  shiftOctave(delta: number) {
    this.setOctave(this.snap.octave + delta);
  }

  setSustain(on: boolean) {
    if (this.snap.instrument === "drums") return;
    this.instruments?.setSustain(on);
    this.patch({ sustain: on });
  }

  toggleSustain() {
    this.setSustain(!this.snap.sustain);
  }

  noteOn(note: number, velocity = 0.85) {
    void this.ctx?.resume();
    this.instruments?.noteOn(note, velocity);
  }

  noteOff(note: number) {
    this.instruments?.noteOff(note);
  }

  async enableMic(): Promise<boolean> {
    if (!this.ctx || !this.node) {
      this.flash("Tap to start audio before using the mic.");
      return false;
    }
    if (this.snap.micGranted && this.micStream) return true;
    const nav = navigator as AudioSessionNav;
    if (nav.audioSession) {
      try {
        nav.audioSession.type = "play-and-record";
      } catch {
        /* ignore */
      }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
      this.micStream = stream;
      const source = this.ctx.createMediaStreamSource(stream);
      this.micGain = this.ctx.createGain();
      this.micGain.gain.value = 1;
      source.connect(this.micGain);
      this.micGain.connect(this.node, 0, 1);
      if (this.monitorGain) this.micGain.connect(this.monitorGain);
      this.patch({ micGranted: true, micError: null, micMonitor: true });
      this.flash("Mic is live. Headphones keep it from feeding back.");
      return true;
    } catch {
      this.patch({
        micGranted: false,
        micError: "Microphone permission was denied.",
      });
      this.flash("Microphone permission was denied.");
      return false;
    }
  }

  setMicMonitor(on: boolean) {
    if (this.monitorGain && this.micGain) {
      this.monitorGain.gain.value = on ? 0.85 : 0;
    }
    this.patch({ micMonitor: on });
  }

  setProjectName(name: string) {
    this.patch({ projectName: name.slice(0, 40) });
  }

  setNudgeMs(ms: number) {
    this.nudgeMs = Math.min(60, Math.max(-40, Math.round(ms)));
    this.pushCompensation();
  }

  private async refreshSavedFlag() {
    try {
      const saved = await hasProject();
      this.patch({ hasSavedProject: saved });
    } catch {
      this.patch({ hasSavedProject: false });
    }
  }

  private requestBuffers(): Promise<BuffersWire> {
    if (!this.node) return Promise.reject(new Error("Audio isn't running."));
    const requestId = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.requests.delete(requestId);
        reject(new Error("The looper didn't answer."));
      }, 4000);
      this.requests.set(requestId, (buffers) => {
        window.clearTimeout(timer);
        resolve(buffers);
      });
      this.post({ type: "getBuffers", requestId });
    });
  }

  async saveProject(): Promise<void> {
    try {
      const buffers = await this.requestBuffers();
      const project: StoredProject = {
        version: 1,
        name: this.snap.projectName.trim() || "Untitled",
        savedAt: Date.now(),
        bpm: buffers.bpm,
        beatsPerBar: buffers.beatsPerBar,
        recAction: buffers.recAction,
        syncMultiple: buffers.syncMultiple,
        countInBars: this.snap.countInBars,
        metronome: this.snap.metronome,
        nudgeMs: this.nudgeMs,
        instrument: this.snap.instrument,
        octave: this.snap.octave,
        masterLengthSamples: buffers.masterLengthSamples,
        masterTrack: buffers.masterTrack,
        tracks: buffers.tracks.map((track) => ({
          level: track.level,
          pan: track.pan,
          input: track.input,
          originalBpm: track.originalBpm,
          length: track.length,
          left: track.left,
          right: track.right,
        })),
      };
      await saveProject(project);
      this.patch({ hasSavedProject: true, projectName: project.name });
      this.flash(`Saved “${project.name}” on this device.`);
    } catch (error) {
      this.flash(error instanceof Error ? error.message : "Couldn't save.");
    }
  }

  async loadProject(): Promise<boolean> {
    try {
      const project = await loadProject();
      if (!project) {
        this.flash("No saved project on this device yet.");
        return false;
      }
      if (!this.node) {
        this.flash("Tap to start audio before loading.");
        return false;
      }
      this.instruments?.allNotesOff();
      const command: WorkletCommand = {
        type: "load",
        bpm: project.bpm,
        beatsPerBar: project.beatsPerBar,
        recAction: project.recAction,
        syncMultiple: project.syncMultiple,
        masterLengthSamples: project.masterLengthSamples,
        masterTrack: project.masterTrack,
        tracks: project.tracks.map((track) => ({
          level: track.level,
          pan: track.pan,
          input: track.input,
          originalBpm: track.originalBpm,
          length: track.length,
          left: track.left,
          right: track.right,
        })),
      };
      this.post(command);
      this.nudgeMs = project.nudgeMs;
      this.pushCompensation();
      this.setInstrument(project.instrument);
      this.setOctave(project.octave);
      this.post({ type: "setMetronome", on: project.metronome });
      this.post({ type: "setCountIn", bars: project.countInBars });
      this.patch({
        projectName: project.name,
        hasSavedProject: true,
        metronome: project.metronome,
        countInBars: project.countInBars,
      });
      this.flash(`Loaded “${project.name}”.`);
      return true;
    } catch (error) {
      this.flash(error instanceof Error ? error.message : "Couldn't load.");
      return false;
    }
  }

  async exportMix(): Promise<void> {
    try {
      const buffers = await this.requestBuffers();
      if (!buffers.tracks.some((track) => track.hasPhrase && track.length > 0)) {
        this.flash("Record a loop before exporting.");
        return;
      }
      const mixed = mixdown(
        buffers.tracks.map((track) => ({
          left: new Float32Array(track.left),
          right: new Float32Array(track.right),
          length: track.length,
          level: track.level,
          pan: track.pan,
          hasPhrase: track.hasPhrase,
        })),
        4,
      );
      const rate = this.ctx?.sampleRate ?? buffers.sampleRate;
      const blob = encodeWavStereo(mixed.left, mixed.right, rate);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const slug = (this.snap.projectName || "carbon-cycle").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      link.href = url;
      link.download = `${slug.replace(/^-|-$/g, "") || "carbon-cycle"}-mix.wav`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      this.flash("Exported a WAV of four times through the loop.");
    } catch (error) {
      this.flash(error instanceof Error ? error.message : "Couldn't export.");
    }
  }
}

export const engine = new AudioEngine();
