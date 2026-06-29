import { useSyncExternalStore } from "react";
import { studio, type CompressOpts } from "../lib/bridge";
import { notify } from "../lib/notify";

export interface OptimizeState {
  running: boolean;
  progress: number;
  done: boolean;
  output: string | null;
  outputSize: number;
  label: string;
  error: string | null;
  minimized: boolean; // job continues in background; show only the mini indicator
  startedAt: number; // perf timestamp (for elapsed display)
}

let state: OptimizeState = { running: false, progress: 0, done: false, output: null, outputSize: 0, label: "", error: null, minimized: false, startedAt: 0 };
const listeners = new Set<() => void>();
function set(patch: Partial<OptimizeState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function useOptimize() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
export function getOptimize() {
  return state;
}
export function setOptimizeMinimized(v: boolean) {
  set({ minimized: v });
}
let clearDoneTimer: ReturnType<typeof setTimeout> | undefined;
export function dismissOptimize() {
  if (clearDoneTimer) clearTimeout(clearDoneTimer);
  set({ done: false, error: null });
}
export function cancelOptimize() {
  studio?.cancelCompress?.();
}

// Bridge ffmpeg progress into the shared store (subscribed once).
if (studio) {
  studio.onCompressProgress((p) => set({ progress: p }));
}

export async function runOptimize(opts: CompressOpts, label: string) {
  if (!studio || state.running) return null;
  set({ running: true, progress: 0, done: false, output: null, outputSize: 0, label, error: null, minimized: false, startedAt: performance.now() });
  const r = await studio.compress(opts);
  if (r.cancelled) {
    set({ running: false, progress: 0, done: false, error: null, minimized: false });
    return null;
  }
  if (r.ok && r.output) {
    set({ running: false, progress: 1, done: true, output: r.output, outputSize: (r.size ?? 0) / 1048576 });
    const enc = r.encoder && r.encoder !== "cpu"
      ? r.encoder.includes("nvenc") ? " · GPU (NVENC)" : r.encoder.includes("qsv") ? " · GPU (QuickSync)" : r.encoder.includes("amf") ? " · GPU (AMF)" : r.encoder.includes("videotoolbox") ? " · GPU" : ""
      : "";
    notify({
      title: "Optimized",
      desc: `${label} is ready.${enc}`,
      tone: "success",
      action: { label: "Open", run: () => studio?.reveal(r.output!) },
    });
    // auto-clear the "done" flag after a moment (tracked so a new run / dismiss
    // cancels it instead of clobbering a later state).
    if (clearDoneTimer) clearTimeout(clearDoneTimer);
    clearDoneTimer = setTimeout(() => {
      if (getOptimize().output === r.output) set({ done: false });
    }, 6000);
    return r.output;
  }
  set({ running: false, error: r.error ?? "Optimization failed." });
  notify({ title: "Optimization failed", desc: r.error ?? "", tone: "error" });
  return null;
}
