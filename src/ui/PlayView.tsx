import { TrackButton } from "./TrackButton";
import { DrumPads } from "./DrumPads";
import { Keyboard, noteRangeLabel } from "./Keyboard";
import { engine, useSnapshot } from "./useEngine";
import { TRACK_COUNT } from "../engine/types";

export function PlayView() {
  const snap = useSnapshot();
  const baseNote = 12 * (snap.octave + 1);
  const midiLine = snap.midiInputs.length
    ? `MIDI · ${snap.midiInputs.join(", ")}`
    : (snap.midiReason ?? "MIDI");

  return (
    <section className="play view-fill">
      <div className="strip" data-noswipe>
        {snap.tracks.slice(0, TRACK_COUNT).map((track, index) => (
          <TrackButton
            key={index}
            index={index}
            track={track}
            onTap={() => void engine.trackRecPlay(index)}
            onStop={() => engine.trackStop(index)}
            onClear={() => engine.trackClear(index)}
          />
        ))}
      </div>
      <p className="hint">Tap a track to loop. Swipe it down to stop. Hold to clear.</p>
      <div className="play-tools" data-noswipe>
        <div className="segment" role="group" aria-label="Instrument">
          <button
            type="button"
            className={snap.instrument === "synth" ? "is-on" : ""}
            onClick={() => engine.setInstrument("synth")}
          >
            Synth
          </button>
          <button
            type="button"
            className={snap.instrument === "drums" ? "is-on" : ""}
            onClick={() => engine.setInstrument("drums")}
          >
            Drums
          </button>
        </div>
        {snap.instrument === "synth" ? (
          <>
            <div className="octave">
              <button type="button" onClick={() => engine.shiftOctave(-1)} aria-label="Octave down">
                −
              </button>
              <span>{noteRangeLabel(baseNote)}</span>
              <button type="button" onClick={() => engine.shiftOctave(1)} aria-label="Octave up">
                +
              </button>
            </div>
            <button
              type="button"
              className={snap.sustain ? "text-btn is-on" : "text-btn"}
              onClick={() => engine.toggleSustain()}
              aria-pressed={snap.sustain}
            >
              Sustain
            </button>
          </>
        ) : (
          <p className="hint tight">Synthesized kit. Pads and a GM controller both play it.</p>
        )}
      </div>
      <div className="stage">
        {snap.instrument === "drums" ? <DrumPads /> : <Keyboard baseNote={baseNote} />}
      </div>
      <p className="midi-line">{midiLine}</p>
    </section>
  );
}
