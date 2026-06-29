import { useCallback, useEffect, useRef, useState } from "react";
import { isElectron, studio, type FileRef, type HotkeyAction } from "../lib/bridge";
import { notify, playChime, playShutter, playStart, playStop } from "../lib/notify";
import { runOptimize } from "../store/optimize";
import { getSettings, setSettings, THEMES, useProfiles, useSettings, type SavedSource } from "../store/settings";

export const CW = 1920;
export const CH = 1080;

export type SourceType = "display" | "window" | "camera" | "image" | "video" | "text";

export interface Source {
  id: string;
  type: SourceType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  crop: { l: number; t: number; r: number; b: number };
  z: number;
  visible: boolean;
  locked: boolean;
  natW: number;
  natH: number;
  // runtime (not for serialization)
  el?: HTMLVideoElement | HTMLImageElement;
  stream?: MediaStream;
  // text source
  text?: string;
  color?: string;
  fontSize?: number;
  // origin (for persistence/restore)
  origin?: { sourceId?: string; deviceId?: string; path?: string };
}

export interface AddSpec {
  type: SourceType;
  name: string;
  sourceId?: string; // display/window
  deviceId?: string; // camera
  path?: string; // image/video
  text?: string;
  color?: string;
  fontSize?: number;
}

export interface CaptureStats {
  fps: number;
  bitrate: number;
  cpu: number;
  memMb: number;
  width: number;
  height: number;
}

let _uid = 0;
const uid = () => `src_${Date.now().toString(36)}_${_uid++}`;

function mimeForFormat(fmt: "mp4" | "webm" | "mkv") {
  const base = fmt === "webm" ? "webm" : "mp4";
  const cands =
    base === "mp4"
      ? ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,opus", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"]
      : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return cands.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}
const extOf = (mime: string) => (mime.includes("mp4") ? "mp4" : "webm");
const fileUrl = (p: string) => "file:///" + p.replace(/\\/g, "/");

// Fit a w×h box inside the canvas, centered (cover=false → contain).
function fitBox(nw: number, nh: number, scale = 1) {
  const ar = nw / nh || 16 / 9;
  let w = CW * scale;
  let h = w / ar;
  if (h > CH * scale) {
    h = CH * scale;
    w = h * ar;
  }
  return { x: (CW - w) / 2, y: (CH - h) / 2, w, h };
}

export function useCapture({ recordActive = false }: { recordActive?: boolean } = {}) {
  const settings = useSettings();
  const { active: activeProfile } = useProfiles();
  const hydratedRef = useRef(false);
  const restoreTokenRef = useRef(0);

  const [sources, setSources] = useState<Source[]>([]);
  const sourcesRef = useRef<Source[]>([]);
  const sortedRef = useRef<Source[]>([]); // sources sorted by z, recomputed only on change
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // Audio levels live in a ref (not React state) so the 60fps meter loop never
  // re-renders the Record page — the meter bars read this ref in their own rAF.
  const levelsRef = useRef({ desktop: 0, mic: 0 });
  const [stats, setStats] = useState<CaptureStats>({ fps: 0, bitrate: 0, cpu: 0, memMb: 0, width: CW, height: CH });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replayActive, setReplayActive] = useState(false);
  const [audioVersion, setAudioVersion] = useState(0); // bumps when the mix is (re)built

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderRaf = useRef(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopResolveRef = useRef<null | (() => void)>(null);
  const recMimeRef = useRef("video/webm");
  const lastRef = useRef<FileRef | null>(null);
  const elapsedRef = useRef(0);
  const recordingRef = useRef(false);

  // audio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioRawRef = useRef<MediaStreamTrack[]>([]);
  const mixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const analysersRef = useRef<{ desktop?: AnalyserNode; mic?: AnalyserNode }>({});
  // The actual graph nodes from the LAST build — kept so we can .disconnect() them
  // before rebuilding, otherwise they pile up in the reused AudioContext.
  const audioNodesRef = useRef<{ sources: AudioNode[]; analysers: AudioNode[]; dest: MediaStreamAudioDestinationNode | null }>({ sources: [], analysers: [], dest: null });
  // Mic input gain — kept so the volume slider can adjust the level live without
  // rebuilding the whole audio graph (which would re-acquire getUserMedia).
  const micGainRef = useRef<GainNode | null>(null);
  const desktopGainRef = useRef<GainNode | null>(null);
  const meterRaf = useRef(0);
  const smoothRef = useRef({ desktop: 0, mic: 0 });
  const primaryScreenRef = useRef<string | null>(null);

  // replay
  const replayRecRef = useRef<MediaRecorder | null>(null);
  const replayBufRef = useRef<{ t: number; b: Blob }[]>([]);
  const replayHeaderRef = useRef<Blob | null>(null);

  // undo / redo history of source layouts
  const undoRef = useRef<Source[][]>([]);
  const redoRef = useRef<Source[][]>([]);
  const snapshot = useCallback(() => {
    undoRef.current.push(sourcesRef.current.map((s) => ({ ...s, crop: { ...s.crop } })));
    if (undoRef.current.length > 60) undoRef.current.shift();
    redoRef.current = [];
  }, []);
  function undo() {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(sourcesRef.current.map((s) => ({ ...s, crop: { ...s.crop } })));
    setSources(prev);
  }
  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(sourcesRef.current.map((s) => ({ ...s, crop: { ...s.crop } })));
    setSources(next);
  }

  useEffect(() => {
    sourcesRef.current = sources;
    sortedRef.current = [...sources].sort((a, b) => a.z - b.z);
  }, [sources]);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  // Stable handlers for canvas GPU context loss. Without preventDefault on
  // "contextlost" the browser won't restore it; on restore we re-init the
  // backing store so the composite loop repaints instead of staying blank.
  const ctxHandlers = useRef({
    lost: (e: Event) => {
      e.preventDefault();
      console.warn("[capture] canvas context lost");
    },
    restored: () => {
      const c = canvasRef.current;
      if (c) {
        c.width = CW;
        c.height = CH;
      }
      console.warn("[capture] canvas context restored");
    },
  });

  const attachCanvas = useCallback((el: HTMLCanvasElement | null) => {
    const prev = canvasRef.current;
    if (prev && prev !== el) {
      prev.removeEventListener("contextlost", ctxHandlers.current.lost as EventListener);
      prev.removeEventListener("contextrestored", ctxHandlers.current.restored as EventListener);
    }
    canvasRef.current = el;
    if (el) {
      el.width = CW;
      el.height = CH;
      el.addEventListener("contextlost", ctxHandlers.current.lost as EventListener);
      el.addEventListener("contextrestored", ctxHandlers.current.restored as EventListener);
    }
  }, []);

  /* ---------------- render loop ----------------
     Compositing only runs when it can actually be seen or captured — the Record
     preview is visible, or we're recording / buffering a replay. On Edit/Library
     this loop is fully stopped, so the app isn't decoding + drawing live screen
     frames 60fps in the background (the main cause of sustained lag). */
  const renderOn = recordActive || recording || replayActive;
  useEffect(() => {
    if (!renderOn) {
      cancelAnimationFrame(renderRaf.current);
      // paint one idle frame so a stale image isn't left if we return later
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, CW, CH);
        ctx.fillStyle = "#0a0a0e";
        ctx.fillRect(0, 0, CW, CH);
      }
      return;
    }
    // Composite at a SMOOTH rate (≥60fps) so the live preview and the resize/move
    // of sources feel responsive — a 30fps preview felt laggy. We still never draw
    // below the recording fps (so high-fps captures aren't starved). The recording
    // itself is sampled by canvas.captureStream(fps), so a faster preview draw
    // doesn't change the output frame rate. On a 60Hz panel this is every frame;
    // on 144Hz it thins to ~60fps to avoid wasting GPU on full-res redraws.
    let lastDraw = 0;
    // Honest FPS: count frames actually composited in a rolling 1-second window
    // (OBS-style) and publish the measured rate once a second. Under GPU load this
    // reads BELOW the target, which is the truth the Performance panel should show.
    let frames = 0;
    let windowStart = 0;
    const draw = (now: number) => {
      renderRaf.current = requestAnimationFrame(draw);
      const target = Math.max(60, getSettings().fps || 60);
      const interval = 1000 / target;
      if (now - lastDraw < interval - 1) return;
      lastDraw = now;
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, CW, CH);
        ctx.fillStyle = "#0a0a0e";
        ctx.fillRect(0, 0, CW, CH);
        const ordered = sortedRef.current;
        for (let i = 0; i < ordered.length; i++) {
          const s = ordered[i];
          if (!s.visible) continue;
          drawSource(ctx, s);
        }
      }
      if (!windowStart) windowStart = now;
      frames++;
      const span = now - windowStart;
      if (span >= 1000) {
        const fps = Math.round((frames * 1000) / span);
        setStats((p) => (p.fps === fps ? p : { ...p, fps }));
        frames = 0;
        windowStart = now;
      }
    };
    renderRaf.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(renderRaf.current);
      // Reset so a stale measured FPS isn't shown when compositing resumes.
      setStats((p) => (p.fps === 0 ? p : { ...p, fps: 0 }));
    };
  }, [renderOn]);

  // When compositing is off, mute live source video tracks / pause file sources
  // so the OS isn't delivering and decoding frames we're not showing.
  useEffect(() => {
    for (const s of sourcesRef.current) {
      s.stream?.getVideoTracks().forEach((t) => {
        t.enabled = renderOn;
      });
      if (s.type === "video" && s.el) {
        const v = s.el as HTMLVideoElement;
        if (renderOn) v.play?.().catch(() => {});
        else v.pause?.();
      }
    }
  }, [renderOn, sources]);

  function drawSource(ctx: CanvasRenderingContext2D, s: Source) {
    if (s.type === "text") {
      ctx.save();
      ctx.fillStyle = s.color || "#ffffff";
      ctx.font = `700 ${s.fontSize || 80}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = "top";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 8;
      ctx.fillText(s.text || "", s.x, s.y);
      ctx.restore();
      return;
    }
    const el = s.el;
    if (!el) return;
    const nw = (el as HTMLVideoElement).videoWidth || (el as HTMLImageElement).naturalWidth || s.natW;
    const nh = (el as HTMLVideoElement).videoHeight || (el as HTMLImageElement).naturalHeight || s.natH;
    if (!nw || !nh) return;
    const sx = nw * s.crop.l;
    const sy = nh * s.crop.t;
    const sw = nw * (1 - s.crop.l - s.crop.r);
    const sh = nh * (1 - s.crop.t - s.crop.b);
    if (sw <= 0 || sh <= 0) return;
    try {
      ctx.drawImage(el, sx, sy, sw, sh, s.x, s.y, s.w, s.h);
    } catch {
      /* not ready */
    }
  }

  /* ---------------- sources ---------------- */
  const refreshScreenSources = useCallback(async () => {
    if (!studio) return [];
    const list = await studio.listSources();
    const scr = list.find((s) => s.type === "screen");
    if (scr) primaryScreenRef.current = scr.id;
    return list;
  }, []);

  useEffect(() => {
    refreshScreenSources();
    return () => {
      cancelAnimationFrame(renderRaf.current);
      cancelAnimationFrame(meterRaf.current);
      sourcesRef.current.forEach((s) => {
        s.stream?.getTracks().forEach((t) => t.stop());
        // Release the <video>/<img> element too so its decoder/GPU buffers free.
        const el = s.el as HTMLVideoElement | undefined;
        if (el) {
          if (el.srcObject) {
            el.srcObject = null;
          } else if (s.type === "video") {
            el.removeAttribute("src");
            el.load();
          }
        }
      });
      audioRawRef.current.forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- persistence (per profile) ---------------- */
  function serializeSources(): SavedSource[] {
    return sourcesRef.current.map((s) => ({
      id: s.id, type: s.type, name: s.name, x: s.x, y: s.y, w: s.w, h: s.h,
      crop: { ...s.crop }, z: s.z, visible: s.visible, locked: s.locked,
      sourceId: s.origin?.sourceId, deviceId: s.origin?.deviceId, path: s.origin?.path,
      text: s.text, color: s.color, fontSize: s.fontSize,
    }));
  }

  async function restoreLayout(saved: SavedSource[]) {
    // Single-flight: a fast profile switch could run two restores at once, and the
    // loser's freshly-acquired getUserMedia streams would leak. Tag this run and
    // discard its streams if a newer restore superseded it.
    const token = ++restoreTokenRef.current;
    sourcesRef.current.forEach((s) => s.stream?.getTracks().forEach((t) => t.stop()));
    setSources([]);
    if (!saved || !saved.length) {
      hydratedRef.current = true;
      return;
    }
    const needScreens = saved.some((s) => s.type === "display" || s.type === "window");
    const screenList = needScreens && studio ? await studio.listSources() : [];
    const built: Source[] = [];
    for (const sv of saved) {
      try {
        const base = { id: sv.id, name: sv.name, x: sv.x, y: sv.y, w: sv.w, h: sv.h, crop: { ...sv.crop }, z: sv.z, visible: sv.visible, locked: sv.locked };
        if (sv.type === "display" || sv.type === "window") {
          let sid = sv.sourceId;
          if (!screenList.find((x) => x.id === sid)) {
            const byName = screenList.find((x) => x.name === sv.name && (sv.type === "display" ? x.type === "screen" : x.type === "window"));
            sid = byName?.id || (sv.type === "display" ? screenList.find((x) => x.type === "screen")?.id : undefined);
          }
          if (!sid) continue;
          const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sid, maxFrameRate: getSettings().fps } } as unknown as MediaTrackConstraints });
          const el = document.createElement("video");
          el.srcObject = stream;
          el.muted = true;
          el.playsInline = true;
          await el.play().catch(() => {});
          await waitMeta(el);
          built.push({ ...base, type: sv.type, el, stream, natW: el.videoWidth, natH: el.videoHeight, origin: { sourceId: sid } });
        } else if (sv.type === "camera") {
          const stream = await navigator.mediaDevices.getUserMedia({ video: sv.deviceId ? { deviceId: { exact: sv.deviceId } } : true });
          const el = document.createElement("video");
          el.srcObject = stream;
          el.muted = true;
          el.playsInline = true;
          await el.play().catch(() => {});
          await waitMeta(el);
          built.push({ ...base, type: "camera", el, stream, natW: el.videoWidth, natH: el.videoHeight, origin: { deviceId: sv.deviceId } });
        } else if (sv.type === "image" && sv.path) {
          const el = new Image();
          el.src = fileUrl(sv.path);
          await new Promise<void>((res, rej) => {
            el.onload = () => res();
            el.onerror = () => rej(new Error("img"));
          });
          built.push({ ...base, type: "image", el, natW: el.naturalWidth, natH: el.naturalHeight, origin: { path: sv.path } });
        } else if (sv.type === "video" && sv.path) {
          const el = document.createElement("video");
          el.src = fileUrl(sv.path);
          el.loop = true;
          el.muted = true;
          el.playsInline = true;
          await el.play().catch(() => {});
          await waitMeta(el);
          built.push({ ...base, type: "video", el, natW: el.videoWidth, natH: el.videoHeight, origin: { path: sv.path } });
        } else if (sv.type === "text") {
          built.push({ ...base, type: "text", text: sv.text, color: sv.color, fontSize: sv.fontSize, natW: sv.w, natH: sv.h });
        }
      } catch {
        /* skip sources that can't be re-acquired */
      }
    }
    // A newer restore started while we were acquiring streams → discard ours.
    if (token !== restoreTokenRef.current) {
      built.forEach((s) => s.stream?.getTracks().forEach((t) => t.stop()));
      return;
    }
    setSources(built);
    hydratedRef.current = true;
  }

  // Restore the active profile's source layout on mount and on profile switch.
  useEffect(() => {
    hydratedRef.current = false;
    restoreLayout(getSettings().sourceLayout || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile]);

  // Persist layout (debounced) once hydrated.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const id = setTimeout(() => setSettings({ sourceLayout: serializeSources() }), 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  async function addSource(spec: AddSpec): Promise<void> {
    setError(null);
    snapshot();
    const id = uid();
    const z = (sourcesRef.current.reduce((m, s) => Math.max(m, s.z), 0) || 0) + 1;
    const baseFull = { id, name: spec.name, crop: { l: 0, t: 0, r: 0, b: 0 }, z, visible: true, locked: false };
    try {
      if (spec.type === "display" || spec.type === "window") {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: spec.sourceId, maxFrameRate: getSettings().fps } } as unknown as MediaTrackConstraints,
        });
        const el = document.createElement("video");
        el.srcObject = stream;
        el.muted = true;
        el.playsInline = true;
        await el.play().catch(() => {});
        await waitMeta(el);
        const box = spec.type === "display" ? { x: 0, y: 0, w: CW, h: CH } : fitBox(el.videoWidth, el.videoHeight, 0.7);
        push({ ...baseFull, type: spec.type, el, stream, natW: el.videoWidth, natH: el.videoHeight, origin: { sourceId: spec.sourceId }, ...box });
      } else if (spec.type === "camera") {
        const stream = await navigator.mediaDevices.getUserMedia({ video: spec.deviceId ? { deviceId: { exact: spec.deviceId } } : true });
        const el = document.createElement("video");
        el.srcObject = stream;
        el.muted = true;
        el.playsInline = true;
        await el.play().catch(() => {});
        await waitMeta(el);
        push({ ...baseFull, type: "camera", el, stream, natW: el.videoWidth, natH: el.videoHeight, origin: { deviceId: spec.deviceId }, ...fitBox(el.videoWidth, el.videoHeight, 0.4) });
      } else if (spec.type === "image") {
        const el = new Image();
        el.src = fileUrl(spec.path!);
        await new Promise<void>((res, rej) => {
          el.onload = () => res();
          el.onerror = () => rej();
        });
        push({ ...baseFull, type: "image", el, natW: el.naturalWidth, natH: el.naturalHeight, origin: { path: spec.path }, ...fitBox(el.naturalWidth, el.naturalHeight, 0.6) });
      } else if (spec.type === "video") {
        const el = document.createElement("video");
        el.src = fileUrl(spec.path!);
        el.loop = true;
        el.muted = true;
        el.playsInline = true;
        await el.play().catch(() => {});
        await waitMeta(el);
        push({ ...baseFull, type: "video", el, natW: el.videoWidth, natH: el.videoHeight, origin: { path: spec.path }, ...fitBox(el.videoWidth, el.videoHeight, 0.7) });
      } else if (spec.type === "text") {
        const fontSize = spec.fontSize || 80;
        const natW = (spec.text || "").length * fontSize * 0.55 || 400;
        push({ ...baseFull, type: "text", text: spec.text || "Text", color: spec.color || "#ffffff", fontSize, natW, natH: fontSize, x: 80, y: 80, w: natW, h: fontSize });
      }
      setSelectedId(id);
    } catch {
      setError("Could not add that source.");
    }
  }

  function push(s: Source) {
    setSources((arr) => [...arr, s]);
  }
  function waitMeta(el: HTMLVideoElement) {
    return new Promise<void>((res) => {
      if (el.videoWidth) return res();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.onloadedmetadata = null;
        clearTimeout(timer);
        res();
      };
      const timer = setTimeout(finish, 1500);
      el.onloadedmetadata = finish;
    });
  }

  const removeSource = useCallback((id: string) => {
    snapshot();
    setSources((arr) => {
      const s = arr.find((x) => x.id === id);
      s?.stream?.getTracks().forEach((t) => t.stop());
      // Release the <video>/<img> element so its decoder/GPU buffers are freed:
      // stream sources clear srcObject; file/video sources drop src and reload.
      if (s?.el) {
        const el = s.el as HTMLVideoElement;
        if (el.srcObject) {
          el.srcObject = null;
        } else if (s.type === "video") {
          el.removeAttribute("src");
          el.load();
        }
      }
      return arr.filter((x) => x.id !== id);
    });
    if (selectedRef.current === id) setSelectedId(null);
  }, [snapshot]);
  function renameSource(id: string, name: string) {
    snapshot();
    setSources((arr) => arr.map((s) => (s.id === id ? { ...s, name } : s)));
  }
  function setVisible(id: string, v: boolean) {
    snapshot();
    setSources((arr) => arr.map((s) => (s.id === id ? { ...s, visible: v } : s)));
  }
  function setLocked(id: string, v: boolean) {
    snapshot();
    setSources((arr) => arr.map((s) => (s.id === id ? { ...s, locked: v } : s)));
  }
  function updateTransform(id: string, patch: Partial<Source>) {
    setSources((arr) => arr.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  // Live drag transform — mutate the refs the composite loop reads so the next
  // canvas frame reflects the new geometry INSTANTLY, with no React re-render.
  // The caller updates the selection box DOM directly too, then commits the
  // final value via updateTransform() on pointer-up.
  function liveTransform(id: string, patch: Partial<Source>) {
    const s = sourcesRef.current.find((x) => x.id === id);
    if (s) Object.assign(s, patch); // sortedRef holds the same object refs
  }
  // reorder: dir +1 = bring forward, -1 = send back
  function reorder(id: string, dir: number) {
    snapshot();
    setSources((arr) => {
      const sorted = [...arr].sort((a, b) => a.z - b.z);
      const i = sorted.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= sorted.length) return arr;
      const zi = sorted[i].z;
      sorted[i].z = sorted[j].z;
      sorted[j].z = zi;
      return [...sorted];
    });
  }
  // reorderList: assign z from an explicit front-first ordering (first = top layer)
  function reorderList(idsFrontFirst: string[]) {
    snapshot();
    setSources((arr) => {
      const n = idsFrontFirst.length;
      return arr.map((s) => {
        const idx = idsFrontFirst.indexOf(s.id);
        return idx === -1 ? s : { ...s, z: n - idx };
      });
    });
  }
  // move a source to the very front or very back of the stack
  function moveToEdge(id: string, edge: "front" | "back") {
    snapshot();
    setSources((arr) => {
      if (!arr.length) return arr;
      const zs = arr.map((s) => s.z);
      const target = edge === "front" ? Math.max(...zs) + 1 : Math.min(...zs) - 1;
      return arr.map((s) => (s.id === id ? { ...s, z: target } : s));
    });
  }
  // duplicate a non-stream source (text/image keep their element; streams can't be cloned)
  function duplicateSource(id: string) {
    const s = sourcesRef.current.find((x) => x.id === id);
    if (!s) return;
    snapshot();
    const nid = uid();
    const z = (sourcesRef.current.reduce((m, x) => Math.max(m, x.z), 0) || 0) + 1;
    const copy: Source = { ...s, id: nid, z, x: s.x + 24, y: s.y + 24, name: `${s.name} copy`, crop: { ...s.crop } };
    setSources((arr) => [...arr, copy]);
    setSelectedId(nid);
  }
  const select = useCallback((id: string | null) => setSelectedId(id), []);
  // Stable accessor for the live audio mix — consumers (the monitor effect on the
  // Record page) depend on it, so its identity must not change every render.
  const getMonitorStream = useCallback(() => mixDestRef.current?.stream ?? null, []);

  /* ---------------- audio ---------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // stop previous
      audioRawRef.current.forEach((t) => t.stop());
      audioRawRef.current = [];
      analysersRef.current = {};
      // Disconnect the previous build's graph nodes before creating new ones —
      // dereferencing alone leaves them connected and accumulating in the reused
      // AudioContext on every mic/system toggle.
      const prevNodes = audioNodesRef.current;
      prevNodes.sources.forEach((n) => {
        try { n.disconnect(); } catch { /* noop */ }
      });
      prevNodes.analysers.forEach((n) => {
        try { n.disconnect(); } catch { /* noop */ }
      });
      try { prevNodes.dest?.disconnect(); } catch { /* noop */ }
      audioNodesRef.current = { sources: [], analysers: [], dest: null };
      micGainRef.current = null;
      desktopGainRef.current = null;
      const s = getSettings();
      if (!s.systemAudio && !s.micEnabled) {
        mixDestRef.current = null;
        setAudioVersion((v) => v + 1);
        return;
      }
      const ctx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const dest = ctx.createMediaStreamDestination();
      const newNodes: { sources: AudioNode[]; analysers: AudioNode[]; dest: MediaStreamAudioDestinationNode | null } = { sources: [], analysers: [], dest };
      const analysers: { desktop?: AnalyserNode; mic?: AnalyserNode } = {};
      const tap = (track: MediaStreamTrack, key: "desktop" | "mic", gainValue?: number) => {
        audioRawRef.current.push(track);
        const src = ctx.createMediaStreamSource(new MediaStream([track]));
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        if (gainValue !== undefined) {
          // Insert a gain node on this path; it feeds BOTH the meters (analyser)
          // and the recording/monitor mix (dest), so the slider scales what you
          // see and what's recorded. Held in micGainRef for live adjustment.
          const g = ctx.createGain();
          g.gain.value = gainValue;
          src.connect(g);
          g.connect(an);
          g.connect(dest);
          newNodes.sources.push(g);
          if (key === "mic") micGainRef.current = g;
          else desktopGainRef.current = g;
        } else {
          src.connect(an);
          src.connect(dest);
        }
        newNodes.sources.push(src);
        newNodes.analysers.push(an);
        analysers[key] = an;
      };
      if (s.systemAudio && isElectron) {
        try {
          if (!primaryScreenRef.current) await refreshScreenSources();
          const sys = await navigator.mediaDevices.getUserMedia({
            audio: { mandatory: { chromeMediaSource: "desktop" } } as unknown as MediaTrackConstraints,
            video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: primaryScreenRef.current, maxWidth: 4, maxHeight: 4, maxFrameRate: 1 } } as unknown as MediaTrackConstraints,
          });
          sys.getVideoTracks().forEach((t) => t.stop());
          const at = sys.getAudioTracks()[0];
          if (at) tap(at, "desktop", s.desktopVolume ?? 1);
        } catch {
          /* loopback unavailable */
        }
      }
      if (s.micEnabled) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: s.micDeviceId ? { deviceId: { exact: s.micDeviceId } } : true });
          const at = mic.getAudioTracks()[0];
          if (at) tap(at, "mic", s.micVolume ?? 1);
        } catch {
          /* mic optional */
        }
      }
      if (cancelled) {
        audioRawRef.current.forEach((t) => t.stop());
        // We won't commit this build — tear down the nodes we just created.
        newNodes.sources.forEach((n) => {
          try { n.disconnect(); } catch { /* noop */ }
        });
        newNodes.analysers.forEach((n) => {
          try { n.disconnect(); } catch { /* noop */ }
        });
        try { dest.disconnect(); } catch { /* noop */ }
        return;
      }
      mixDestRef.current = dest;
      analysersRef.current = analysers;
      audioNodesRef.current = newNodes;
      setAudioVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.systemAudio, settings.micEnabled, settings.micDeviceId, refreshScreenSources]);

  // Apply the mic input volume live (don't rebuild the graph — that would
  // re-acquire getUserMedia on every slider tick).
  useEffect(() => {
    const g = micGainRef.current;
    if (g) g.gain.value = settings.micVolume ?? 1;
  }, [settings.micVolume, audioVersion]);
  // Same for captured system/desktop audio.
  useEffect(() => {
    const g = desktopGainRef.current;
    if (g) g.gain.value = settings.desktopVolume ?? 1;
  }, [settings.desktopVolume, audioVersion]);

  // meters — only while the Record page is visible or we're recording (the bars
  // aren't shown elsewhere), and with a single reused buffer (no per-frame alloc).
  const meterOn = (recordActive || recording) && !settings.reducedMotion;
  useEffect(() => {
    if (!meterOn) {
      levelsRef.current.desktop = 0;
      levelsRef.current.mic = 0;
      return;
    }
    const meterBuf = new Uint8Array(2048);
    const read = (an?: AnalyserNode) => {
      if (!an) return 0;
      const n = Math.min(an.fftSize, meterBuf.length);
      const view = meterBuf.subarray(0, n);
      an.getByteTimeDomainData(view);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const x = (view[i] - 128) / 128;
        sum += x * x;
      }
      return Math.min(1, Math.sqrt(sum / n) * 3.2);
    };
    // Write smoothed levels into the ref every frame — NO React state, so this
    // loop never re-renders the page. The meter bars read the ref in their own rAF.
    const loop = () => {
      const a = analysersRef.current;
      const dT = read(a.desktop);
      const mT = read(a.mic);
      const sm = smoothRef.current;
      sm.desktop += (dT - sm.desktop) * (dT > sm.desktop ? 0.55 : 0.12);
      sm.mic += (mT - sm.mic) * (mT > sm.mic ? 0.55 : 0.12);
      levelsRef.current.desktop = sm.desktop;
      levelsRef.current.mic = sm.mic;
      meterRaf.current = requestAnimationFrame(loop);
    };
    meterRaf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(meterRaf.current);
  }, [meterOn]);

  // metrics — only poll while the Record page is visible or recording
  useEffect(() => {
    const api = studio;
    if (!api || !(recordActive || recording)) return;
    const id = setInterval(async () => {
      const m = await api.getMetrics();
      setStats((p) => ({ ...p, cpu: m.cpu, memMb: m.memMb }));
    }, 1500);
    return () => clearInterval(id);
  }, [recordActive, recording]);

  // elapsed
  useEffect(() => {
    if (!recording || paused) return;
    const id = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, [recording, paused]);

  /* ---------------- recording ---------------- */
  function buildRecordStream(): MediaStream | null {
    const c = canvasRef.current;
    if (!c) return null;
    const v = c.captureStream(getSettings().fps);
    const tracks = [...v.getVideoTracks()];
    const a = mixDestRef.current?.stream.getAudioTracks() ?? [];
    return new MediaStream([...tracks, ...a]);
  }

  async function save(blob: Blob, ext: string, durationSec: number, prefix?: string) {
    if (!studio) return;
    const buf = await blob.arrayBuffer();
    const res = await studio.saveRecording(buf, ext, durationSec);
    let path = res.path;
    let size = res.size;
    if (getSettings().recordFormat === "mkv" && ext !== "mkv") {
      const r = await studio.remux(res.path, "mkv");
      if (r.ok && r.path) {
        path = r.path;
        size = r.size ?? size;
      }
    }
    const sizeMb = size / 1048576;
    lastRef.current = { name: path.split(/[\\/]/).pop() || "Recording", path, sizeMb };
    setStatus(`${prefix ?? "Saved"} · ${sizeMb.toFixed(0)} MB`);
    if (getSettings().autoOptimize) {
      const s = getSettings();
      await runOptimize({ input: path, codec: s.codec, quality: s.quality, scale: s.scale, preset: s.preset, format: s.optFormat }, lastRef.current.name);
    }
  }

  async function start() {
    if (!sourcesRef.current.length) {
      setError("Add a source to record first.");
      notify({ title: "No sources", desc: "Add a source from the + button.", tone: "info" });
      return;
    }
    const stream = buildRecordStream();
    if (!stream) {
      setError("Preview not ready.");
      return;
    }
    try {
      if (audioCtxRef.current?.state === "suspended") await audioCtxRef.current.resume();
      // Play the start cue and let it finish BEFORE capture begins — desktop-audio
      // loopback records everything the system plays, so a chime fired after
      // rec.start() ended up baked into the recording. Leading it keeps it out.
      playStart();
      await new Promise((r) => setTimeout(r, 300));
      const mime = mimeForFormat(getSettings().recordFormat);
      recMimeRef.current = mime;
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.max(2, getSettings().recordBitrateMbps) * 1_000_000 });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) {
          chunksRef.current.push(e.data);
          setStats((p) => ({ ...p, bitrate: Math.round((e.data.size * 8) / 1_000_000) }));
        }
      };
      rec.onstop = () =>
        void save(new Blob(chunksRef.current, { type: recMimeRef.current }), extOf(recMimeRef.current), Math.round(elapsedRef.current)).finally(() => {
          stopResolveRef.current?.();
          stopResolveRef.current = null;
        });
      recRef.current = rec;
      recStreamRef.current = stream;
      rec.start(1000);
      elapsedRef.current = 0;
      setElapsed(0);
      setRecording(true);
      recordingRef.current = true;
      setPaused(false);
      setStatus("Recording…");
    } catch {
      setError("Could not start recording.");
    }
  }

  const stop = useCallback(() => {
    if (!recordingRef.current) return;
    try {
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    } catch {
      /* ignore */
    }
    // Release the canvas-capture VIDEO track (created fresh per recording) so it
    // stops pulling frames. Leave the audio tracks alone — they belong to the
    // shared, persistent mix used by monitoring + the next recording.
    try {
      recStreamRef.current?.getVideoTracks().forEach((t) => t.stop());
    } catch {
      /* noop */
    }
    recStreamRef.current = null;
    setRecording(false);
    recordingRef.current = false;
    setPaused(false);
    setStats((p) => ({ ...p, bitrate: 0 }));
    playStop();
  }, []);
  // Stop recording and resolve once the file has been written (used by the close
  // guard so a recording is saved before the app quits).
  function stopAndWait(): Promise<void> {
    return new Promise((res) => {
      if (!recordingRef.current) return res();
      stopResolveRef.current = res;
      stop();
      // safety net in case onstop/save never fire
      setTimeout(() => {
        if (stopResolveRef.current) {
          stopResolveRef.current = null;
          res();
        }
      }, 8000);
    });
  }

  function pause() {
    const r = recRef.current;
    if (!r) return;
    if (r.state === "recording") {
      r.pause();
      setPaused(true);
    } else if (r.state === "paused") {
      r.resume();
      setPaused(false);
    }
  }

  async function screenshot() {
    const c = canvasRef.current;
    if (!c || !studio || !sourcesRef.current.length) return;
    playShutter();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (!blob) return;
    const res = await studio.saveScreenshot(await blob.arrayBuffer());
    if (res.path) notify({ title: "Screenshot saved", tone: "success", action: { label: "Open", run: () => studio?.reveal(res.path) } });
  }

  /* ---------------- replay ---------------- */
  useEffect(() => {
    const s = settings;
    const canRun = s.replayEnabled && sourcesRef.current.length > 0 && !recording;
    if (!canRun) {
      try {
        if (replayRecRef.current?.state !== "inactive") replayRecRef.current?.stop();
      } catch {}
      replayRecRef.current = null;
      setReplayActive(false);
      return;
    }
    const stream = buildRecordStream();
    if (!stream) return;
    const mime = mimeForFormat(s.recordFormat);
    recMimeRef.current = mime;
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.max(2, s.recordBitrateMbps) * 1_000_000 });
    replayBufRef.current = [];
    replayHeaderRef.current = null;
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      // The first chunk carries the container init/header — keep it forever or the
      // saved clip is unreadable.
      if (!replayHeaderRef.current) {
        replayHeaderRef.current = e.data;
        return;
      }
      const now = performance.now();
      replayBufRef.current.push({ t: now, b: e.data });
      const cutoff = now - s.replaySeconds * 1000 - 1500;
      replayBufRef.current = replayBufRef.current.filter((c) => c.t >= cutoff);
    };
    // finer timeslice → tighter ring-buffer boundaries → smoother replay start
    rec.start(400);
    replayRecRef.current = rec;
    setReplayActive(true);
    return () => {
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {}
      // The replay recorder owns a fresh canvas.captureStream() video track —
      // stop ALL its tracks on teardown or each setting change leaks a track
      // (mirrors how stop() releases recStreamRef's video track at ~line 796).
      stream.getTracks().forEach((t) => t.stop());
    };
  }, [settings.replayEnabled, settings.replaySeconds, settings.recordFormat, settings.recordBitrateMbps, recording, sources.length]);

  async function saveReplay() {
    const header = replayHeaderRef.current;
    const buf = replayBufRef.current;
    if (!studio || !header || !buf.length) {
      notify({ title: "Replay buffer empty", desc: "Enable instant replay and wait a moment.", tone: "info" });
      return;
    }
    setStatus("Saving replay…");
    const blob = new Blob([header, ...buf.map((c) => c.b)], { type: recMimeRef.current });
    const buffer = await blob.arrayBuffer();
    const res = await studio.saveRecording(buffer, extOf(recMimeRef.current), getSettings().replaySeconds);
    // Re-encode to smooth constant-frame-rate H.264 so the trimmed buffer always
    // plays back cleanly at the capture frame rate.
    const fixed = await studio.fixReplay(res.path, getSettings().fps);
    const finalPath = fixed.ok && fixed.path ? fixed.path : res.path;
    const sizeMb = (fixed.size ?? res.size) / 1048576;
    lastRef.current = { name: finalPath.split(/[\\/]/).pop() || "Replay", path: finalPath, sizeMb };
    setStatus(`Replay saved · ${sizeMb.toFixed(0)} MB`);
    playChime();
    notify({ title: "Instant replay saved", desc: `Last ${getSettings().replaySeconds}s · ready to play`, tone: "success", action: { label: "Open", run: () => studio?.reveal(finalPath) } });
    if (getSettings().autoOptimize) {
      const s = getSettings();
      await runOptimize({ input: finalPath, codec: s.codec, quality: s.quality, scale: s.scale, preset: s.preset, format: s.optFormat }, lastRef.current.name);
    }
  }

  /* ---------------- hotkeys ---------------- */
  useEffect(() => {
    const api = studio;
    if (!api) return;
    api.registerHotkeys(settings.hotkeys);
    const cycleSel = (dir: number) => {
      const list = [...sourcesRef.current].sort((a, b) => a.z - b.z);
      if (!list.length) return;
      const i = list.findIndex((s) => s.id === selectedRef.current);
      const next = list[(i + dir + list.length) % list.length];
      if (next) setSelectedId(next.id);
    };
    const off = api.onHotkey((action: HotkeyAction) => {
      switch (action) {
        case "startStop":
          recordingRef.current ? stop() : start();
          break;
        case "pauseResume":
          pause();
          break;
        case "saveReplay":
          saveReplay();
          break;
        case "screenshot":
          screenshot();
          break;
        case "muteMic":
          setSettings({ micEnabled: !getSettings().micEnabled });
          notify({ title: getSettings().micEnabled ? "Microphone on" : "Microphone muted", tone: "info" });
          break;
        case "muteDesktop":
          setSettings({ systemAudio: !getSettings().systemAudio });
          notify({ title: getSettings().systemAudio ? "System audio on" : "System audio muted", tone: "info" });
          break;
        case "toggleReplay":
          setSettings({ replayEnabled: !getSettings().replayEnabled });
          notify({ title: getSettings().replayEnabled ? "Instant replay on" : "Instant replay off", tone: "info" });
          break;
        case "optimizeLast": {
          const last = lastRef.current;
          if (last?.path) {
            const s = getSettings();
            runOptimize({ input: last.path, codec: s.codec, quality: s.quality, scale: s.scale, preset: s.preset, format: s.optFormat }, last.name);
          } else notify({ title: "Nothing to optimize yet", tone: "info" });
          break;
        }
        case "nextSource":
          cycleSel(1);
          break;
        case "prevSource":
          cycleSel(-1);
          break;
        case "openFolder":
          studio?.openRecordingsDir();
          break;
        case "cycleTheme": {
          const i = THEMES.findIndex((t) => t.id === getSettings().theme);
          setSettings({ theme: THEMES[(i + 1) % THEMES.length].id });
          break;
        }
        case "toggleCursor":
          setSettings({ showCursor: !getSettings().showCursor });
          break;
        case "showApp":
          break;
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.hotkeys]);

  // undo / redo shortcuts (global)
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    CW,
    CH,
    attachCanvas,
    sources,
    selectedId,
    select,
    snapshot,
    undo,
    redo,
    addSource,
    removeSource,
    renameSource,
    setVisible,
    setLocked,
    reorder,
    reorderList,
    moveToEdge,
    duplicateSource,
    updateTransform,
    liveTransform,
    refreshScreenSources,
    previewing: sources.length > 0,
    recording,
    paused,
    elapsed,
    levelsRef,
    stats,
    status,
    error,
    replayActive,
    audioVersion,
    getMonitorStream,
    start,
    stop,
    stopAndWait,
    pause,
    screenshot,
    saveReplay,
    last: lastRef,
  };
}
