import { useSyncExternalStore } from "react";
import { studio, type HotkeyAction } from "../lib/bridge";

export type Resolution = "native" | "2160" | "1440" | "1080" | "720";
export type RecFormat = "mp4" | "webm" | "mkv";
export type OptFormat = "mp4" | "mkv" | "webm" | "mov" | "gif";
export type Theme = "dark" | "light" | "midnight" | "graphite" | "aurora";

export interface SavedSource {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  crop: { l: number; t: number; r: number; b: number };
  z: number;
  visible: boolean;
  locked: boolean;
  sourceId?: string;
  deviceId?: string;
  path?: string;
  text?: string;
  color?: string;
  fontSize?: number;
}

export const THEMES: { id: Theme; label: string; swatch: string }[] = [
  { id: "dark", label: "Dark", swatch: "oklch(0.16 0.012 256)" },
  { id: "midnight", label: "Midnight Blue", swatch: "oklch(0.17 0.05 255)" },
  { id: "graphite", label: "Graphite", swatch: "oklch(0.2 0.004 286)" },
  { id: "aurora", label: "Aurora", swatch: "oklch(0.18 0.03 165)" },
  { id: "light", label: "Light", swatch: "oklch(0.96 0.006 256)" },
];

export type Hotkeys = Record<HotkeyAction, string>;

export interface AppSettings {
  // appearance
  theme: Theme;
  reducedMotion: boolean;
  // startup / general
  startWithWindows: boolean;
  startMinimized: boolean;
  minimizeToTray: boolean;
  countdownSec: 0 | 3 | 5;
  // capture
  systemAudio: boolean;
  micEnabled: boolean;
  micDeviceId: string;
  monitorEnabled: boolean;
  monitorDeviceId: string;
  showCursor: boolean;
  fps: 30 | 60 | 120 | 144;
  resolution: Resolution;
  recordFormat: RecFormat;
  recordBitrateMbps: number;
  // instant replay
  replayEnabled: boolean;
  replaySeconds: number;
  // output
  outputFolder: string; // videos / recordings
  screenshotFolder: string; // screenshots (falls back to outputFolder)
  autoOptimize: boolean;
  // encoder (optimize defaults)
  codec: "h264" | "hevc" | "av1";
  quality: number;
  preset: "fast" | "balanced" | "max";
  scale: "same" | "1080" | "720";
  optFormat: OptFormat;
  hwAccel: boolean; // use GPU encoders for Optimize when available
  // audio
  sampleRate: 48 | 44;
  channels: "stereo" | "mono";
  micVolume: number; // input gain applied to the mic in the mix (0..1.5, 1 = 100%)
  desktopVolume: number; // gain applied to captured system/desktop audio (0..1.5)
  monitorVolume: number; // local monitor playback volume (0..1, 1 = 100%)
  // hotkeys
  hotkeys: Hotkeys;
  // library
  libraryView: "list" | "grid";
  // persisted compositor layout (per profile)
  sourceLayout: SavedSource[];
}

const DEFAULTS: AppSettings = {
  theme: "dark",
  reducedMotion: false,
  startWithWindows: false,
  startMinimized: false,
  minimizeToTray: true,
  countdownSec: 0,
  systemAudio: true,
  micEnabled: false,
  micDeviceId: "",
  monitorEnabled: false,
  monitorDeviceId: "",
  showCursor: true,
  fps: 60,
  resolution: "native",
  recordFormat: "mp4",
  recordBitrateMbps: 16,
  replayEnabled: false,
  replaySeconds: 30,
  outputFolder: "",
  screenshotFolder: "",
  autoOptimize: false,
  codec: "hevc",
  quality: 62,
  preset: "balanced",
  scale: "same",
  optFormat: "mp4",
  hwAccel: true,
  sampleRate: 48,
  channels: "stereo",
  micVolume: 1,
  desktopVolume: 1,
  monitorVolume: 1,
  hotkeys: {
    startStop: "CommandOrControl+F9",
    pauseResume: "CommandOrControl+F10",
    saveReplay: "CommandOrControl+F12",
    screenshot: "CommandOrControl+Shift+S",
    muteMic: "CommandOrControl+Shift+M",
    muteDesktop: "CommandOrControl+Shift+D",
    toggleReplay: "CommandOrControl+Shift+R",
    optimizeLast: "CommandOrControl+Shift+O",
    nextSource: "CommandOrControl+Shift+Right",
    prevSource: "CommandOrControl+Shift+Left",
    openFolder: "CommandOrControl+Shift+E",
    cycleTheme: "CommandOrControl+Shift+T",
    showApp: "CommandOrControl+Shift+H",
    toggleCursor: "CommandOrControl+Shift+C",
  },
  libraryView: "grid",
  sourceLayout: [],
};

let state: AppSettings = { ...DEFAULTS };
const listeners = new Set<() => void>();

function applyEffects(s: AppSettings) {
  const root = document.documentElement;
  root.setAttribute("data-theme", s.theme);
  root.classList.toggle("reduce-motion", s.reducedMotion);
}

/* ---------------- profiles ---------------- */
let profiles: Record<string, AppSettings> = { Default: { ...DEFAULTS } };
let activeProfile = "Default";
let profileSnap: { names: string[]; active: string } = { names: ["Default"], active: "Default" };
function refreshProfileSnap() {
  profileSnap = { names: Object.keys(profiles), active: activeProfile };
}

function normalize(s: unknown): AppSettings {
  const src = (s || {}) as Partial<AppSettings>;
  const merged = { ...DEFAULTS, ...src };
  merged.hotkeys = { ...DEFAULTS.hotkeys, ...(src.hotkeys || {}) };
  return merged;
}

function emit() {
  listeners.forEach((l) => l());
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  const api = studio;
  if (!api) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.settings.set({ ...state, _profiles: profiles, _activeProfile: activeProfile } as unknown as Record<string, unknown>);
    api.applyStartup?.({ startWithWindows: state.startWithWindows, startMinimized: state.startMinimized });
  }, 200);
}

export function setSettings(patch: Partial<AppSettings>) {
  state = { ...state, ...patch };
  profiles[activeProfile] = state;
  applyEffects(state);
  emit();
  persist();
}

export function getSettings(): AppSettings {
  return state;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

export function toggleTheme() {
  setSettings({ theme: state.theme === "dark" ? "light" : "dark" });
}

/* profile API */
export function useProfiles() {
  return useSyncExternalStore(subscribe, () => profileSnap, () => profileSnap);
}
export function createProfile(rawName: string) {
  const name = (rawName || "").trim() || `Profile ${Object.keys(profiles).length + 1}`;
  profiles[name] = { ...state };
  activeProfile = name;
  state = profiles[name];
  refreshProfileSnap();
  applyEffects(state);
  emit();
  persist();
}
export function switchProfile(name: string) {
  if (!profiles[name]) return;
  activeProfile = name;
  state = normalize(profiles[name]);
  profiles[name] = state;
  refreshProfileSnap();
  applyEffects(state);
  emit();
  persist();
}
export function deleteProfile(name: string) {
  if (Object.keys(profiles).length <= 1 || !profiles[name]) return;
  delete profiles[name];
  if (activeProfile === name) {
    activeProfile = Object.keys(profiles)[0];
    state = normalize(profiles[activeProfile]);
  }
  refreshProfileSnap();
  applyEffects(state);
  emit();
  persist();
}

if (studio) {
  studio.settings
    .get()
    .then((loaded) => {
      if (loaded && typeof loaded === "object") {
        const L = loaded as Record<string, unknown>;
        if (L._profiles && typeof L._profiles === "object") {
          profiles = {};
          for (const k of Object.keys(L._profiles as object)) {
            profiles[k] = normalize((L._profiles as Record<string, unknown>)[k]);
          }
          if (!Object.keys(profiles).length) profiles = { Default: { ...DEFAULTS } };
          activeProfile = typeof L._activeProfile === "string" && profiles[L._activeProfile] ? L._activeProfile : Object.keys(profiles)[0];
        } else {
          profiles = { Default: normalize(L) };
          activeProfile = "Default";
        }
        state = profiles[activeProfile];
        refreshProfileSnap();
        applyEffects(state);
        emit();
      }
    })
    .catch(() => {});
}
applyEffects(state);
