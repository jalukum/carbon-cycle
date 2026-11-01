import { engine } from "../engine/engine";

export function Gate() {
  return (
    <div className="gate">
      <div className="gate-card">
        <span className="mark mark-lg" aria-hidden="true" />
        <h1>Carbon Cycle</h1>
        <p>Keyboard, loop station, and a pocket studio. One engine, three views.</p>
        <button type="button" className="solid gate-go" onClick={() => void engine.unlock()}>
          Tap to start
        </button>
        <p className="hint">Sound stays off until this tap — that’s how the phone unlocks audio.</p>
      </div>
    </div>
  );
}
