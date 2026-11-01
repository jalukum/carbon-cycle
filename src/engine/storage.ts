import type { BeatsPerBar, InputSource, RecAction, SyncMultiple } from "./types";

export interface StoredTrack {
  level: number;
  pan: number;
  input: InputSource;
  originalBpm: number | null;
  length: number;
  left: ArrayBuffer;
  right: ArrayBuffer;
}

export interface StoredProject {
  version: 1;
  name: string;
  savedAt: number;
  bpm: number;
  beatsPerBar: BeatsPerBar;
  recAction: RecAction;
  syncMultiple: SyncMultiple;
  countInBars: 0 | 1;
  metronome: boolean;
  nudgeMs: number;
  instrument: "synth" | "drums";
  octave: number;
  masterLengthSamples: number;
  masterTrack: number | null;
  tracks: StoredTrack[];
}

const DB_NAME = "carbon-cycle";
const STORE = "project";
const KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open storage."));
  });
}

export async function saveProject(project: StoredProject): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(project, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save."));
  });
  db.close();
}

export async function loadProject(): Promise<StoredProject | null> {
  const db = await openDb();
  const project = await new Promise<StoredProject | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve((request.result as StoredProject | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not load."));
  });
  db.close();
  if (!project || project.version !== 1) return null;
  return project;
}

export async function hasProject(): Promise<boolean> {
  const project = await loadProject();
  return project !== null;
}
