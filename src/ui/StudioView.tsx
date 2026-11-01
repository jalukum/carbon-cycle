import { engine, useSnapshot } from "./useEngine";

export function StudioView() {
  const snap = useSnapshot();
  return (
    <section className="studio view-fill">
      <div className="studio-hero">
        <p className="eyebrow">Studio · v0.1</p>
        <h2>Keep the loop. The timeline comes later.</h2>
        <p>
          This version saves one project on the device and exports the five tracks as a single mix.
          Arrangement, piano roll, and effects land in later versions.
        </p>
      </div>
      <form
        className="panel"
        data-noswipe
        onSubmit={(event) => {
          event.preventDefault();
          void engine.saveProject();
        }}
      >
        <label className="field">
          Project name
          <input
            value={snap.projectName}
            maxLength={40}
            onChange={(event) => engine.setProjectName(event.target.value)}
          />
        </label>
        <div className="studio-actions">
          <button type="submit" className="solid">
            Save
          </button>
          <button type="button" onClick={() => void engine.loadProject()}>
            Load
          </button>
          <button type="button" onClick={() => void engine.exportMix()}>
            Export WAV
          </button>
        </div>
        <p className="hint">
          {snap.hasSavedProject ? "A project is stored in this browser." : "Nothing saved yet."}{" "}
          Audio is kept in IndexedDB and can be cleared by the browser if storage gets tight.
        </p>
      </form>
      <div className="panel latency">
        <h3>Latency</h3>
        <p>
          Output delay is about {snap.outputLatencyMs || snap.baseLatencyMs} ms. Recording is shifted
          to match the click. Nudge it if the downbeat lands early or late — especially on a phone mic.
        </p>
        <label className="slider" data-noswipe>
          <span>Nudge {snap.nudgeMs > 0 ? `+${snap.nudgeMs}` : snap.nudgeMs} ms</span>
          <input
            type="range"
            min={-40}
            max={60}
            step={1}
            value={snap.nudgeMs}
            onChange={(event) => engine.setNudgeMs(Number(event.target.value))}
          />
        </label>
        <p className="hint">
          Base {snap.baseLatencyMs} ms · output {snap.outputLatencyMs} ms · compensation{" "}
          {snap.compensationMs} ms. Use headphones with the mic.
        </p>
      </div>
      <div className="soon">
        <article>
          <h3>Timeline</h3>
          <p>Capture these loops onto a bar grid. v0.3.</p>
        </article>
        <article>
          <h3>Piano roll</h3>
          <p>MIDI loops you can edit after the take. v0.3.</p>
        </article>
        <article>
          <h3>RC-505 FX</h3>
          <p>Input and track effect banks. v0.4.</p>
        </article>
      </div>
    </section>
  );
}
