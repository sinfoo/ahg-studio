import { useSyncExternalStore } from "react";
import { studio } from "../lib/bridge";
import { notify } from "../lib/notify";

// Global timeline-export job — mirrors the optimize store so a render can be
// MINIMIZED to a floating PiP and keep running in the background while you record
// or optimize (and so two PiPs can stack like notifications).
export interface ExportJobState {
  running: boolean;
  progress: number;
  done: boolean;
  output: string | null;
  outputSize: number; // MB
  label: string;
  error: string | null;
  minimized: boolean;
  startedAt: number;
}

let state: ExportJobState = { running: false, progress: 0, done: false, output: null, outputSize: 0, label: "", error: null, minimized: false, startedAt: 0 };
const listeners = new Set<() => void>();
function set(patch: Partial<ExportJobState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function useExportJob() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
export function getExportJob() {
  return state;
}
export function setExportMinimized(v: boolean) {
  set({ minimized: v });
}
let clearDoneTimer: ReturnType<typeof setTimeout> | undefined;
export function dismissExport() {
  if (clearDoneTimer) clearTimeout(clearDoneTimer);
  set({ done: false, error: null });
}
export function cancelExportJob() {
  studio?.cancelExport?.();
}

// Bridge ffmpeg export progress into the store (subscribed once).
if (studio) {
  studio.onExportProgress((p) => set({ progress: p }));
}

export async function runExportJob(spec: unknown, label: string) {
  if (!studio || state.running) return null;
  set({ running: true, progress: 0, done: false, output: null, outputSize: 0, label, error: null, minimized: false, startedAt: performance.now() });
  const r = await studio.exportTimeline(spec);
  if (r.cancelled) {
    set({ running: false, progress: 0, done: false, error: null, minimized: false });
    return null;
  }
  if (r.ok && r.output) {
    set({ running: false, progress: 1, done: true, output: r.output, outputSize: (r.size ?? 0) / 1048576 });
    notify({ title: "Export complete", desc: `${label} is ready.`, tone: "success", action: { label: "Open", run: () => studio?.reveal(r.output!) } });
    if (clearDoneTimer) clearTimeout(clearDoneTimer);
    clearDoneTimer = setTimeout(() => {
      if (getExportJob().output === r.output) set({ done: false });
    }, 6000);
    return r.output;
  }
  set({ running: false, error: r.error ?? "Export failed." });
  notify({ title: "Export failed", desc: r.error ?? "", tone: "error" });
  return null;
}
