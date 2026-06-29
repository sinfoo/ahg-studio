import { useEffect, useMemo, useRef } from "react";
import { clamp } from "../lib/format";
import { blendCss, clipAtFast, clipEnd, clipFilterCss, clipFrameAt, fadeMul, sourceTimeFor, type Clip, type Project } from "../lib/timeline";

const fileUrl = (p: string) => "file:///" + p.replace(/\\/g, "/");
const MAX_POOL = 6;
// How long the editor can stay hidden before we fully release the decoder pool.
// Quick tab hops keep the decoders warm (instant return); a genuinely
// backgrounded editor stops holding GPU/video memory entirely.
const IDLE_RELEASE_MS = 20000;

// Write a style/property only when its value actually changes. The slaving loop
// runs every animation frame, and unconditionally re-assigning ~12 styles per
// <video> forced a style recalc each frame even when nothing moved — the single
// biggest source of preview jank. The "last applied" map lives on the element so
// it is garbage-collected with it (no external cache to leak). */
function sStyle(v: HTMLVideoElement, prop: string, val: string) {
  const cache = ((v as unknown as { __s?: Record<string, string> }).__s ??= {});
  if (cache[prop] === val) return;
  cache[prop] = val;
  (v.style as unknown as Record<string, string>)[prop] = val;
}
function sProp(v: HTMLVideoElement, prop: "muted" | "volume" | "playbackRate", val: number | boolean) {
  if ((v as unknown as Record<string, unknown>)[prop] === val) return;
  (v as unknown as Record<string, unknown>)[prop] = val;
}
// Linear gain multiplier from a dB trim. Plain media elements cap at unity, so
// boosts (>0 dB) clamp in preview but are export-exact; attenuation is honored.
function gainMul(db?: number) {
  return typeof db === "number" && isFinite(db) && db !== 0 ? Math.pow(10, db / 20) : 1;
}
// Set playbackRate with HYSTERESIS — only when the target meaningfully differs from
// the current rate. The drift corrector recomputes a slightly different rate every
// frame; writing it each time made audible time-stretch artifacts ("glitchy audio").
// Snapping back to exactly `base` always applies so a clip settles to natural speed.
function sRate(v: HTMLMediaElement, target: number, base: number) {
  const cur = v.playbackRate;
  if (target === base ? cur !== base : Math.abs(cur - target) > 0.02) v.playbackRate = target;
}

// One layer to composite onto the canvas. We keep the decoding <video> hidden and
// read its LIVE layout box (offset*) at draw time, so a FrameEditor PiP drag (which
// writes the element's left/top/width/height directly) follows the cursor with no
// model round-trip. Transform / opacity / blend / filter come from the clip model.
type DrawLayer = { v: HTMLVideoElement; clip: Clip; op: number; blend: string; full: boolean };

// CSS blend-mode id → canvas globalCompositeOperation. These names overlap exactly
// for the modes we expose, so it's a near-passthrough (normal → source-over).
function blendComposite(blend?: string): GlobalCompositeOperation {
  if (!blend || blend === "normal") return "source-over";
  return blend as GlobalCompositeOperation;
}

/**
 * Smooth multi-clip preview player.
 *
 * The timeline playhead is the MASTER clock (advanced by wall-time in Edit), and
 * every <video> is slaved to it. We keep a pool of decoder elements keyed by
 * source path — so switching back to a clip is instant — and PRELOAD the next
 * clip on the active track, which kills the black-frame / "no audio" stalls the
 * old single-element src-swapping caused. Only the active clip's element plays
 * audio; the rest are paused. We only correct a playing element's time when it
 * drifts past a tolerance, so playback stays buttery instead of seeking on every
 * frame.
 */
export function PreviewPlayer({
  project,
  playhead,
  playing,
  active = true,
  onTogglePlay,
  onStageClick,
  clockRef,
  proxyMap,
  className,
}: {
  project: Project;
  playhead: number;
  playing: boolean;
  // original source path → CFR editing-proxy path. When a clip's proxy is ready
  // the preview loads it (smooth scrubbing); export still uses the original.
  proxyMap?: Record<string, string>;
  // When the Edit tab is hidden we release the whole decoder pool to free GPU
  // memory (a big contributor to GPU-process crashes when navigating tabs).
  active?: boolean;
  onTogglePlay: () => void;
  // Click on the stage → reports normalized (0..1) coords so Edit can hit-test
  // which video clip is under the cursor and select it (else it toggles play).
  onStageClick?: (nx: number, ny: number) => void;
  // PreviewPlayer reports the active video's true timeline time here so the
  // master clock in Edit can follow the video exactly (perfect A/V sync).
  clockRef?: { current: { t: number | null; progressing: boolean; stalled?: boolean } };
  className?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Compositor draw list — rebuilt each slaving pass (bottom→top order). The rAF
  // draw loop consumes the latest list so the single canvas shows the composite.
  const drawListRef = useRef<DrawLayer[]>([]);
  const dirtyRef = useRef(true); // redraw needed (a seek / layout change happened)
  const poolRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const usedRef = useRef<Map<string, number>>(new Map());
  const retryTimers = useRef<Map<HTMLVideoElement, number>>(new Map());
  const errorHandlers = useRef<Map<HTMLVideoElement, () => void>>(new Map());
  const tickRef = useRef(0);
  const idleTimer = useRef(0);
  const activePathsRef = useRef<Set<string>>(new Set());
  // Pool of <audio> elements (keyed by clip id) so multiple audio tracks play and
  // MIX in parallel — music beds, detached audio, etc. The browser sums them.
  const audioPoolRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioActiveRef = useRef<Set<string>>(new Set());
  // Visible video tracks — recomputed only when the track list changes, NOT on
  // every 60fps playhead tick (that per-frame .filter() allocated garbage).
  const vts = useMemo(() => project.tracks.filter((t) => t.kind === "video" && !t.hidden), [project.tracks]);

  // Full teardown of one pooled element — cancels its retry timer, removes its
  // error listener, frees the decoder and detaches it from the DOM. Used by both
  // eviction and unmount so an element can never leak a timer/listener/decoder.
  function disposeEl(v: HTMLVideoElement) {
    clearTimeout(retryTimers.current.get(v));
    retryTimers.current.delete(v);
    const h = errorHandlers.current.get(v);
    if (h) {
      v.removeEventListener("error", h);
      errorHandlers.current.delete(v);
    }
    try {
      v.pause();
      v.removeAttribute("src");
      v.load();
      v.remove();
    } catch {
      /* noop */
    }
  }

  // `path` is the ORIGINAL source path (stable pool key + dataset for the frame
  // editor); `srcUrl` is what actually loads — the CFR editing proxy once it's
  // ready, else the original. When the proxy lands we swap the source on the
  // SAME pooled element so playback transparently upgrades to the smooth proxy.
  function el(path: string, srcUrl: string): HTMLVideoElement {
    let v = poolRef.current.get(path);
    if (!v) {
      const vv = document.createElement("video");
      v = vv;
      v.dataset.clipPath = path; // lets the frame editor move this element directly
      v.dataset.srcUrl = srcUrl;
      v.src = srcUrl;
      v.preload = "auto";
      v.playsInline = true;
      v.muted = true;
      v.crossOrigin = "anonymous";
      // Recover a decoder that errored / was reclaimed by the GPU (the "preview
      // goes black and stays black" case) by re-loading its source a few times.
      // The retry timer + listener are tracked so they're cancelled on disposal.
      let tries = 0;
      const onError = () => {
        if (tries++ >= 3) return;
        clearTimeout(retryTimers.current.get(vv));
        const id = window.setTimeout(() => {
          try {
            vv.src = vv.dataset.srcUrl || srcUrl;
            vv.load();
          } catch {
            /* noop */
          }
        }, 250);
        retryTimers.current.set(vv, id);
      };
      vv.addEventListener("error", onError);
      errorHandlers.current.set(vv, onError);
      // Repaint the canvas the instant a scrubbed/loaded frame is ready (snappier
      // than waiting for the next slaving pass) — keeps scrubbing feeling responsive.
      const wake = () => { dirtyRef.current = true; };
      vv.addEventListener("seeked", wake);
      vv.addEventListener("loadeddata", wake);
      Object.assign(v.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        objectFit: "contain",
        opacity: "0",
        pointerEvents: "none",
        background: "transparent",
      } as CSSStyleDeclaration);
      stageRef.current?.appendChild(v);
      poolRef.current.set(path, v);
    } else if (v.dataset.srcUrl !== srcUrl) {
      // The editing proxy just became available (or changed) → swap the source on
      // the existing pooled element and invalidate its cached styles.
      v.dataset.srcUrl = srcUrl;
      try {
        v.src = srcUrl;
        v.load();
        delete (v as unknown as { __s?: Record<string, string> }).__s;
      } catch {
        /* noop */
      }
    }
    usedRef.current.set(path, ++tickRef.current);
    return v;
  }

  // Pooled <audio> element for an audio clip (keyed by clip id).
  function audioEl(id: string, srcUrl: string): HTMLAudioElement {
    let a = audioPoolRef.current.get(id);
    if (!a) {
      a = document.createElement("audio");
      a.dataset.srcUrl = srcUrl;
      a.src = srcUrl;
      a.preload = "auto";
      audioPoolRef.current.set(id, a);
    } else if (a.dataset.srcUrl !== srcUrl) {
      a.dataset.srcUrl = srcUrl;
      try {
        a.src = srcUrl;
        a.load();
      } catch {
        /* noop */
      }
    }
    return a;
  }

  function evict(keep: Set<string>) {
    if (poolRef.current.size <= MAX_POOL) return;
    const entries = [...poolRef.current.keys()].filter((p) => !keep.has(p)).sort((a, b) => (usedRef.current.get(a) || 0) - (usedRef.current.get(b) || 0));
    while (poolRef.current.size > MAX_POOL && entries.length) {
      const victim = entries.shift()!;
      const v = poolRef.current.get(victim);
      if (v) disposeEl(v);
      poolRef.current.delete(victim);
      usedRef.current.delete(victim);
    }
  }

  // When the editor is hidden, PAUSE the pooled decoders immediately (cheap, and
  // keeps a quick tab hop instant). If the editor stays hidden past
  // IDLE_RELEASE_MS we FULLY release the pool so a backgrounded editor never
  // holds GPU/video memory — the elements rebuild lazily on return. Tearing the
  // pool down on EVERY switch churned decoders and made navigation laggy, so the
  // teardown is deferred, not immediate.
  useEffect(() => {
    if (active) {
      // Returning to the editor — cancel any pending idle teardown.
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = 0;
      }
      return;
    }
    const pool = poolRef.current;
    pool.forEach((v) => {
      try {
        if (!v.paused) v.pause();
      } catch {
        /* noop */
      }
    });
    audioPoolRef.current.forEach((a) => {
      try {
        if (!a.paused) a.pause();
      } catch {
        /* noop */
      }
    });
    if (clockRef) clockRef.current = { t: null, progressing: false };
    idleTimer.current = window.setTimeout(() => {
      idleTimer.current = 0;
      pool.forEach((v) => disposeEl(v));
      pool.clear();
      usedRef.current.clear();
    }, IDLE_RELEASE_MS);
    return () => {
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = 0;
      }
    };
  }, [active, clockRef]);

  // Slave every video to the playhead. Runs on every playhead/playing/project
  // change; the body is cheap imperative DOM work. Skipped entirely while hidden.
  useEffect(() => {
    if (!active) return;
    const p = project;
    const mainTrack = vts.length ? vts[vts.length - 1] : null;
    const main = mainTrack ? clipAtFast(p.clips, mainTrack.id, playhead) : null;

    // Reuse one Set across frames (clear instead of allocate) to cut GC pressure.
    const activePaths = activePathsRef.current;
    activePaths.clear();
    // Object holder (not bare `let`) so TS doesn't narrow the closure-assigned
    // values to `never` at the clock report below.
    const top: { v: HTMLVideoElement | null; clip: Clip | null } = { v: null, clip: null };

    // Render visible video tracks top→bottom. OCCLUSION CULLING: once we hit a
    // full-frame, fully-opaque clip, everything UNDER it is hidden, so we stop —
    // those lower videos are never decoded. This is the fix for "two stacked
    // videos lag": only the visible top video decodes, halving the decode load.
    let occluded = false;
    const layers: DrawLayer[] = []; // top→bottom; reversed into the draw list below
    vts.forEach((track, ti) => {
      const c = clipAtFast(p.clips, track.id, playhead);
      if (occluded || !c?.path || c.kind !== "video") return;
      const isOverlay = track !== mainTrack;
      activePaths.add(c.path);
      const v = el(c.path, fileUrl(proxyMap?.[c.path] ?? c.path));
      // Position may be animated by keyframes (motion); size stays from the frame.
      const fr = clipFrameAt(c, isOverlay, playhead - c.start);
      // "Full" = the clip fills the canvas (its default). Only an explicitly
      // resized sub-region renders as a PiP (cover + rounded corners).
      const full = fr.w >= 0.999 && fr.h >= 0.999 && fr.x <= 0.001 && fr.y <= 0.001;
      // The <video> stays a HIDDEN decode source. We still write its layout box so
      // the FrameEditor (which drags this element) and the canvas (which reads
      // offsetLeft/Top/Width/Height) get the live geometry; visuals are drawn to the
      // compositor canvas, so the element itself is transparent (opacity 0).
      sStyle(v, "inset", "auto");
      sStyle(v, "left", `${(fr.x * 100).toFixed(3)}%`);
      sStyle(v, "top", `${(fr.y * 100).toFixed(3)}%`);
      sStyle(v, "width", `${(fr.w * 100).toFixed(3)}%`);
      sStyle(v, "height", `${(fr.h * 100).toFixed(3)}%`);
      sStyle(v, "zIndex", String(vts.length - ti + 1));
      sStyle(v, "opacity", "0");
      const op = (c.opacity ?? 1) * fadeMul(c, playhead);
      const blended = isOverlay && !!c.blend && c.blend !== "normal";
      layers.push({ v, clip: c, op, blend: blended ? blendCss(c.blend) : "normal", full });
      // The first (topmost) drawn clip drives the clock/buffering report.
      if (!top.v) {
        top.v = v;
        top.clip = c;
      }
      // A full-frame, fully-opaque clip hides everything below → stop decoding them.
      // A blended clip needs the layers beneath it live, so it never occludes.
      if (full && op >= 0.999 && !blended) occluded = true;
      sProp(v, "muted", isOverlay ? true : track.muted ?? false);
      sProp(v, "volume", clamp((c.volume ?? 1) * gainMul(c.gainDb), 0, 1));
      const baseRate = c.speed || 1;
      const want = sourceTimeFor(c, playhead);
      const ve = v as unknown as { __sk?: number };

      if (!playing || c.reverse) {
        // Scrubbing / paused / reverse: hold normal rate and seek to the target
        // every frame. For a FAST drag (big jump) use fastSeek() — it lands on the
        // nearest keyframe almost instantly, so the preview tracks the cursor with
        // no decode lag; once the move settles (small delta) we seek precisely for a
        // frame-accurate result. The browser aborts an in-flight seek and converges
        // to the newest, so scrubbing stays responsive.
        sProp(v, "playbackRate", baseRate);
        const tol = c.reverse ? 0.001 : 0.006;
        const diff = Math.abs(v.currentTime - want);
        if (diff > tol) {
          try {
            const vv = v as HTMLVideoElement & { fastSeek?: (t: number) => void };
            if (diff > 0.2 && typeof vv.fastSeek === "function") vv.fastSeek(want);
            else v.currentTime = want;
          } catch {
            /* noop */
          }
        }
        if (c.reverse) {
          if (!v.paused) v.pause();
        } else if (!v.paused) v.pause();
      } else {
        // PLAYING: slave to the wall clock with gentle playbackRate correction.
        // drift = how far the video is from where it should be (+ ahead, − behind).
        const drift = v.currentTime - want;
        if (!v.seeking) ve.__sk = 0;
        const seekStuck = v.seeking && !!ve.__sk && performance.now() - ve.__sk > 500;
        if (Math.abs(drift) > 0.35 && (!v.seeking || seekStuck)) {
          // Too far off (or a stuck seek) → one hard seek, then resume normal rate.
          try {
            v.currentTime = want;
            ve.__sk = performance.now();
          } catch {
            /* noop */
          }
          sRate(v, baseRate, baseRate);
        } else if (Math.abs(drift) > 0.08) {
          // Meaningful drift → nudge the RATE toward the clock instead of seeking
          // (seeking stutters). Behind → speed up a touch; ahead → slow down. Kept
          // within ±5% and applied with hysteresis so it's inaudible and doesn't
          // thrash. This keeps stacked videos locked without the hard-seek spiral.
          sRate(v, clamp(baseRate * (1 - drift * 0.4), baseRate * 0.95, baseRate * 1.05), baseRate);
        } else {
          sRate(v, baseRate, baseRate);
        }
        if (v.paused) v.play().catch(() => {});
      }
    });

    // Publish the composite layer list (bottom→top) for the canvas draw loop and
    // flag a redraw (the frame/layout just changed).
    layers.reverse();
    drawListRef.current = layers;
    dirtyRef.current = true;

    // Report the VISIBLE (top) clip's state for the buffering indicator. `stalled`
    // = playing but the decoder can't supply the next frame → Edit shows the
    // spinner (the wall clock keeps the playhead moving regardless).
    if (top.clip && top.v && clockRef) {
      const tc = top.clip;
      const tv = top.v;
      const vt = tc.start + (tv.currentTime - tc.in) / (tc.speed || 1);
      const stalled = playing && !tc.reverse && !tv.paused && tv.readyState < 3;
      clockRef.current = { t: vt, progressing: !tc.reverse && !tv.paused && !tv.seeking && tv.readyState >= 2, stalled };
    } else if (clockRef) {
      clockRef.current = { t: null, progressing: false, stalled: false };
    }

    // ---- preload the NEXT clip on the base track so transitions are seamless ----
    if (mainTrack) {
      // Non-allocating nearest-upcoming scan (no clipsOf array churn per frame).
      let upcoming: Clip | null = null;
      for (let i = 0; i < p.clips.length; i++) {
        const c = p.clips[i];
        if (c.trackId !== mainTrack.id || c.kind !== "video" || !c.path) continue;
        if (c.start > playhead && c.start - playhead < 2.5 && c.path !== main?.path && (!upcoming || c.start < upcoming.start)) upcoming = c;
      }
      if (upcoming?.path) {
        const v = el(upcoming.path, fileUrl(proxyMap?.[upcoming.path] ?? upcoming.path));
        activePaths.add(upcoming.path);
        const w = sourceTimeFor(upcoming, upcoming.start);
        if (!v.seeking && v.readyState >= 1 && Math.abs(v.currentTime - w) > 0.4) v.currentTime = w;
        if (!v.paused) v.pause();
      }
    }

    // ---- pause + hide everything not in use this frame ----
    poolRef.current.forEach((v, path) => {
      if (activePaths.has(path)) return;
      if (!v.paused) v.pause();
      sStyle(v, "opacity", "0");
      sStyle(v, "zIndex", "0");
    });
    evict(activePaths);

    // ---- AUDIO TRACKS: play + mix every active audio clip IN PARALLEL ----
    // Each audio track gets its own <audio> element; the browser sums them, so
    // music beds + voice etc. all play together. A clip is SKIPPED only when it's
    // the muted waveform-proxy of a video that's currently playing its OWN audio
    // (avoids doubling) — a detached/standalone audio clip always plays.
    const activeAudio = audioActiveRef.current;
    activeAudio.clear();
    for (const track of p.tracks) {
      if (track.kind !== "audio" || track.hidden) continue;
      const c = clipAtFast(p.clips, track.id, playhead);
      if (!c?.path || c.kind !== "audio") continue;
      if (c.linkId) {
        let playedByVideo = false;
        for (let i = 0; i < p.clips.length; i++) {
          const x = p.clips[i];
          if (x.id !== c.id && x.linkId === c.linkId && x.kind === "video" && playhead >= x.start && playhead < clipEnd(x) && (x.volume ?? 1) > 0) {
            playedByVideo = true;
            break;
          }
        }
        if (playedByVideo) continue;
      }
      activeAudio.add(c.id);
      const a = audioEl(c.id, fileUrl(c.path));
      const baseRate = c.speed || 1;
      a.volume = clamp((c.volume ?? 1) * gainMul(c.gainDb) * (track.muted ? 0 : 1), 0, 1);
      const want = sourceTimeFor(c, playhead);
      if (!playing || c.reverse) {
        a.playbackRate = baseRate;
        if (Math.abs(a.currentTime - want) > 0.04) {
          try {
            a.currentTime = want;
          } catch {
            /* noop */
          }
        }
        if (!a.paused) a.pause();
      } else {
        const drift = a.currentTime - want;
        if (Math.abs(drift) > 0.3 && !a.seeking) {
          try {
            a.currentTime = want;
          } catch {
            /* noop */
          }
          sRate(a, baseRate, baseRate);
        } else if (Math.abs(drift) > 0.1) {
          // Audio is more glitch-sensitive than video to rate changes, so nudge it
          // even more gently (±3%) and only past a wider deadzone, with hysteresis.
          sRate(a, clamp(baseRate * (1 - drift * 0.3), baseRate * 0.97, baseRate * 1.03), baseRate);
        } else {
          sRate(a, baseRate, baseRate);
        }
        if (a.paused) a.play().catch(() => {});
      }
    }
    // pause + evict audio not used this frame
    audioPoolRef.current.forEach((a, id) => {
      if (activeAudio.has(id) && !a.paused) return;
      if (!activeAudio.has(id) && !a.paused) a.pause();
    });
    if (audioPoolRef.current.size > 10) {
      for (const [id, a] of audioPoolRef.current) {
        if (activeAudio.has(id)) continue;
        try {
          a.pause();
          a.removeAttribute("src");
          a.load();
        } catch {
          /* noop */
        }
        audioPoolRef.current.delete(id);
        if (audioPoolRef.current.size <= 10) break;
      }
    }
  }, [project, playhead, playing, active, vts, proxyMap]);

  // ---- SINGLE-CANVAS COMPOSITOR ----
  // One <canvas> composites every visible layer (read from the draw list the
  // slaving pass publishes). The decoding <video>s stay hidden; this is what gives
  // a single GPU surface, pixel parity with the FFmpeg export, and effects the DOM
  // can't express (vignette). The canvas backing store is sized to the DISPLAY box
  // (not 1080p), so fill cost scales with the preview, not the source.
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // 2D canvas is universal in Chromium; bail (videos stay hidden) only in the impossible case.
    let raf = 0;
    let lastW = 0;
    let lastH = 0;
    let lastGeom = ""; // signature of layer boxes — redraw when geometry changes

    const draw = () => {
      raf = requestAnimationFrame(draw);
      // Repaint when something changed (a seek/layout) OR while any layer's <video>
      // is advancing or seeking. Checking the element's own paused/seeking flags (not
      // the React `playing` prop) means a playing OR mid-seek decoder always gets
      // fresh frames drawn even if this effect's closure is momentarily stale.
      const layersNow = drawListRef.current;
      let wake = dirtyRef.current;
      for (let i = 0; i < layersNow.length; i++) {
        const v = layersNow[i].v;
        if (v && (!v.paused || v.seeking)) { wake = true; break; }
      }
      // LIVE RESIZE/MOVE: the FrameEditor mutates the (hidden) <video>'s box directly
      // during a drag. Detect any box change and repaint so the footage resizes/moves
      // as you drag — not only when you release the mouse.
      let geom = "";
      for (let i = 0; i < layersNow.length; i++) {
        const v = layersNow[i].v;
        if (v) geom += v.offsetLeft + "," + v.offsetTop + "," + v.offsetWidth + "," + v.offsetHeight + "|";
      }
      if (geom !== lastGeom) { wake = true; lastGeom = geom; }
      if (!wake) return;
      // BLACK-FLASH FIX: if there ARE layers but the bottom (base) one can't supply a
      // frame yet (mid-seek / buffering), KEEP the last painted frame instead of
      // clearing to black. Don't consume `dirty` — retry next tick so it repaints the
      // instant the frame is ready. (An empty draw list = genuinely no clip → fall
      // through and clear to the background, which is correct.)
      const base0 = layersNow[0];
      if (layersNow.length && (!base0.v || base0.v.readyState < 2 || !base0.v.videoWidth)) return;
      dirtyRef.current = false;
      const cw = stage.clientWidth || 1;
      const ch = stage.clientHeight || 1;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pxW = Math.round(cw * dpr);
      const pxH = Math.round(ch * dpr);
      if (pxW !== lastW || pxH !== lastH) {
        canvas.width = pxW;
        canvas.height = pxH;
        lastW = pxW;
        lastH = pxH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // work in CSS pixels
      ctx.clearRect(0, 0, cw, ch);
      const layers = drawListRef.current;
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i];
        const v = L.v;
        if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) continue;
        // Live layout box (px in stage CSS space). offset* is the UNTRANSFORMED box,
        // so a FrameEditor PiP drag (which writes left/top/width/height) is honored;
        // rotate/flip/zoom are applied as canvas transforms below.
        const bx = v.offsetLeft;
        const by = v.offsetTop;
        const bw = v.offsetWidth;
        const bh = v.offsetHeight;
        if (bw < 1 || bh < 1) continue;
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        ctx.save();
        try {
          ctx.globalAlpha = clamp(L.op, 0, 1);
          ctx.globalCompositeOperation = blendComposite(L.blend);
          const f = clipFilterCss(L.clip);
          ctx.filter = f && f !== "none" ? f : "none";
          // Geometry transforms around the box centre (rotate, mirror/flip, punch-in
          // zoom) — mirrors clipTransformCss so preview matches the old DOM render.
          const cx = bx + bw / 2;
          const cy = by + bh / 2;
          const c = L.clip;
          if (c.rotate || c.flipH || c.flipV || (c.zoom && c.zoom !== 1)) {
            ctx.translate(cx, cy);
            if (c.rotate) ctx.rotate((c.rotate * Math.PI) / 180);
            const z = c.zoom && c.zoom > 1 ? c.zoom : 1;
            ctx.scale((c.flipH ? -1 : 1) * z, (c.flipV ? -1 : 1) * z);
            ctx.translate(-cx, -cy);
          }
          if (L.full) {
            // contain: fit the whole frame inside the box (letterbox), centred.
            const s = Math.min(bw / vw, bh / vh);
            const dw = vw * s;
            const dh = vh * s;
            ctx.drawImage(v, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
          } else {
            // cover: fill the box, cropping the source; rounded corners like a PiP.
            const s = Math.max(bw / vw, bh / vh);
            const sw = bw / s;
            const sh = bh / s;
            const sx = (vw - sw) / 2;
            const sy = (vh - sh) / 2;
            ctx.beginPath();
            const r = 6;
            if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, r);
            else ctx.rect(bx, by, bw, bh);
            ctx.clip();
            ctx.drawImage(v, sx, sy, sw, sh, bx, by, bw, bh);
          }
        } catch {
          /* a not-yet-decodable frame — skip this layer this tick */
        }
        ctx.restore();
        // Vignette — a per-clip darkening the DOM/CSS path can't do. Drawn in plain
        // box space (after the layer), strength 0..1.
        const vig = L.clip.vignette;
        if (typeof vig === "number" && vig > 0.001) {
          ctx.save();
          ctx.globalAlpha = clamp(vig, 0, 1);
          const cx2 = bx + bw / 2;
          const cy2 = by + bh / 2;
          const rad = Math.max(bw, bh) * 0.75;
          const g = ctx.createRadialGradient(cx2, cy2, rad * 0.35, cx2, cy2, rad);
          g.addColorStop(0, "rgba(0,0,0,0)");
          g.addColorStop(1, "rgba(0,0,0,1)");
          ctx.fillStyle = g;
          ctx.fillRect(bx, by, bw, bh);
          ctx.restore();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Clean up the whole pool on unmount — nothing left behind.
  useEffect(() => {
    const pool = poolRef.current;
    const audioPool = audioPoolRef.current;
    return () => {
      pool.forEach((v) => disposeEl(v));
      pool.clear();
      usedRef.current.clear();
      audioPool.forEach((a) => {
        try {
          a.pause();
          a.removeAttribute("src");
          a.load();
        } catch {
          /* noop */
        }
      });
      audioPool.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={stageRef}
      className={className}
      style={{ position: "absolute", inset: 0 }}
      onClick={(e) => {
        if (onStageClick) {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            onStageClick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
            return;
          }
        }
        onTogglePlay();
      }}
    >
      {/* The compositor surface. Pooled <video>s are appended here (hidden) as decode
          sources; this canvas shows the composited result. pointer-events:none so
          stage clicks (select / toggle play) and the FrameEditor still work. */}
      <canvas ref={canvasRef} data-preview-canvas="1" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
    </div>
  );
}
