import { useRef, useState, type PointerEvent } from "react";
import type { TrackPhase, TrackSnapshot } from "../engine/types";

const PHASE_LABEL: Record<TrackPhase, string> = {
  empty: "READY",
  rec: "REC",
  dub: "DUB",
  play: "PLAY",
  stopped: "STOP",
};

function labelFor(track: TrackSnapshot): string {
  if (track.pending === "rec") return "ARM";
  if (track.pending === "commit") return "CLOSE";
  if (track.pending === "dub") return "DUB";
  if (track.pending === "play") return "PLAY";
  return PHASE_LABEL[track.phase];
}

export function TrackButton({
  index,
  track,
  size = "md",
  onTap,
  onStop,
  onClear,
}: {
  index: number;
  track: TrackSnapshot;
  size?: "md" | "lg";
  onTap: () => void;
  onStop: () => void;
  onClear: () => void;
}) {
  const [hold, setHold] = useState(0);
  const gesture = useRef({ x: 0, y: 0, swiped: false, held: false, timer: 0 });
  const shown =
    hold > 0
      ? hold
      : track.phase === "rec"
        ? track.recProgress
        : track.phase === "play" || track.phase === "dub"
          ? track.position
          : 0;

  function down(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current.x = event.clientX;
    gesture.current.y = event.clientY;
    gesture.current.swiped = false;
    gesture.current.held = false;
    window.clearTimeout(gesture.current.timer);
    const started = performance.now();
    const tick = () => {
      const amount = (performance.now() - started) / 2000;
      if (amount >= 1) {
        gesture.current.held = true;
        setHold(0);
        onClear();
        return;
      }
      setHold(amount);
      gesture.current.timer = window.setTimeout(tick, 32);
    };
    gesture.current.timer = window.setTimeout(tick, 32);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const dx = event.clientX - gesture.current.x;
    const dy = event.clientY - gesture.current.y;
    if (!gesture.current.swiped && !gesture.current.held && dy > 26 && Math.abs(dx) < 36) {
      gesture.current.swiped = true;
      window.clearTimeout(gesture.current.timer);
      setHold(0);
      onStop();
    }
  }

  function up() {
    window.clearTimeout(gesture.current.timer);
    const { swiped, held } = gesture.current;
    setHold(0);
    if (!swiped && !held) onTap();
  }

  const dash = 2 * Math.PI * 27;

  return (
    <button
      type="button"
      className={`track-pad size-${size}`}
      data-phase={track.phase}
      data-pending={track.pending ?? ""}
      data-has={track.hasPhrase ? "yes" : "no"}
      data-noswipe
      aria-label={`Track ${index + 1}, ${labelFor(track)}. Tap to record or play, swipe down to stop, hold to clear.`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(event) => event.preventDefault()}
    >
      <svg className="track-ring" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="27" className="ring-bg" />
        <circle
          cx="32"
          cy="32"
          r="27"
          className="ring-fg"
          strokeDasharray={`${Math.max(0, shown) * dash} ${dash}`}
          strokeDashoffset={dash * 0.25}
        />
      </svg>
      <span className="track-num">{index + 1}</span>
      <span className="track-state">{labelFor(track)}</span>
    </button>
  );
}
