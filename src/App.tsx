import { useEffect, useRef, useState } from "react";
import { engine, useSnapshot } from "./ui/useEngine";
import { Gate } from "./ui/Gate";
import { TransportBar } from "./ui/TransportBar";
import { PlayView } from "./ui/PlayView";
import { LoopView } from "./ui/LoopView";
import { StudioView } from "./ui/StudioView";

const VIEWS = ["play", "loop", "studio"] as const;
type View = (typeof VIEWS)[number];

const LABELS: Record<View, string> = {
  play: "Play",
  loop: "Loop",
  studio: "Studio",
};

export function App() {
  const snap = useSnapshot();
  const [view, setView] = useState<View>("play");
  const swipe = useRef<{ x: number; y: number; armed: boolean } | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, button, a")) return;
      if (event.code === "Space") {
        event.preventDefault();
        engine.toggleAll();
      } else if (event.code === "KeyM") {
        engine.toggleMetronome();
      } else if (event.code === "KeyT") {
        engine.tap();
      } else if (/^Digit[1-5]$/.test(event.code)) {
        const track = Number(event.code.slice(5)) - 1;
        void engine.trackRecPlay(track);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!snap.audioUnlocked) return <Gate />;

  const index = VIEWS.indexOf(view);

  function move(delta: number) {
    setView(VIEWS[Math.min(VIEWS.length - 1, Math.max(0, index + delta))] ?? "play");
  }

  return (
    <div className="app">
      <TransportBar />
      <div
        className="pager"
        onPointerDown={(event) => {
          const element = event.target as HTMLElement;
          if (element.closest("[data-noswipe], button, input, a, label")) {
            swipe.current = null;
            return;
          }
          swipe.current = { x: event.clientX, y: event.clientY, armed: true };
        }}
        onPointerUp={(event) => {
          const origin = swipe.current;
          swipe.current = null;
          if (!origin?.armed) return;
          const dx = event.clientX - origin.x;
          const dy = event.clientY - origin.y;
          if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
          move(dx < 0 ? 1 : -1);
        }}
      >
        <div className="pager-track" style={{ transform: `translateX(-${index * 100}%)` }}>
          <PlayView />
          <LoopView />
          <StudioView />
        </div>
      </div>
      <nav className="tabs" aria-label="Views">
        {VIEWS.map((item) => (
          <button
            key={item}
            type="button"
            className={item === view ? "is-on" : ""}
            onClick={() => setView(item)}
          >
            {LABELS[item]}
          </button>
        ))}
      </nav>
      {snap.error ? <p className="banner">{snap.error}</p> : null}
      {snap.message ? (
        <button type="button" className="toast" onClick={() => engine.dismissMessage()}>
          {snap.message}
        </button>
      ) : null}
    </div>
  );
}
