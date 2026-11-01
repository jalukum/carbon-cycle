import { useSyncExternalStore } from "react";
import { engine } from "../engine/engine";
import type { EngineSnapshot } from "../engine/types";

export function useSnapshot(): EngineSnapshot {
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.getState(),
    () => engine.getState(),
  );
}

export { engine };
