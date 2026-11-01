import { engine, useSnapshot } from "./useEngine";
import { formatBpm } from "../engine/timing";

export function TransportBar() {
  const snap = useSnapshot();
  const running = snap.anyRunning;
  return (
    <header className="transport">
      <div className="brand">
        <span className="mark" aria-hidden="true" />
        <div>
          <p className="wordmark">Carbon Cycle</p>
          <p className="wordmark-sub">{snap.projectName}</p>
        </div>
      </div>
      <div className="beats" aria-hidden="true">
        {Array.from({ length: snap.beatsPerBar }, (_, index) => (
          <span
            key={index}
            className={
              snap.beat === index ? (index === 0 ? "beat is-down" : "beat is-on") : "beat"
            }
          />
        ))}
      </div>
      <div className="transport-controls">
        <button
          type="button"
          className={running ? "all-btn is-live" : "all-btn"}
          onClick={() => engine.toggleAll()}
          aria-label={running ? "Stop all tracks" : "Start all tracks"}
        >
          {running ? <span className="icon-stop" /> : <span className="icon-play" />}
        </button>
        <button
          type="button"
          className="sig-btn"
          onClick={() => engine.toggleTimeSignature()}
          disabled={snap.signatureLocked}
          aria-label="Time signature"
        >
          {snap.beatsPerBar}/4
        </button>
        <div className="bpm-box">
          <button type="button" onClick={() => engine.nudgeBpm(-1)} disabled={snap.tempoLocked} aria-label="Slower">
            −
          </button>
          <button type="button" className="bpm-value" onClick={() => engine.tap()} aria-label="Tap tempo">
            {formatBpm(snap.bpm)}
          </button>
          <button type="button" onClick={() => engine.nudgeBpm(1)} disabled={snap.tempoLocked} aria-label="Faster">
            +
          </button>
        </div>
        <button type="button" className="text-btn" onClick={() => engine.tap()}>
          Tap
        </button>
        <button
          type="button"
          className={snap.metronome ? "text-btn is-on" : "text-btn"}
          onClick={() => engine.toggleMetronome()}
          aria-pressed={snap.metronome}
        >
          Click
        </button>
        <button
          type="button"
          className={snap.countInBars ? "text-btn is-on" : "text-btn"}
          onClick={() => engine.toggleCountIn()}
          aria-pressed={snap.countInBars === 1}
        >
          In
        </button>
      </div>
    </header>
  );
}
