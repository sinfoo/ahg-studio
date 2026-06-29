export interface RecFile {
  path: string;
  name: string;
  sizeMb: number;
  durationSec: number;
  codec: string;
  optimized: boolean;
  mtime: number;
}

export interface FileRef {
  name: string;
  path?: string;
  sizeMb?: number;
}

export interface CompressOpts {
  input: string;
  codec: "h264" | "hevc" | "av1";
  quality: number;
  scale: "same" | "1080" | "720";
  preset: "fast" | "balanced" | "max";
  format?: "mp4" | "mkv" | "webm" | "mov" | "gif";
  outputName?: string;
  // Use a GPU encoder (NVENC/QSV/AMF/VideoToolbox) when available; falls back to
  // CPU automatically. Defaults to enabled.
  hwAccel?: boolean;
  fps?: number; // cap output frame rate (0/undefined = keep source)
  mute?: boolean; // drop the audio track
  audioKbps?: number; // audio bitrate when not muted
  stripMeta?: boolean; // strip source metadata
}

export interface HwEncoders {
  h264: string | null;
  hevc: string | null;
  av1: string | null;
  vendor: "nvidia" | "intel" | "amd" | "apple" | null;
}

export type HotkeyAction =
  | "startStop"
  | "pauseResume"
  | "saveReplay"
  | "screenshot"
  | "muteMic"
  | "muteDesktop"
  | "toggleReplay"
  | "optimizeLast"
  | "nextSource"
  | "prevSource"
  | "openFolder"
  | "cycleTheme"
  | "showApp"
  | "toggleCursor";

export interface CaptureSource {
  id: string;
  name: string;
  type: "screen" | "window";
  thumbnail: string;
  icon: string;
}

export interface Metrics {
  cpu: number;
  memMb: number;
}

export interface StudioAPI {
  isElectron: true;
  pathForFile: (file: File) => string;
  onCloseRequest: (cb: () => void) => () => void;
  confirmClose: () => void;
  cancelClose: () => void;
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onState: (cb: (max: boolean) => void) => () => void;
  };
  settings: {
    get: () => Promise<Record<string, unknown>>;
    set: (patch: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  saveRecording: (
    buffer: ArrayBuffer,
    ext: string,
    durationSec?: number
  ) => Promise<{ path: string; size: number }>;
  listRecordings: () => Promise<RecFile[]>;
  deleteRecording: (p: string) => Promise<{ ok: boolean; error?: string }>;
  recordingsDir: () => Promise<string>;
  openRecordingsDir: () => void;
  pickFile: () => Promise<{ path: string; name: string; sizeMb: number } | null>;
  pickImage: () => Promise<{ path: string; name: string } | null>;
  pickFolder: () => Promise<string | null>;
  reveal: (p: string) => void;
  openFile: (p: string) => void;
  openExternal: (url: string) => void;
  listSources: () => Promise<CaptureSource[]>;
  getMetrics: () => Promise<Metrics>;
  compress: (opts: CompressOpts) => Promise<{ ok: boolean; output?: string; size?: number; error?: string; cancelled?: boolean; encoder?: string }>;
  cancelCompress: () => Promise<boolean>;
  detectHwEncoders: () => Promise<HwEncoders>;
  // Build (or fetch the cached) CFR 720p editing proxy for a source file.
  makeProxy: (input: string) => Promise<{ ok: boolean; path?: string; url?: string; pending?: boolean; error?: string }>;
  cancelExport: () => Promise<boolean>;
  onCompressProgress: (cb: (pct: number) => void) => () => void;
  detectSilence: (
    input: string,
    noiseDb: number,
    minSilence: number
  ) => Promise<{ ok: boolean; ranges: { start: number; end: number }[] }>;
  filmstrip: (path: string) => Promise<{ url: string; dur: number; count: number } | null>;
  waveform: (path: string) => Promise<{ url: string; dur: number } | null>;
  exportTimeline: (spec: unknown) => Promise<{ ok: boolean; output?: string; size?: number; error?: string; cancelled?: boolean }>;
  exportMlt: (spec: unknown) => Promise<{ ok: boolean; output?: string; size?: number; error?: string }>;
  onExportProgress: (cb: (pct: number) => void) => () => void;
  // startup / OS integration
  applyStartup: (opts: { startWithWindows: boolean; startMinimized: boolean }) => void;
  // file ops
  renameRecording: (
    oldPath: string,
    newName: string
  ) => Promise<{ ok: boolean; path?: string; error?: string }>;
  remux: (input: string, container: string) => Promise<{ ok: boolean; path?: string; size?: number; error?: string }>;
  fixReplay: (path: string, fps?: number) => Promise<{ ok: boolean; path?: string; size?: number; error?: string }>;
  generateThumb: (path: string) => Promise<string>;
  saveScreenshot: (buffer: ArrayBuffer) => Promise<{ path: string }>;
  // hotkeys
  registerHotkeys: (map: Record<HotkeyAction, string>) => void;
  onHotkey: (cb: (action: HotkeyAction) => void) => () => void;
}

declare global {
  interface Window {
    studio?: StudioAPI;
  }
}

export const studio: StudioAPI | undefined =
  typeof window !== "undefined" ? window.studio : undefined;
export const isElectron = !!studio;
