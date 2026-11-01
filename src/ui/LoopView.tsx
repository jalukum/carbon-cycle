import { useRef, useState, type PointerEvent } from "react";
import { TrackButton } from "./TrackButton";
import { engine, useSnapshot } from "./useEngine";
import type { SyncMultiple } from "../engine/types";

function HoldStop({ index }: { index: number }) {
  const [progress, setProgress] = useState(0);
  const held = useRef(false);
  const timer = useRef(0);

  function down(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    held.current = false;
    const start = performance.now();
    const tick = () => {
      const amount = (performance.now() - start) / 2000;
      if (amount >= 1) {
        held.current = true;
        setProgress(0);
        engine.trackClear(index);
        return;
      }
      setProgress(amount);
      timer.current = window.setTimeout(tick, 32);
    };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(tick, 32);
  }

  function up() {
    window.clearTimeout(timer.current);
    const didClear = held.current;
    held.current = false;
    setProgress(0);
    if (!didClear) engine.trackStop(index);
  }

  return (
    <button
      type="button"
      className="stop-btn"
      data-noswipe
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      aria-label={`Stop track ${index + 1}. Hold to clear.`}
    >
      <span className="stop-fill" style={{ width: `${progress * 100}%` }} />
      <span>Stop · hold to clear</span>
    </button>
  );
}

export function LoopView() {
  const snap = useSnapshot();
  const drift = snap.tracks.some(
    (track) => track.originalBpm != null && Math.abs(track.originalBpm - snap.bpm) > 0.8,
  );
  const multiples: SyncMultiple[] = [1, 2, 4];

  return (
    <section className="loop view-fill">
      <div className="settings-row" data-noswipe>
        <div className="segment" role="group" aria-label="Record action">
          <button
            type="button"
            className={snap.recAction === "rec-dub" ? "is-on" : ""}
            onClick={() => engine.setRecAction("rec-dub")}
          >
            Rec→Dub
          </button>
          <button
            type="button"
            className={snap.recAction === "rec-play" ? "is-on" : ""}
            onClick={() => engine.setRecAction("rec-play")}
          >
            Rec→Play
          </button>
        </div>
        <div className="segment" role="group" aria-label="Loop multiple">
          {multiples.map((multiple) => (
            <button
              key={multiple}
              type="button"
              className={snap.syncMultiple === multiple ? "is-on" : ""}
              onClick={() => engine.setSyncMultiple(multiple)}
            >
              {multiple}×
            </button>
          ))}
        </div>
        <button type="button" className="text-btn" onClick={() => void engine.enableMic()}>
          {snap.micGranted ? "Mic on" : "Enable mic"}
        </button>
        <button
          type="button"
          className={snap.micMonitor ? "text-btn is-on" : "text-btn"}
          onClick={() => engine.setMicMonitor(!snap.micMonitor)}
          disabled={!snap.micGranted}
        >
          Monitor
        </button>
        <div className="peak" aria-hidden="true">
          <span style={{ width: `${Math.min(100, snap.inputPeak * 140)}%` }} />
        </div>
      </div>
      <p className="hint">
        {snap.masterBars > 0
          ? `Loop sync · first loop is ${formatBars(snap.masterBars)}. Later tracks lock to ${snap.syncMultiple}× that length.`
          : "The first loop sets the length. Later tracks lock to it, on the bar."}
        {drift ? " Recorded loops keep their original speed." : ""}
      </p>
      <div className="loop-list">
        {snap.tracks.map((track, index) => (
          <article key={index} className="loop-card" data-phase={track.phase}>
            <TrackButton
              index={index}
              track={track}
              size="lg"
              onTap={() => void engine.trackRecPlay(index)}
              onStop={() => engine.trackStop(index)}
              onClear={() => engine.trackClear(index)}
            />
            <div className="loop-body">
              <div className="loop-top">
                <strong>Track {index + 1}</strong>
                <span className="muted">
                  {track.hasPhrase ? formatBars(track.lengthBars) : "Empty"}
                  {track.originalBpm ? ` · ${Math.round(track.originalBpm)} bpm` : ""}
                </span>
                <div className="segment slim" data-noswipe>
                  <button
                    type="button"
                    className={track.input === "mic" ? "is-on" : ""}
                    onClick={() => engine.setTrackInput(index, "mic")}
                  >
                    Mic
                  </button>
                  <button
                    type="button"
                    className={track.input === "instrument" ? "is-on" : ""}
                    onClick={() => engine.setTrackInput(index, "instrument")}
                  >
                    Keys
                  </button>
                </div>
              </div>
              <label className="slider" data-noswipe>
                <span>Level {Math.round(track.level)}</span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={track.level}
                  onChange={(event) => engine.setTrackLevel(index, Number(event.target.value))}
                />
              </label>
              <label className="slider" data-noswipe>
                <span>Pan {track.pan === 0 ? "C" : track.pan < 0 ? `L${Math.abs(track.pan)}` : `R${track.pan}`}</span>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  value={track.pan}
                  onChange={(event) => engine.setTrackPan(index, Number(event.target.value))}
                  onPointerUp={() => {
                    if (Math.abs(track.pan) > 0 && Math.abs(track.pan) < 4) engine.setTrackPan(index, 0);
                  }}
                />
              </label>
              <div className="undo-row">
                <button type="button" disabled={!track.canUndo} onClick={() => engine.trackUndo(index)}>
                  Undo
                </button>
                <button type="button" disabled={!track.canRedo} onClick={() => engine.trackRedo(index)}>
                  Redo
                </button>
              </div>
              <HoldStop index={index} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatBars(bars: number): string {
  if (bars <= 0) return "—";
  const rounded = Math.round(bars * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
  return `${text} ${rounded === 1 ? "bar" : "bars"}`;
}
