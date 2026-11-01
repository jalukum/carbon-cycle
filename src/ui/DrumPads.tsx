import { useState } from "react";
import { engine } from "../engine/engine";
import { DRUM_PADS } from "../engine/instruments";

export function DrumPads() {
  const [lit, setLit] = useState<number | null>(null);

  function hit(note: number) {
    engine.noteOn(note, 0.95);
    setLit(note);
    window.setTimeout(() => setLit((current) => (current === note ? null : current)), 90);
  }

  return (
    <div className="pads" data-noswipe>
      {DRUM_PADS.map((pad) => (
        <button
          key={pad.note}
          type="button"
          className={lit === pad.note ? "pad is-lit" : "pad"}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            hit(pad.note);
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span>{pad.name}</span>
        </button>
      ))}
    </div>
  );
}
