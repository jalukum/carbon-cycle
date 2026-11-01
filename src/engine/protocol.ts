import type {
  BeatsPerBar,
  InputSource,
  PendingAction,
  RecAction,
  SyncMultiple,
  TrackPhase,
} from "./types";

export interface TrackWire {
  phase: TrackPhase;
  hasPhrase: boolean;
  canUndo: boolean;
  canRedo: boolean;
  level: number;
  pan: number;
  input: InputSource;
  lengthSamples: number;
  originalBpm: number | null;
  position: number;
  recProgress: number;
  pending: PendingAction | null;
}

export interface StateWire {
  type: "state";
  bpm: number;
  beatsPerBar: BeatsPerBar;
  recAction: RecAction;
  syncMultiple: SyncMultiple;
  metronome: boolean;
  countInBars: 0 | 1;
  beat: number;
  bar: number;
  countIn: boolean;
  anyRunning: boolean;
  tempoLocked: boolean;
  signatureLocked: boolean;
  masterLengthSamples: number;
  inputPeak: number;
  tracks: TrackWire[];
}

export interface BufferTrackWire {
  length: number;
  hasPhrase: boolean;
  level: number;
  pan: number;
  input: InputSource;
  originalBpm: number | null;
  left: ArrayBuffer;
  right: ArrayBuffer;
}

export interface BuffersWire {
  type: "buffers";
  requestId: string;
  sampleRate: number;
  bpm: number;
  beatsPerBar: BeatsPerBar;
  recAction: RecAction;
  syncMultiple: SyncMultiple;
  masterLengthSamples: number;
  masterTrack: number | null;
  tracks: BufferTrackWire[];
}

export interface LoadTrackWire {
  level: number;
  pan: number;
  input: InputSource;
  originalBpm: number | null;
  length: number;
  left: ArrayBuffer;
  right: ArrayBuffer;
}

export type WorkletCommand =
  | { type: "pressRecPlay"; track: number; audioTime: number }
  | { type: "stop"; track: number }
  | { type: "clear"; track: number }
  | { type: "undo"; track: number }
  | { type: "redo"; track: number }
  | { type: "allStart" }
  | { type: "allStop" }
  | { type: "setBpm"; bpm: number }
  | { type: "setBeatsPerBar"; beatsPerBar: BeatsPerBar }
  | { type: "setMetronome"; on: boolean }
  | { type: "setCountIn"; bars: 0 | 1 }
  | { type: "setRecAction"; action: RecAction }
  | { type: "setSyncMultiple"; multiple: SyncMultiple }
  | { type: "setLevel"; track: number; level: number }
  | { type: "setPan"; track: number; pan: number }
  | { type: "setInput"; track: number; input: InputSource }
  | { type: "setCompensation"; samples: number }
  | { type: "getBuffers"; requestId: string }
  | {
      type: "load";
      bpm: number;
      beatsPerBar: BeatsPerBar;
      recAction: RecAction;
      syncMultiple: SyncMultiple;
      masterLengthSamples: number;
      masterTrack: number | null;
      tracks: LoadTrackWire[];
    };

export type WorkletNotice =
  | StateWire
  | BuffersWire
  | { type: "notice"; text: string }
  | { type: "loopClosed" };
