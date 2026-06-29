// Timeline model for the AHG Studio editor.
// A Project is a set of stacked tracks (video on top, audio below) holding clips.
// Time is in seconds. Each clip occupies [start, start + length) on its track.

export type ClipKind = "video" | "audio" | "image" | "text";

export type TransitionKind =
  | "none"
  | "crossfade"
  | "fadeblack"
  | "fadewhite"
  | "dissolve"
  | "slideleft"
  | "slideright"
  | "slideup"
  | "slidedown"
  | "smoothleft"
  | "smoothright"
  | "wipeleft"
  | "wiperight"
  | "wipeup"
  | "wipedown"
  | "circleopen"
  | "circleclose"
  | "radial"
  | "pixelize"
  | "blur";

export const TRANSITIONS: { kind: TransitionKind; label: string }[] = [
  { kind: "none", label: "None" },
  { kind: "crossfade", label: "Crossfade" },
  { kind: "fadeblack", label: "Fade to black" },
  { kind: "fadewhite", label: "Fade to white" },
  { kind: "dissolve", label: "Dissolve" },
  { kind: "slideleft", label: "Slide left" },
  { kind: "slideright", label: "Slide right" },
  { kind: "slideup", label: "Slide up" },
  { kind: "slidedown", label: "Slide down" },
  { kind: "smoothleft", label: "Push left" },
  { kind: "smoothright", label: "Push right" },
  { kind: "wipeleft", label: "Wipe left" },
  { kind: "wiperight", label: "Wipe right" },
  { kind: "wipeup", label: "Wipe up" },
  { kind: "wipedown", label: "Wipe down" },
  { kind: "circleopen", label: "Iris open" },
  { kind: "circleclose", label: "Iris close" },
  { kind: "radial", label: "Radial" },
  { kind: "pixelize", label: "Pixelize" },
  { kind: "blur", label: "Blur" },
];

// Maps our transition kinds to ffmpeg xfade transition names.
export const XFADE: Record<TransitionKind, string> = {
  none: "fade",
  crossfade: "fade",
  fadeblack: "fadeblack",
  fadewhite: "fadewhite",
  dissolve: "dissolve",
  slideleft: "slideleft",
  slideright: "slideright",
  slideup: "slideup",
  slidedown: "slidedown",
  smoothleft: "smoothleft",
  smoothright: "smoothright",
  wipeleft: "wipeleft",
  wiperight: "wiperight",
  wipeup: "wipeup",
  wipedown: "wipedown",
  circleopen: "circleopen",
  circleclose: "circleclose",
  radial: "radial",
  pixelize: "pixelize",
  blur: "fadegrays",
};

export type TransitionDir = "between" | "in" | "out";
export const TRANSITION_DIRS: { id: TransitionDir; label: string }[] = [
  { id: "between", label: "Between" },
  { id: "in", label: "In" },
  { id: "out", label: "Out" },
];

export type TextAnim = "none" | "fade" | "rise" | "pop" | "typewriter";
export const TEXT_ANIMS: { id: TextAnim; label: string }[] = [
  { id: "none", label: "None" },
  { id: "fade", label: "Fade in" },
  { id: "rise", label: "Rise up" },
  { id: "pop", label: "Pop" },
  { id: "typewriter", label: "Typewriter" },
];

export const FONTS = ["Inter", "JetBrains Mono", "Georgia", "Impact", "Courier New", "Arial Black"];

// Blend modes for overlay (non-base) video clips. `css` drives the live preview
// (CSS mix-blend-mode); `ff` is the matching FFmpeg `blend=all_mode` for export.
export type BlendMode =
  | "normal" | "screen" | "multiply" | "overlay" | "lighten" | "darken"
  | "difference" | "exclusion" | "color-dodge" | "color-burn" | "hard-light" | "soft-light";
export const BLEND_MODES: { id: BlendMode; label: string; css: string; ff: string }[] = [
  { id: "normal", label: "Normal", css: "normal", ff: "normal" },
  { id: "screen", label: "Screen", css: "screen", ff: "screen" },
  { id: "multiply", label: "Multiply", css: "multiply", ff: "multiply" },
  { id: "overlay", label: "Overlay", css: "overlay", ff: "overlay" },
  { id: "lighten", label: "Lighten", css: "lighten", ff: "lighten" },
  { id: "darken", label: "Darken", css: "darken", ff: "darken" },
  { id: "difference", label: "Difference", css: "difference", ff: "difference" },
  { id: "exclusion", label: "Exclusion", css: "exclusion", ff: "exclusion" },
  { id: "color-dodge", label: "Color dodge", css: "color-dodge", ff: "dodge" },
  { id: "color-burn", label: "Color burn", css: "color-burn", ff: "burn" },
  { id: "hard-light", label: "Hard light", css: "hard-light", ff: "hardlight" },
  { id: "soft-light", label: "Soft light", css: "soft-light", ff: "softlight" },
];
export const blendCss = (m?: BlendMode) => BLEND_MODES.find((b) => b.id === m)?.css || "normal";
export const blendFf = (m?: BlendMode) => BLEND_MODES.find((b) => b.id === m)?.ff || "normal";

export interface Clip {
  id: string;
  kind: ClipKind;
  trackId: string;
  start: number; // position on the timeline (s)
  in: number; // source in-point (s) — 0 for text/image
  out: number; // source out-point (s)
  speed: number; // 1 = normal (video/audio)
  name: string;
  path?: string;
  srcDuration?: number; // full source duration (s)
  volume?: number; // 0..2 (video/audio)
  opacity?: number; // 0..1 (visual)
  fadeIn?: number; // seconds
  fadeOut?: number; // seconds
  brightness?: number; // -1..1 (0 = none)
  contrast?: number; // 0..2 (1 = none)
  saturate?: number; // 0..2 (1 = none)
  hue?: number; // -180..180 degrees (0 = none)
  blur?: number; // 0..1 → preview blur px / export sigma (video effect)
  vignette?: number; // 0..1 edge darkening (preview via compositor canvas, export via FFmpeg vignette)
  sharpen?: number; // 0..1 unsharp amount (export via FFmpeg unsharp; preview approx via contrast)
  levels?: { black?: number; white?: number; gamma?: number }; // tonal levels (export via FFmpeg)
  zoom?: number; // 1..3 source scale (crop-in / punch-in)
  flipH?: boolean; // mirror horizontally
  flipV?: boolean; // flip vertically
  rotate?: number; // degrees (preview transform / export rotate)
  denoise?: boolean; // audio noise suppression (export-side)
  audioNormalize?: boolean; // EBU R128 loudness normalize (export-side)
  gainDb?: number; // extra gain trim in dB (0 = none); preview-approximated, export-exact
  eqLow?: number; // 3-band EQ gain in dB @100Hz (0 = none, export-side)
  eqMid?: number; // 3-band EQ gain in dB @1kHz (0 = none, export-side)
  eqHigh?: number; // 3-band EQ gain in dB @8kHz (0 = none, export-side)
  compress?: boolean; // dynamics compressor (export-side)
  pan?: number; // stereo balance -1 (L) .. +1 (R) (0 = center)
  blend?: BlendMode; // overlay-clip blend mode (preview via mix-blend-mode, export via FFmpeg blend)
  // PiP transform for overlay video clips — normalized box (top-left + size)
  // relative to the canvas (0..1). Undefined = full frame for the base track,
  // or the default corner PiP for overlay tracks. Lets you resize a webcam etc.
  frame?: { x: number; y: number; w: number; h: number };
  // Position keyframes for animated motion (overlay/PiP clips). Each keyframe is a
  // clip-relative time `t` (seconds from the clip's start, before speed) and a
  // normalized top-left {x,y}. The box SIZE stays `frame.w/h`; only position is
  // animated (linearly interpolated). This exports cleanly via FFmpeg `overlay`
  // x/y time-expressions. ≥2 keyframes = motion; <2 falls back to the static frame.
  kf?: { t: number; x: number; y: number }[];
  reverse?: boolean;
  // Linked A/V: a video clip and its detached audio clip share a linkId so they
  // move / trim / delete together. The VIDEO clip remains the audio source; the
  // linked audio clip is the waveform/volume proxy (its audio is skipped on
  // export to avoid doubling). Timing + volume/fades mirror between the pair.
  linkId?: string;
  // transition: "between" blends with the PREVIOUS clip on the same track;
  // "in" animates the clip on at its start; "out" animates it off at its end.
  transition?: { kind: TransitionKind; duration: number; dir?: TransitionDir };
  // text properties
  text?: string;
  color?: string;
  bg?: string; // background box color or "" for none
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  weight?: number; // 100..900 font weight (thickness)
  gradient?: string; // second color → gradient fill (preview); "" = solid
  stroke?: number; // text outline thickness (px at 1080h)
  strokeColor?: string;
  letterSpacing?: number; // px
  align?: "left" | "center" | "right";
  anim?: TextAnim;
  posX?: number; // 0..1 normalized center
  posY?: number; // 0..1 normalized center
}

// Default PiP frame for an overlay clip with no explicit frame (bottom-right).
export const DEFAULT_PIP: { x: number; y: number; w: number; h: number } = { x: 0.7, y: 0.7, w: 0.26, h: 0.26 };

// Effective normalized frame for a video clip. EVERY video defaults to full
// frame regardless of which track it sits on — a clip on track 2+ should fill the
// screen, not shrink to a corner. PiP is opt-in: it only happens once the user
// actually resizes the clip in the preview (which sets c.frame).
export function clipFrame(c: Clip, _isOverlay = false): { x: number; y: number; w: number; h: number } {
  return c.frame ?? { x: 0, y: 0, w: 1, h: 1 };
}

// True once a clip has enough keyframes to animate (≥2).
export function hasMotion(c: Clip): boolean {
  return !!c.kf && c.kf.length >= 2;
}

// Interpolated top-left position at clip-relative time `relT` (seconds). Linear
// between keyframes; clamped to the first/last outside the range. Returns null
// when the clip isn't animated, so callers fall back to the static frame.
export function clipPosAt(c: Clip, relT: number): { x: number; y: number } | null {
  // `kf` is maintained sorted ascending by `t` by upsertKeyframe, so we can
  // iterate it directly here — this runs ~60x/sec per animated clip in the
  // preview compositor, so cloning + re-sorting on every call is wasteful.
  const ks = c.kf;
  if (!ks || ks.length === 0) return null;
  if (relT <= ks[0].t) return { x: ks[0].x, y: ks[0].y };
  const last = ks[ks.length - 1];
  if (relT >= last.t) return { x: last.x, y: last.y };
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    if (relT >= a.t && relT <= b.t) {
      const f = b.t === a.t ? 0 : (relT - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return { x: last.x, y: last.y };
}

// The effective frame box at clip-relative time `relT` — same size as `frame`,
// position overridden by the interpolated keyframe track when animated.
export function clipFrameAt(c: Clip, isOverlay: boolean, relT: number): { x: number; y: number; w: number; h: number } {
  const base = clipFrame(c, isOverlay);
  const pos = clipPosAt(c, relT);
  return pos ? { x: pos.x, y: pos.y, w: base.w, h: base.h } : base;
}

// Insert or replace a keyframe at clip-relative time `t` (within ~1 frame), kept sorted.
export function upsertKeyframe(kf: { t: number; x: number; y: number }[] | undefined, t: number, x: number, y: number): { t: number; x: number; y: number }[] {
  const next = (kf ? kf.filter((k) => Math.abs(k.t - t) > 0.03) : []).concat({ t, x, y });
  return next.sort((a, b) => a.t - b.t);
}

export interface Track {
  id: string;
  kind: "video" | "audio" | "text";
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  height?: number; // custom row height in px (falls back to the global default)
}

export interface Project {
  tracks: Track[]; // index 0 = topmost
  clips: Clip[];
  fps: number;
  width: number;
  height: number;
  bg?: string; // letterbox / canvas background color
}

export const ASPECTS: { id: string; label: string; w: number; h: number }[] = [
  { id: "16:9", label: "16:9 Landscape", w: 1920, h: 1080 },
  { id: "9:16", label: "9:16 Vertical", w: 1080, h: 1920 },
  { id: "1:1", label: "1:1 Square", w: 1080, h: 1080 },
  { id: "4:5", label: "4:5 Portrait", w: 1080, h: 1350 },
  { id: "4:3", label: "4:3 Classic", w: 1440, h: 1080 },
];

// CSS filter string for previewing a clip's color adjustments.
export function clipFilterCss(c: Clip): string {
  const parts: string[] = [];
  if (c.brightness && c.brightness !== 0) parts.push(`brightness(${(1 + c.brightness).toFixed(3)})`);
  if (c.contrast != null && c.contrast !== 1) parts.push(`contrast(${c.contrast.toFixed(3)})`);
  if (c.saturate != null && c.saturate !== 1) parts.push(`saturate(${c.saturate.toFixed(3)})`);
  if (c.hue) parts.push(`hue-rotate(${c.hue.toFixed(1)}deg)`);
  if (c.blur && c.blur > 0) parts.push(`blur(${(c.blur * 20).toFixed(1)}px)`);
  return parts.join(" ");
}

let _id = 0;
export const newId = (p = "c") => `${p}_${Date.now().toString(36)}_${_id++}`;

// Length a clip occupies on the timeline. Always finite & non-negative.
export function clipLen(c: Clip): number {
  const raw = Math.max(0, (c.out || 0) - (c.in || 0));
  const len = c.kind === "video" || c.kind === "audio" ? raw / (c.speed || 1) : raw;
  return isFinite(len) ? len : 0;
}
export const clipEnd = (c: Clip) => {
  const e = (c.start || 0) + clipLen(c);
  return isFinite(e) ? e : 0;
};

export function projectDuration(p: Project): number {
  const d = p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  return isFinite(d) ? d : 0;
}

export function clipsOf(p: Project, trackId: string): Clip[] {
  return p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

export function emptyProject(): Project {
  // Two video + two audio tracks by default. Array order is top→bottom, so the
  // bottom video track ("Video 1") is the full-frame base and "Video 2" sits on
  // top as an overlay; both audio tracks play + mix in parallel.
  return {
    tracks: [
      { id: "v2", kind: "video", name: "Video 2", muted: false, hidden: false, locked: false },
      { id: "v1", kind: "video", name: "Video 1", muted: false, hidden: false, locked: false },
      { id: "a1", kind: "audio", name: "Audio 1", muted: false, hidden: false, locked: false },
      { id: "a2", kind: "audio", name: "Audio 2", muted: false, hidden: false, locked: false },
    ],
    clips: [],
    fps: 30,
    width: 1920,
    height: 1080,
    bg: "#000000",
  };
}

// Snap a time to nearby clip edges / playhead within `tol` seconds.
export function snapTime(t: number, candidates: number[], tol: number): number {
  let best = t;
  let bestD = tol;
  for (const c of candidates) {
    const d = Math.abs(c - t);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

// All meaningful snap candidates: 0, the playhead, every other clip's edges, and
// any markers — so dragging/trimming clicks into alignment like a pro NLE.
export function snapCandidates(p: Project, playhead: number, ignoreId?: string, markers?: number[]): number[] {
  const out = [0, playhead];
  for (const c of p.clips) {
    if (c.id === ignoreId) continue;
    out.push(c.start, clipEnd(c));
  }
  if (markers) for (const m of markers) out.push(m);
  return out;
}

// The clip active at time t on a given track (for preview). When same-track clips
// overlap, this picks the latest-start (topmost) clip — matching clipAtFast — so
// selection hit-testing and the compositor never reference different clips.
export function clipAt(p: Project, trackId: string, t: number): Clip | null {
  let best: Clip | null = null;
  for (const c of clipsOf(p, trackId)) {
    if (t >= c.start && t < clipEnd(c) && (!best || c.start > best.start)) best = c;
  }
  return best;
}

// Non-allocating active-clip lookup for the 60fps preview/playback hot path.
// clipAt() goes through clipsOf() which filter()+sort()s a fresh array on EVERY
// call — done per track, every frame, that array churn caused GC pauses (the
// "preview is smooth then hitches after a few seconds" bug). This scans in place.
export function clipAtFast(clips: Clip[], trackId: string, t: number): Clip | null {
  let best: Clip | null = null;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (c.trackId !== trackId) continue;
    if (t >= c.start && t < clipEnd(c) && (!best || c.start > best.start)) best = c;
  }
  return best;
}

// Map a timeline time to a clip's source time.
export function sourceTimeAt(c: Clip, t: number): number {
  const local = (t - c.start) * (c.speed || 1);
  return c.in + Math.max(0, Math.min(c.out - c.in, local));
}

// Source time honoring reverse playback (mirrors within [in, out]).
export function sourceTimeFor(c: Clip, t: number): number {
  const s = sourceTimeAt(c, t);
  return c.reverse ? c.in + c.out - s : s;
}

// Split a clip (and any clips LINKED to it) at timeline time `t`, returning a new
// clips array. Each side of the cut is re-paired with its OWN fresh linkId, so the
// two halves move / trim / delete independently while each half keeps its own A/V
// pair linked. This is the fix for "split is visual only": previously both halves
// kept the original linkId, so every op treated all halves + audio as one group.
export function splitClips(p: Project, targetId: string, t: number): Clip[] {
  const target = p.clips.find((c) => c.id === targetId);
  if (!target) return p.clips;
  const link = target.linkId;
  const splittable = (c: Clip) => t > c.start + 0.04 && t < clipEnd(c) - 0.04;
  if (!splittable(target)) return p.clips;
  // The group is the target plus its linked siblings (if any).
  const inGroup = (c: Clip) => c.id === targetId || (!!link && c.linkId === link);
  const leftLink = link ? newId("lk") : undefined;
  const rightLink = link ? newId("lk") : undefined;
  const out: Clip[] = [];
  for (const c of p.clips) {
    if (!inGroup(c)) {
      out.push(c);
      continue;
    }
    if (!splittable(c)) {
      // A linked sibling that the cut misses: keep whole, assign to the side it sits on.
      out.push(link ? { ...c, linkId: clipEnd(c) <= t ? leftLink : rightLink } : c);
      continue;
    }
    const isMedia = c.kind === "video" || c.kind === "audio";
    const srcAtCut = sourceTimeAt(c, t);
    out.push({ ...c, linkId: leftLink ?? c.linkId, out: isMedia ? srcAtCut : t - c.start, fadeOut: 0 });
    out.push({
      ...c,
      id: newId(),
      linkId: rightLink ?? c.linkId,
      start: t,
      in: isMedia ? srcAtCut : 0,
      out: isMedia ? c.out : clipEnd(c) - t,
      transition: { kind: "none", duration: 0.5 },
      fadeIn: 0,
    });
  }
  return out;
}

// Preview opacity multiplier from fade-in / fade-out and "in"/"out" transitions.
export function fadeMul(c: Clip, ph: number): number {
  const t = ph - (c.start || 0);
  const len = clipLen(c);
  let m = 1;
  const fi = c.fadeIn ?? 0;
  const fo = c.fadeOut ?? 0;
  if (fi > 0) m = Math.min(m, t / fi);
  if (fo > 0) m = Math.min(m, (len - t) / fo);
  const tr = c.transition;
  if (tr && tr.kind !== "none" && tr.dir && tr.dir !== "between") {
    // An in/out transition previews as a fade, but FLOORED at 0.2 so it never blacks
    // out the whole preview when the lone/base layer is in the fade region (that read
    // as "the screen went black forever"). Export still does a true fade. Explicit
    // fadeIn/fadeOut sliders above are intentional and still go fully to 0.
    const d = Math.max(0.05, tr.duration || 0.5);
    const prog = tr.dir === "in" ? t / d : (len - t) / d;
    m = Math.min(m, 0.2 + 0.8 * Math.min(1, Math.max(0, prog)));
  }
  return m < 0 ? 0 : m > 1 ? 1 : m;
}

export function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${m}:${sec.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

// Serializable spec sent to the main process for export.
export interface ExportSpec {
  tracks: Track[];
  clips: Clip[];
  fps: number;
  width: number;
  height: number;
  duration: number;
  format: string;
  codec: string;
  quality: number;
  resolution: string;
  audioKbps: number;
  outputName: string;
}
