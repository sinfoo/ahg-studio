import { useSyncExternalStore } from "react";

export type Tone = "success" | "info" | "error";
export interface Toast {
  id: number;
  title: string;
  desc?: string;
  tone: Tone;
  action?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
// Track each toast's auto-dismiss timer so an early manual dismiss clears it
// (instead of leaving a dangling timer to fire 4.5s later).
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function notify(t: Omit<Toast, "id">) {
  const id = nextId++;
  toasts = [...toasts, { ...t, id }];
  emit();
  timers.set(id, setTimeout(() => dismiss(id), 4500));
  return id;
}
export function dismiss(id: number) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function useToasts() {
  return useSyncExternalStore(subscribe, () => toasts, () => toasts);
}

/* ---------- synthesized sounds (no asset files needed) ---------- */
let ac: AudioContext | null = null;
function ctx() {
  if (!ac) {
    try {
      ac = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ac.state === "suspended") ac.resume().catch(() => {});
  return ac;
}

function tone(freq: number, start: number, dur: number, gain = 0.18, type: OscillatorType = "sine") {
  const c = ctx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.02);
}

// Bright two-note rising chime for success (instant replay saved).
export function playChime() {
  tone(659.25, 0, 0.18, 0.16, "triangle");
  tone(987.77, 0.09, 0.32, 0.16, "triangle");
}

// Soft rising blip when recording starts.
export function playStart() {
  tone(523.25, 0, 0.12, 0.14, "sine");
  tone(783.99, 0.07, 0.2, 0.14, "sine");
}

// Two-note descending tone when recording stops (UI only, not in the recording).
export function playStop() {
  tone(659.25, 0, 0.14, 0.15, "sine");
  tone(440.0, 0.1, 0.26, 0.15, "sine");
}

// Quick camera-shutter-ish click for screenshots.
export function playShutter() {
  const c = ctx();
  if (!c) return;
  const buffer = c.createBuffer(1, c.sampleRate * 0.05, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const src = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = 0.25;
  src.buffer = buffer;
  src.connect(g).connect(c.destination);
  src.start();
  tone(1200, 0, 0.04, 0.08, "square");
}
