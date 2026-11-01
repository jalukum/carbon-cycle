/**
 * Pure RC-505-style transport for five tracks.
 *
 * Button timing (when a press actually fires) lives in the audio thread.
 * This reducer applies the transition once that moment arrives, so it can be
 * tested without Web Audio.
 *
 * REC→DUB (default): empty → rec → dub → play → dub → play…
 * REC→PLAY:          empty → rec → play → dub → play…
 * Only one track may record or overdub. Undo/redo is a single slot per track.
 */

import { TRACK_COUNT, type BeatsPerBar, type InputSource, type RecAction, type SyncMultiple, type TrackPhase } from "./types";
import { clampBpm, minPhraseSamples } from "./timing";

export interface TrackState {
  phase: TrackPhase;
  hasPhrase: boolean;
  lengthSamples: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Undo removes the only recording instead of peeling an overdub. */
  undoClearsPhrase: boolean;
  redoLengthSamples: number;
  redoOriginalBpm: number | null;
  level: number;
  pan: number;
  input: InputSource;
  originalBpm: number | null;
}

export interface LooperState {
  tracks: [TrackState, TrackState, TrackState, TrackState, TrackState];
  recAction: RecAction;
  masterLengthSamples: number;
  masterTrack: number | null;
  syncMultiple: SyncMultiple;
  bpm: number;
  beatsPerBar: BeatsPerBar;
  sampleRate: number;
}

export type LooperEvent =
  | { type: "startRec"; track: number }
  | { type: "commitRec"; track: number; length: number; next: "play" | "dub" }
  | { type: "toPlay"; track: number }
  | { type: "toDub"; track: number }
  | { type: "stop"; track: number }
  | { type: "clear"; track: number }
  | { type: "undo"; track: number }
  | { type: "redo"; track: number }
  | { type: "allStart" }
  | { type: "allStop" }
  | { type: "setLevel"; track: number; level: number }
  | { type: "setPan"; track: number; pan: number }
  | { type: "setInput"; track: number; input: InputSource }
  | { type: "setRecAction"; action: RecAction }
  | { type: "setSyncMultiple"; multiple: SyncMultiple }
  | { type: "setBpm"; bpm: number }
  | { type: "setBeatsPerBar"; beatsPerBar: BeatsPerBar };

export type MachineEffect =
  | { type: "beginRec"; track: number }
  | { type: "cancelRec"; track: number }
  | { type: "commitPhrase"; track: number; length: number; then: "play" | "dub" }
  | { type: "snapshotUndo"; track: number }
  | { type: "endDub"; track: number }
  | { type: "swapUndo"; track: number }
  | { type: "clearBuffers"; track: number }
  | { type: "resetCycle" }
  | { type: "message"; text: string };

export interface ReduceResult {
  state: LooperState;
  effects: MachineEffect[];
}

function createTrack(): TrackState {
  return {
    phase: "empty",
    hasPhrase: false,
    lengthSamples: 0,
    canUndo: false,
    canRedo: false,
    undoClearsPhrase: false,
    redoLengthSamples: 0,
    redoOriginalBpm: null,
    level: 100,
    pan: 0,
    input: "instrument",
    originalBpm: null,
  };
}

export function createLooperState(sampleRate: number, bpm = 120): LooperState {
  return {
    tracks: [createTrack(), createTrack(), createTrack(), createTrack(), createTrack()],
    recAction: "rec-dub",
    masterLengthSamples: 0,
    masterTrack: null,
    syncMultiple: 1,
    bpm: clampBpm(bpm),
    beatsPerBar: 4,
    sampleRate,
  };
}

export function isTempoLocked(state: LooperState): boolean {
  return state.tracks.some((track) => track.phase === "rec" || track.phase === "dub");
}

export function isSignatureLocked(state: LooperState): boolean {
  return state.tracks.some(
    (track) => track.hasPhrase || track.phase === "rec" || track.phase === "dub",
  );
}

export function anyRunning(state: LooperState): boolean {
  return state.tracks.some(
    (track) => track.phase === "rec" || track.phase === "dub" || track.phase === "play",
  );
}

function validTrack(track: number): boolean {
  return Number.isInteger(track) && track >= 0 && track < TRACK_COUNT;
}

function withTrack(state: LooperState, index: number, track: TrackState): LooperState {
  const tracks = state.tracks.slice() as LooperState["tracks"];
  tracks[index] = track;
  return { ...state, tracks };
}

function idle(state: LooperState): ReduceResult {
  return { state, effects: [] };
}

function recomputeMaster(state: LooperState): LooperState {
  const phrases = state.tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => track.hasPhrase && track.lengthSamples > 0);
  if (phrases.length === 0) {
    if (state.masterLengthSamples === 0 && state.masterTrack === null) return state;
    return { ...state, masterLengthSamples: 0, masterTrack: null };
  }
  if (state.masterLengthSamples > 0) {
    const masterStillThere =
      state.masterTrack !== null && state.tracks[state.masterTrack]?.hasPhrase;
    if (masterStillThere) return state;
    return { ...state, masterTrack: phrases[0]!.index };
  }
  const shortest = phrases.reduce((best, item) =>
    item.track.lengthSamples < best.track.lengthSamples ? item : best,
  );
  return {
    ...state,
    masterLengthSamples: shortest.track.lengthSamples,
    masterTrack: shortest.index,
  };
}

function startRec(state: LooperState, track: number): ReduceResult {
  if (!validTrack(track)) return idle(state);
  let next = state;
  const effects: MachineEffect[] = [];
  for (let i = 0; i < TRACK_COUNT; i++) {
    if (i === track) continue;
    const other = next.tracks[i]!;
    if (other.phase === "dub") {
      next = withTrack(next, i, { ...other, phase: "play" });
      effects.push({ type: "endDub", track: i });
    } else if (other.phase === "rec") {
      next = withTrack(next, i, { ...other, phase: "empty" });
      effects.push({ type: "cancelRec", track: i });
      effects.push({
        type: "message",
        text: `Track ${i + 1} was still opening, so that take was dropped.`,
      });
    }
  }
  const current = next.tracks[track]!;
  if (current.phase === "rec" || current.hasPhrase || current.phase !== "empty") {
    return { state: next, effects };
  }
  next = withTrack(next, track, { ...current, phase: "rec", canRedo: false });
  effects.push({ type: "beginRec", track });
  return { state: next, effects };
}

function commitRec(
  state: LooperState,
  track: number,
  length: number,
  nextPhase: "play" | "dub",
): ReduceResult {
  if (!validTrack(track)) return idle(state);
  const current = state.tracks[track]!;
  if (current.phase !== "rec") return idle(state);

  let resolved: number | null;
  if (state.masterLengthSamples > 0) {
    resolved = state.masterLengthSamples * state.syncMultiple;
  } else if (length < minPhraseSamples(state.sampleRate)) {
    resolved = null;
  } else {
    resolved = length;
  }

  if (resolved == null) {
    return {
      state: withTrack(state, track, { ...current, phase: "empty" }),
      effects: [
        { type: "cancelRec", track },
        { type: "message", text: "Too short — give the loop at least a beat." },
      ],
    };
  }

  let next = state;
  if (next.masterLengthSamples === 0) {
    next = { ...next, masterLengthSamples: resolved, masterTrack: track };
  }
  const goingDub = nextPhase === "dub";
  next = withTrack(next, track, {
    ...current,
    phase: nextPhase,
    hasPhrase: true,
    lengthSamples: resolved,
    originalBpm: next.bpm,
    canUndo: true,
    canRedo: false,
    undoClearsPhrase: !goingDub,
    redoLengthSamples: 0,
    redoOriginalBpm: null,
  });
  const effects: MachineEffect[] = [
    { type: "commitPhrase", track, length: resolved, then: nextPhase },
  ];
  if (goingDub) effects.push({ type: "snapshotUndo", track });
  return { state: next, effects };
}

function toDub(state: LooperState, track: number): ReduceResult {
  if (!validTrack(track)) return idle(state);
  const current = state.tracks[track]!;
  if (!current.hasPhrase || current.phase === "dub" || current.phase === "rec") {
    return idle(state);
  }
  return {
    state: withTrack(state, track, {
      ...current,
      phase: "dub",
      canUndo: true,
      canRedo: false,
      undoClearsPhrase: false,
    }),
    effects: [{ type: "snapshotUndo", track }],
  };
}

function toPlay(state: LooperState, track: number): ReduceResult {
  if (!validTrack(track)) return idle(state);
  const current = state.tracks[track]!;
  if (!current.hasPhrase || current.phase === "empty" || current.phase === "play") {
    return idle(state);
  }
  const wasDub = current.phase === "dub";
  return {
    state: withTrack(state, track, { ...current, phase: "play" }),
    effects: wasDub ? [{ type: "endDub", track }] : [],
  };
}

function stop(state: LooperState, track: number): ReduceResult {
  if (!validTrack(track)) return idle(state);
  const current = state.tracks[track]!;
  if (current.phase === "empty" || current.phase === "stopped") return idle(state);
  if (current.phase === "rec") {
    return {
      state: withTrack(state, track, { ...current, phase: "empty" }),
      effects: [{ type: "cancelRec", track }],
    };
  }
  if (current.phase === "dub") {
    return {
      state: withTrack(state, track, { ...current, phase: "stopped" }),
      effects: [{ type: "endDub", track }],
    };
  }
  return {
    state: withTrack(state, track, { ...current, phase: "stopped" }),
    effects: [],
  };
}

function clear(state: LooperState, track: number): ReduceResult {
  if (!validTrack(track)) return idle(state);
  const current = state.tracks[track]!;
  const fresh = createTrack();
  fresh.level = current.level;
  fresh.pan = current.pan;
  fresh.input = current.input;
  const next = recomputeMaster(withTrack(state, track, fresh));
  return { state: next, effects: [{ type: "clearBuffers", track }] };
}

function undo(state: LooperState, track: number): ReduceResult {
  if (!validTrack(track)) return idle(state);
  const current = state.tracks[track]!;
  if (!current.canUndo || current.phase === "rec") return idle(state);
  if (current.undoClearsPhrase) {
    const cleared: TrackState = {
      ...current,
      phase: "empty",
      hasPhrase: false,
      redoLengthSamples: current.lengthSamples,
      redoOriginalBpm: current.originalBpm,
      lengthSamples: 0,
      originalBpm: null,
      canUndo: false,
      canRedo: true,
      undoClearsPhrase: false,
    };
    return {
      state: recomputeMaster(withTrack(state, track, cleared)),
      effects: [{ type: "swapUndo", track }],
    };
  }
  const phase: TrackPhase = current.phase === "stopped" ? "stopped" : "play";
  const effects: MachineEffect[] = [{ type: "swapUndo", track }];
  if (current.phase === "dub") effects.push({ type: "endDub", track });
  return {
    state: withTrack(state, track, {
      ...current,
      phase,
      canUndo: false,
      canRedo: true,
      undoClearsPhrase: false,
    }),
    effects,
  };
}

function redo(state: LooperState, track: number): ReduceResult {
  if (!validTrack(track)) return idle(state);
  const current = state.tracks[track]!;
  if (!current.canRedo) return idle(state);
  if (!current.hasPhrase) {
    const restored: TrackState = {
      ...current,
      phase: "stopped",
      hasPhrase: true,
      lengthSamples: current.redoLengthSamples,
      originalBpm: current.redoOriginalBpm,
      canUndo: true,
      canRedo: false,
      undoClearsPhrase: true,
    };
    return {
      state: recomputeMaster(withTrack(state, track, restored)),
      effects: [{ type: "swapUndo", track }],
    };
  }
  return {
    state: withTrack(state, track, {
      ...current,
      canUndo: true,
      canRedo: false,
      undoClearsPhrase: false,
    }),
    effects: [{ type: "swapUndo", track }],
  };
}

function allStop(state: LooperState): ReduceResult {
  let next = state;
  const effects: MachineEffect[] = [];
  for (let i = 0; i < TRACK_COUNT; i++) {
    const result = stop(next, i);
    next = result.state;
    effects.push(...result.effects);
  }
  return { state: next, effects };
}

function allStart(state: LooperState): ReduceResult {
  let next = state;
  const effects: MachineEffect[] = [];
  for (let i = 0; i < TRACK_COUNT; i++) {
    const track = next.tracks[i]!;
    if (track.phase === "rec") {
      const result = stop(next, i);
      next = result.state;
      effects.push(...result.effects);
      continue;
    }
    if (track.phase === "dub") {
      const result = toPlay(next, i);
      next = result.state;
      effects.push(...result.effects);
    }
    const after = next.tracks[i]!;
    if (after.hasPhrase && after.phase !== "play") {
      next = withTrack(next, i, { ...after, phase: "play" });
    }
  }
  effects.push({ type: "resetCycle" });
  return { state: next, effects };
}

export function reduce(state: LooperState, event: LooperEvent): ReduceResult {
  switch (event.type) {
    case "startRec":
      return startRec(state, event.track);
    case "commitRec":
      return commitRec(state, event.track, event.length, event.next);
    case "toPlay":
      return toPlay(state, event.track);
    case "toDub":
      return toDub(state, event.track);
    case "stop":
      return stop(state, event.track);
    case "clear":
      return clear(state, event.track);
    case "undo":
      return undo(state, event.track);
    case "redo":
      return redo(state, event.track);
    case "allStart":
      return allStart(state);
    case "allStop":
      return allStop(state);
    case "setLevel": {
      if (!validTrack(event.track)) return idle(state);
      const level = Math.min(200, Math.max(0, event.level));
      const current = state.tracks[event.track]!;
      if (current.level === level) return idle(state);
      return { state: withTrack(state, event.track, { ...current, level }), effects: [] };
    }
    case "setPan": {
      if (!validTrack(event.track)) return idle(state);
      const pan = Math.min(50, Math.max(-50, event.pan));
      const current = state.tracks[event.track]!;
      if (current.pan === pan) return idle(state);
      return { state: withTrack(state, event.track, { ...current, pan }), effects: [] };
    }
    case "setInput": {
      if (!validTrack(event.track)) return idle(state);
      const current = state.tracks[event.track]!;
      if (current.input === event.input) return idle(state);
      return {
        state: withTrack(state, event.track, { ...current, input: event.input }),
        effects: [],
      };
    }
    case "setRecAction":
      if (state.recAction === event.action) return idle(state);
      return { state: { ...state, recAction: event.action }, effects: [] };
    case "setSyncMultiple":
      if (isTempoLocked(state)) {
        return {
          state,
          effects: [{ type: "message", text: "Finish the take before changing loop length." }],
        };
      }
      if (state.syncMultiple === event.multiple) return idle(state);
      return { state: { ...state, syncMultiple: event.multiple }, effects: [] };
    case "setBpm": {
      if (isTempoLocked(state)) {
        return {
          state,
          effects: [{ type: "message", text: "Tempo stays put while recording or overdubbing." }],
        };
      }
      const bpm = clampBpm(event.bpm);
      if (bpm === state.bpm) return idle(state);
      return { state: { ...state, bpm }, effects: [] };
    }
    case "setBeatsPerBar": {
      if (isSignatureLocked(state)) {
        return {
          state,
          effects: [{ type: "message", text: "Time signature is locked while a loop exists." }],
        };
      }
      if (state.beatsPerBar === event.beatsPerBar) return idle(state);
      return { state: { ...state, beatsPerBar: event.beatsPerBar }, effects: [] };
    }
    default:
      return idle(state);
  }
}
