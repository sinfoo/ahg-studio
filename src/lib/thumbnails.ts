// Timeline filmstrip + waveform images.
//
// These are generated ONCE per source by the main process (ffmpeg) and shown in
// the renderer as plain CSS background images — the renderer never decodes video
// frames or runs canvas.toDataURL on its main thread (that was the editor lag and
// the "no thumbnails" cause). A clip slices its [in,out] out of the full-source
// strip with background-size / background-position, so trimming and zooming are
// free (no regeneration).
import { useEffect, useState } from "react";
import { studio } from "./bridge";

export interface Strip {
  url: string;
  dur: number;
  count: number;
}
export interface Waveform {
  url: string;
  dur: number;
}

const MAX_CACHE = 60; // bound both caches so a long session can't grow unbounded
const stripCache = new Map<string, Promise<Strip | null>>();
const waveCache = new Map<string, Promise<Waveform | null>>();

// Map preserves insertion order — re-inserting on hit keeps it LRU; drop oldest.
function lru<T>(cache: Map<string, T>, key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const val = make();
  cache.set(key, val);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return val;
}

function getFilmstrip(path: string): Promise<Strip | null> {
  return lru(stripCache, path, () => (studio?.filmstrip?.(path) ?? Promise.resolve(null)).catch(() => null));
}

function getWaveform(path: string): Promise<Waveform | null> {
  return lru(waveCache, path, () => (studio?.waveform?.(path) ?? Promise.resolve(null)).catch(() => null));
}

// One filmstrip image per source (cached). The caller positions it for [in,out].
export function useFilmstrip(path: string | undefined): Strip | null {
  const [strip, setStrip] = useState<Strip | null>(null);
  useEffect(() => {
    if (!path) {
      setStrip(null);
      return;
    }
    let live = true;
    getFilmstrip(path).then((s) => live && setStrip(s));
    return () => {
      live = false;
    };
  }, [path]);
  return strip;
}

// One waveform image per source (cached).
export function useWaveform(path: string | undefined): Waveform | null {
  const [wave, setWave] = useState<Waveform | null>(null);
  useEffect(() => {
    if (!path) {
      setWave(null);
      return;
    }
    let live = true;
    getWaveform(path).then((w) => live && setWave(w));
    return () => {
      live = false;
    };
  }, [path]);
  return wave;
}
