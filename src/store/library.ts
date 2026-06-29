import { useSyncExternalStore } from "react";
import { studio, type RecFile } from "../lib/bridge";

// Shared, app-lifetime cache of the recordings library. Warmed ONCE during the
// splash screen (list + on-disk thumbnails) so the Library/Optimize lists are
// already populated — they never show a "loading / generating" state mid-session.
// Pages read the snapshot synchronously and subscribe for background refreshes.

let items: RecFile[] = [];
let loaded = false;
let inflight: Promise<RecFile[]> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Snapshot identity only changes when the list actually changes (so consumers
// using useSyncExternalStore don't tear / loop).
export function getLibrary(): RecFile[] {
  return items;
}
export function isLibraryLoaded(): boolean {
  return loaded;
}

export async function refreshLibrary(): Promise<RecFile[]> {
  if (!studio?.listRecordings) return items;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const files = (await studio.listRecordings()) || [];
      // Only swap (and notify) when something changed.
      const changed = files.length !== items.length || files.some((f, i) => f.path !== items[i]?.path || f.sizeMb !== items[i]?.sizeMb);
      if (changed || !loaded) {
        items = files;
        loaded = true;
        emit();
      }
      // Pre-generate thumbnails on disk (main caches them) so tiles are instant
      // later. Fire-and-forget; the main-process gate bounds ffmpeg concurrency.
      for (const f of files) {
        if (f.path) studio.generateThumb?.(f.path).catch(() => {});
      }
      return items;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Kick the warm-up exactly once (called from the splash).
let warmed = false;
export function warmLibrary() {
  if (warmed) return;
  warmed = true;
  refreshLibrary().catch(() => {});
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
export function useLibrary(): RecFile[] {
  return useSyncExternalStore(subscribe, getLibrary, getLibrary);
}
export function useLibraryLoaded(): boolean {
  return useSyncExternalStore(subscribe, isLibraryLoaded, isLibraryLoaded);
}
