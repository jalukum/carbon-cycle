import { describe, expect, it } from "vitest";
import {
  createLooperState,
  isTempoLocked,
  reduce,
  type LooperState,
  type MachineEffect,
} from "./looper-machine";
import type { TrackPhase } from "./types";

const BAR = 96_000;

function phases(state: LooperState): TrackPhase[] {
  return state.tracks.map((track) => track.phase);
}

function hasEffect(effects: MachineEffect[], type: MachineEffect["type"], track?: number): boolean {
  return effects.some((effect) => {
    if (effect.type !== type) return false;
    if (track === undefined) return true;
    return "track" in effect && effect.track === track;
  });
}

function recordFirst(state: LooperState, track = 0, next: "play" | "dub" = "dub"): LooperState {
  const started = reduce(state, { type: "startRec", track }).state;
  return reduce(started, { type: "commitRec", track, length: BAR, next }).state;
}

describe("REC/PLAY cycles", () => {
  it("follows rec → dub → play → dub when REC ACTION is rec-dub", () => {
    let state = createLooperState(48_000);
    expect(state.recAction).toBe("rec-dub");
    state = reduce(state, { type: "startRec", track: 0 }).state;
    expect(phases(state)[0]).toBe("rec");
    state = reduce(state, { type: "commitRec", track: 0, length: BAR, next: "dub" }).state;
    expect(state.tracks[0].phase).toBe("dub");
    expect(state.tracks[0].hasPhrase).toBe(true);
    expect(state.masterLengthSamples).toBe(BAR);
    expect(state.masterTrack).toBe(0);
    state = reduce(state, { type: "toPlay", track: 0 }).state;
    expect(state.tracks[0].phase).toBe("play");
    state = reduce(state, { type: "toDub", track: 0 }).state;
    expect(state.tracks[0].phase).toBe("dub");
    state = reduce(state, { type: "toPlay", track: 0 }).state;
    expect(state.tracks[0].phase).toBe("play");
  });

  it("follows rec → play → dub → play when REC ACTION is rec-play", () => {
    let state = reduce(createLooperState(48_000), {
      type: "setRecAction",
      action: "rec-play",
    }).state;
    state = reduce(state, { type: "startRec", track: 2 }).state;
    state = reduce(state, { type: "commitRec", track: 2, length: BAR, next: "play" }).state;
    expect(state.tracks[2].phase).toBe("play");
    expect(state.tracks[2].undoClearsPhrase).toBe(true);
    state = reduce(state, { type: "toDub", track: 2 }).state;
    expect(state.tracks[2].phase).toBe("dub");
    state = reduce(state, { type: "toPlay", track: 2 }).state;
    expect(state.tracks[2].phase).toBe("play");
  });

  it("drops a take shorter than 0.1 seconds", () => {
    let state = reduce(createLooperState(48_000), { type: "startRec", track: 0 }).state;
    const result = reduce(state, { type: "commitRec", track: 0, length: 100, next: "play" });
    expect(result.state.tracks[0].phase).toBe("empty");
    expect(result.state.tracks[0].hasPhrase).toBe(false);
    expect(result.state.masterLengthSamples).toBe(0);
    expect(hasEffect(result.effects, "cancelRec", 0)).toBe(true);
    expect(hasEffect(result.effects, "message")).toBe(true);
  });

  it("cancels an opening take on stop", () => {
    let state = reduce(createLooperState(48_000), { type: "startRec", track: 1 }).state;
    state = reduce(state, { type: "stop", track: 1 }).state;
    expect(state.tracks[1].phase).toBe("empty");
    expect(state.tracks[1].hasPhrase).toBe(false);
  });
});

describe("one recorder at a time", () => {
  it("closes an overdub and arms the next track", () => {
    let state = recordFirst(createLooperState(48_000), 0, "dub");
    expect(state.tracks[0].phase).toBe("dub");
    const result = reduce(state, { type: "startRec", track: 1 });
    expect(result.state.tracks[0].phase).toBe("play");
    expect(result.state.tracks[1].phase).toBe("rec");
    expect(hasEffect(result.effects, "endDub", 0)).toBe(true);
    expect(hasEffect(result.effects, "beginRec", 1)).toBe(true);
  });

  it("drops a not-yet-closed take when another track arms", () => {
    let state = reduce(createLooperState(48_000), { type: "startRec", track: 0 }).state;
    const result = reduce(state, { type: "startRec", track: 3 });
    expect(result.state.tracks[0].phase).toBe("empty");
    expect(result.state.tracks[3].phase).toBe("rec");
    expect(hasEffect(result.effects, "cancelRec", 0)).toBe(true);
  });
});

describe("loop sync", () => {
  it("locks a later track to the master length times the multiple", () => {
    let state = recordFirst(createLooperState(48_000), 0, "play");
    state = reduce(state, { type: "setSyncMultiple", multiple: 2 }).state;
    state = reduce(state, { type: "startRec", track: 1 }).state;
    const committed = reduce(state, {
      type: "commitRec",
      track: 1,
      length: 50,
      next: "play",
    });
    expect(committed.state.tracks[1].lengthSamples).toBe(BAR * 2);
    expect(committed.state.masterLengthSamples).toBe(BAR);
    expect(committed.state.tracks[1].phase).toBe("play");
  });

  it("keeps the master length when one of two phrases is cleared", () => {
    let state = recordFirst(createLooperState(48_000), 0, "play");
    state = reduce(state, { type: "startRec", track: 1 }).state;
    state = reduce(state, { type: "commitRec", track: 1, length: BAR, next: "play" }).state;
    state = reduce(state, { type: "clear", track: 0 }).state;
    expect(state.tracks[0].hasPhrase).toBe(false);
    expect(state.tracks[0].level).toBe(100);
    expect(state.masterLengthSamples).toBe(BAR);
    expect(state.tracks[1].hasPhrase).toBe(true);
  });

  it("forgets the master length when the last phrase is cleared", () => {
    let state = recordFirst(createLooperState(48_000), 0, "play");
    state = reduce(state, { type: "clear", track: 0 }).state;
    expect(state.masterLengthSamples).toBe(0);
    expect(state.masterTrack).toBeNull();
  });
});

describe("undo and redo", () => {
  it("undoes the first recording to empty and redo restores it", () => {
    let state = recordFirst(createLooperState(48_000), 0, "play");
    expect(state.tracks[0].canUndo).toBe(true);
    const undone = reduce(state, { type: "undo", track: 0 });
    expect(undone.state.tracks[0].phase).toBe("empty");
    expect(undone.state.tracks[0].hasPhrase).toBe(false);
    expect(undone.state.tracks[0].canRedo).toBe(true);
    expect(undone.state.masterLengthSamples).toBe(0);
    expect(hasEffect(undone.effects, "swapUndo", 0)).toBe(true);
    const redone = reduce(undone.state, { type: "redo", track: 0 });
    expect(redone.state.tracks[0].hasPhrase).toBe(true);
    expect(redone.state.tracks[0].lengthSamples).toBe(BAR);
    expect(redone.state.tracks[0].phase).toBe("stopped");
    expect(redone.state.masterLengthSamples).toBe(BAR);
    expect(redone.state.tracks[0].canUndo).toBe(true);
    expect(redone.state.tracks[0].canRedo).toBe(false);
  });

  it("toggles a single overdub layer", () => {
    let state = recordFirst(createLooperState(48_000), 0, "play");
    const dubbed = reduce(state, { type: "toDub", track: 0 });
    expect(hasEffect(dubbed.effects, "snapshotUndo", 0)).toBe(true);
    expect(dubbed.state.tracks[0].canRedo).toBe(false);
    expect(dubbed.state.tracks[0].undoClearsPhrase).toBe(false);
    const undone = reduce(dubbed.state, { type: "undo", track: 0 });
    expect(undone.state.tracks[0].phase).toBe("play");
    expect(undone.state.tracks[0].hasPhrase).toBe(true);
    expect(undone.state.tracks[0].canUndo).toBe(false);
    expect(undone.state.tracks[0].canRedo).toBe(true);
    const redone = reduce(undone.state, { type: "redo", track: 0 });
    expect(redone.state.tracks[0].hasPhrase).toBe(true);
    expect(redone.state.tracks[0].canUndo).toBe(true);
    expect(redone.state.tracks[0].canRedo).toBe(false);
    expect(redone.state.tracks[0].phase).toBe("play");
  });

  it("starting a new overdub discards redo", () => {
    let state = recordFirst(createLooperState(48_000), 0, "play");
    state = reduce(state, { type: "toDub", track: 0 }).state;
    state = reduce(state, { type: "undo", track: 0 }).state;
    expect(state.tracks[0].canRedo).toBe(true);
    state = reduce(state, { type: "toDub", track: 0 }).state;
    expect(state.tracks[0].canRedo).toBe(false);
    expect(state.tracks[0].canUndo).toBe(true);
  });
});

describe("all start and all stop", () => {
  it("starts every phrase together and stops them", () => {
    let state = recordFirst(createLooperState(48_000), 0, "play");
    state = reduce(state, { type: "stop", track: 0 }).state;
    state = reduce(state, { type: "startRec", track: 1 }).state;
    state = reduce(state, { type: "commitRec", track: 1, length: BAR, next: "play" }).state;
    state = reduce(state, { type: "stop", track: 1 }).state;
    expect(state.tracks[0].phase).toBe("stopped");
    expect(state.tracks[1].phase).toBe("stopped");
    const started = reduce(state, { type: "allStart" });
    expect(started.state.tracks[0].phase).toBe("play");
    expect(started.state.tracks[1].phase).toBe("play");
    expect(started.state.tracks[2].phase).toBe("empty");
    expect(hasEffect(started.effects, "resetCycle")).toBe(true);
    const stopped = reduce(started.state, { type: "allStop" });
    expect(stopped.state.tracks[0].phase).toBe("stopped");
    expect(stopped.state.tracks[1].phase).toBe("stopped");
    expect(stopped.state.tracks[0].hasPhrase).toBe(true);
  });

  it("cancels an in-progress first take on all stop", () => {
    let state = reduce(createLooperState(48_000), { type: "startRec", track: 0 }).state;
    state = reduce(state, { type: "allStop" }).state;
    expect(state.tracks[0].phase).toBe("empty");
  });
});

describe("tempo, meter, and mixer", () => {
  it("refuses tempo changes while recording", () => {
    let state = reduce(createLooperState(48_000), { type: "startRec", track: 0 }).state;
    expect(isTempoLocked(state)).toBe(true);
    const result = reduce(state, { type: "setBpm", bpm: 140 });
    expect(result.state.bpm).toBe(120);
    expect(hasEffect(result.effects, "message")).toBe(true);
  });

  it("changes tempo when the transport is idle", () => {
    const result = reduce(createLooperState(48_000), { type: "setBpm", bpm: 96 });
    expect(result.state.bpm).toBe(96);
  });

  it("locks the time signature once a phrase exists", () => {
    let state = recordFirst(createLooperState(48_000), 0, "play");
    const blocked = reduce(state, { type: "setBeatsPerBar", beatsPerBar: 3 });
    expect(blocked.state.beatsPerBar).toBe(4);
    state = reduce(state, { type: "clear", track: 0 }).state;
    const changed = reduce(state, { type: "setBeatsPerBar", beatsPerBar: 3 });
    expect(changed.state.beatsPerBar).toBe(3);
  });

  it("clamps level and pan and switches input", () => {
    let state = createLooperState(48_000);
    state = reduce(state, { type: "setLevel", track: 0, level: 500 }).state;
    state = reduce(state, { type: "setPan", track: 0, pan: -80 }).state;
    state = reduce(state, { type: "setInput", track: 0, input: "mic" }).state;
    expect(state.tracks[0].level).toBe(200);
    expect(state.tracks[0].pan).toBe(-50);
    expect(state.tracks[0].input).toBe("mic");
    state = reduce(state, { type: "clear", track: 0 }).state;
    expect(state.tracks[0].level).toBe(200);
    expect(state.tracks[0].input).toBe("mic");
  });
});
