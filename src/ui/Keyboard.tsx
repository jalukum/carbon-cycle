import { useRef, useState, type PointerEvent } from "react";
import { engine } from "../engine/engine";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteName(note: number): string {
  const name = NAMES[((note % 12) + 12) % 12] ?? "C";
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
}

function isBlack(note: number): boolean {
  const pc = ((note % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export function Keyboard({ baseNote }: { baseNote: number }) {
  const root = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, number>());
  const counts = useRef(new Map<number, number>());
  const [down, setDown] = useState<number[]>([]);

  function press(note: number) {
    const count = counts.current.get(note) ?? 0;
    counts.current.set(note, count + 1);
    if (count === 0) engine.noteOn(note, 0.86);
    setDown([...counts.current.keys()]);
  }

  function release(note: number) {
    const count = (counts.current.get(note) ?? 1) - 1;
    if (count <= 0) {
      counts.current.delete(note);
      engine.noteOff(note);
    } else {
      counts.current.set(note, count);
    }
    setDown([...counts.current.keys()]);
  }

  function noteAt(x: number, y: number): number | null {
    const element = document.elementFromPoint(x, y);
    const key = element?.closest("[data-note]");
    if (!key || !root.current?.contains(key)) return null;
    const note = Number((key as HTMLElement).dataset.note);
    return Number.isFinite(note) ? note : null;
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    root.current?.setPointerCapture(event.pointerId);
    const note = noteAt(event.clientX, event.clientY);
    if (note == null) return;
    pointers.current.set(event.pointerId, note);
    press(note);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const note = noteAt(event.clientX, event.clientY);
    const previous = pointers.current.get(event.pointerId);
    if (note == null || note === previous) return;
    if (previous != null) release(previous);
    pointers.current.set(event.pointerId, note);
    press(note);
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    pointers.current.delete(event.pointerId);
    if (previous != null) release(previous);
  }

  const whites: number[] = [];
  const blacks: { note: number; after: number }[] = [];
  let whiteIndex = 0;
  for (let note = baseNote; note < baseNote + 24; note++) {
    if (isBlack(note)) {
      blacks.push({ note, after: whiteIndex });
    } else {
      whites.push(note);
      whiteIndex += 1;
    }
  }

  return (
    <div
      ref={root}
      className="keyboard"
      data-noswipe
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="whites">
        {whites.map((note) => (
          <div
            key={note}
            data-note={note}
            className={down.includes(note) ? "white-key is-down" : "white-key"}
          >
            {note % 12 === 0 ? <span>{noteName(note)}</span> : null}
          </div>
        ))}
      </div>
      <div className="blacks">
        {blacks.map((key) => (
          <div
            key={key.note}
            data-note={key.note}
            className={down.includes(key.note) ? "black-key is-down" : "black-key"}
            style={{ ["--after" as string]: String(key.after) }}
          />
        ))}
      </div>
    </div>
  );
}

export function noteRangeLabel(baseNote: number): string {
  return `${noteName(baseNote)} – ${noteName(baseNote + 23)}`;
}
