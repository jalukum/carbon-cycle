/** Shared types for the audio core and the UI. The core does not import React. */

export const TRACK_COUNT = 5;

export type RecAction = "rec-dub" | "rec-play";
export type InputSource = "mic" | "instrument";
export type TrackPhase = "empty" | "rec" | "dub" | "play" | "stopped";
export type InstrumentMode = "synth" | "drums";
export type SyncMultiple = 1 | 2 | 4;
export type BeatsPerBar = 3 | 4;
export type PendingAction = "rec" | "dub" | "play" | "commit";

export interface TrackSnapshot {
  phase: TrackPhase;
  hasPhrase: boolean;
  canUndo: boolean;
  canRedo: boolean;
  level: number;
  pan: number;
  input: InputSource;
  lengthSamples: number;
  lengthBars: number;
  originalBpm: number | null;
  /** 0–1 playback position inside the phrase. */
  position: number;
  /** 0–1 progress of an in-progress first take. */
  recProgress: number;
  pending: PendingAction | null;
}

export interface EngineSnapshot {
  audioUnlocked: boolean;
  workletReady: boolean;
  error: string | null;
  message: string | null;
  bpm: number;
  beatsPerBar: BeatsPerBar;
  metronome: boolean;
  countInBars: 0 | 1;
  recAction: RecAction;
  syncMultiple: SyncMultiple;
  /** Current beat inside the bar, or -1 before the clock is running. */
  beat: number;
  bar: number;
  countIn: boolean;
  anyRunning: boolean;
  tempoLocked: boolean;
  signatureLocked: boolean;
  tracks: TrackSnapshot[];
  masterLengthSamples: number;
  masterBars: number;
  instrument: InstrumentMode;
  octave: number;
  sustain: boolean;
  midiAvailable: boolean;
  midiInputs: string[];
  midiReason: string | null;
  micGranted: boolean;
  micError: string | null;
  micMonitor: boolean;
  projectName: string;
  hasSavedProject: boolean;
  inputPeak: number;
  baseLatencyMs: number;
  outputLatencyMs: number;
  compensationMs: number;
  nudgeMs: number;
}

export function emptyTrackSnapshot(): TrackSnapshot {
  return {
    phase: "empty",
    hasPhrase: false,
    canUndo: false,
    canRedo: false,
    level: 100,
    pan: 0,
    input: "instrument",
    lengthSamples: 0,
    lengthBars: 0,
    originalBpm: null,
    position: 0,
    recProgress: 0,
    pending: null,
  };
}

export function defaultSnapshot(): EngineSnapshot {
  return {
    audioUnlocked: false,
    workletReady: false,
    error: null,
    message: null,
    bpm: 120,
    beatsPerBar: 4,
    metronome: true,
    countInBars: 1,
    recAction: "rec-dub",
    syncMultiple: 1,
    beat: -1,
    bar: 0,
    countIn: false,
    anyRunning: false,
    tempoLocked: false,
    signatureLocked: false,
    tracks: Array.from({ length: TRACK_COUNT }, emptyTrackSnapshot),
    masterLengthSamples: 0,
    masterBars: 0,
    instrument: "synth",
    octave: 3,
    sustain: false,
    midiAvailable: false,
    midiInputs: [],
    midiReason: null,
    micGranted: false,
    micError: null,
    micMonitor: true,
    projectName: "Untitled",
    hasSavedProject: false,
    inputPeak: 0,
    baseLatencyMs: 0,
    outputLatencyMs: 0,
    compensationMs: 0,
    nudgeMs: 0,
  };
}
