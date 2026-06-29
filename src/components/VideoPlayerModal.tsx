import { motion } from "framer-motion";
import { Maximize2, Minimize2, Pause, Play, UploadCloud, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RecFile } from "../lib/bridge";
import { clamp, cx } from "../lib/format";

// mm:ss formatter (format.ts only exposes the HH:MM:SS `timecode`; player copy
// asks for compact mm:ss). Local + self-contained so nothing else is touched.
function mmss(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const IDLE_MS = 2500;

export function VideoPlayerModal({
  file,
  onClose,
  onImport,
}: {
  file: RecFile;
  onClose: () => void;
  onImport?: (f: RecFile) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const vref = useRef<HTMLVideoElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seeking = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(file.durationSec || 0);
  const [buffered, setBuffered] = useState(0); // fraction 0..1
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fs, setFs] = useState(false);
  const [show, setShow] = useState(true); // controls visible

  const src = "file:///" + file.path.replace(/\\/g, "/");

  // ---- controls auto-hide on idle, reappear on movement ----
  const kick = useCallback(() => {
    setShow(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      // Keep the bar up while paused so the user can find the controls.
      if (!vref.current?.paused) setShow(false);
    }, IDLE_MS);
  }, []);

  // ---- video element event wiring (drive UI from the element, no rAF) ----
  useEffect(() => {
    const v = vref.current;
    if (!v) return;
    const onLoaded = () => setDur(isFinite(v.duration) ? v.duration : file.durationSec || 0);
    const onTime = () => {
      if (!seeking.current) setT(v.currentTime || 0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onProgress = () => {
      try {
        const end = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
        const d = v.duration || dur || 1;
        setBuffered(clamp(end / d, 0, 1));
      } catch {
        /* noop */
      }
    };
    const onVol = () => {
      setMuted(v.muted);
      setVolume(v.volume);
    };
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("progress", onProgress);
    v.addEventListener("volumechange", onVol);
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("progress", onProgress);
      v.removeEventListener("volumechange", onVol);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // ---- leak-free teardown: stop the element + clear timers on unmount ----
  useEffect(() => {
    kick();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      const v = vref.current;
      if (v) {
        try {
          v.pause();
          v.removeAttribute("src");
          v.load();
        } catch {
          /* noop */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- fullscreen state tracking ----
  useEffect(() => {
    const onFsChange = () => setFs(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const togglePlay = useCallback(() => {
    const v = vref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
    kick();
  }, [kick]);

  const seekTo = useCallback((sec: number) => {
    const v = vref.current;
    const d = v?.duration || dur || 0;
    const next = clamp(sec, 0, d || 0);
    if (v) v.currentTime = next;
    setT(next);
  }, [dur]);

  const toggleFs = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  }, []);

  const toggleMute = useCallback(() => {
    const v = vref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const setVol = useCallback((val: number) => {
    const v = vref.current;
    const next = clamp(val, 0, 1);
    if (v) {
      v.volume = next;
      v.muted = next === 0;
    }
    setVolume(next);
    setMuted(next === 0);
  }, []);

  const doImport = useCallback(() => {
    onImport?.(file);
    onClose();
  }, [file, onImport, onClose]);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing in inputs.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "Escape":
          e.preventDefault();
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          else onClose();
          break;
        case "ArrowRight":
          e.preventDefault();
          seekTo((vref.current?.currentTime || 0) + 5);
          kick();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekTo((vref.current?.currentTime || 0) - 5);
          kick();
          break;
        case "f":
        case "F":
          e.preventDefault();
          toggleFs();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seekTo, toggleFs, onClose, kick]);

  // ---- scrubber drag ----
  const seekFromClientX = useCallback((clientX: number) => {
    const el = seekRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = clamp((clientX - r.left) / r.width, 0, 1);
    seekTo(frac * (dur || 0));
  }, [dur, seekTo]);

  const pct = dur ? clamp(t / dur, 0, 1) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-6 backdrop-blur-xl"
      onClick={onClose}
      onMouseMove={kick}
    >
      <motion.div
        ref={stageRef}
        initial={{ scale: 0.94, y: 14, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          "group/stage relative overflow-hidden bg-black",
          fs ? "h-screen w-screen rounded-none" : "max-h-[80vh] max-w-[84vw] rounded-2xl shadow-[0_30px_90px_oklch(0_0_0_/_0.7)]"
        )}
        style={{ cursor: show ? "default" : "none" }}
      >
        <video
          ref={vref}
          key={src}
          src={src}
          autoPlay
          controls={false}
          onClick={togglePlay}
          onDoubleClick={toggleFs}
          className={cx("block bg-black object-contain", fs ? "h-screen w-screen" : "max-h-[80vh] max-w-[84vw]")}
        />

        {/* top scrim + title */}
        <div
          className={cx(
            "pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 bg-gradient-to-b from-black/70 to-transparent px-5 pb-10 pt-4 transition-opacity duration-300",
            show ? "opacity-100" : "opacity-0"
          )}
        >
          <h2 className="truncate text-[14px] font-600 text-white/95 drop-shadow">{file.name}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="focus-ring pointer-events-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>

        {/* center play hint when paused */}
        {!playing && (
          <button
            onClick={togglePlay}
            aria-label="Play"
            className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition-transform hover:scale-105"
          >
            <Play className="ml-1 h-7 w-7" fill="currentColor" strokeWidth={0} />
          </button>
        )}

        {/* bottom controls bar */}
        <div
          className={cx(
            "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-5 pb-4 pt-12 transition-opacity duration-300",
            show ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        >
          {/* scrubber */}
          <div
            ref={seekRef}
            onPointerDown={(e) => {
              seeking.current = true;
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              seekFromClientX(e.clientX);
            }}
            onPointerMove={(e) => seeking.current && seekFromClientX(e.clientX)}
            onPointerUp={(e) => {
              seeking.current = false;
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
              } catch {
                /* noop */
              }
            }}
            className="group/seek relative flex h-5 cursor-pointer items-center"
          >
            <div className="relative h-1 w-full rounded-full bg-white/20 transition-[height] duration-150 group-hover/seek:h-1.5">
              {/* buffered */}
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${buffered * 100}%` }} />
              {/* played (accent, glowing) */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]"
                style={{ width: `${pct}%` }}
              />
              {/* thumb */}
              <div
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow-[0_0_10px_var(--accent)] transition-opacity duration-150 group-hover/seek:opacity-100"
                style={{ left: `${pct}%` }}
              />
            </div>
          </div>

          {/* transport row */}
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
              className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-[var(--on-accent)] transition-transform active:scale-95"
            >
              {playing ? <Pause className="h-5 w-5" fill="currentColor" strokeWidth={0} /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" strokeWidth={0} />}
            </button>

            <span className="shrink-0 font-mono text-[12px] text-white/90 tnum">
              {mmss(t)} <span className="text-white/40">/ {mmss(dur)}</span>
            </span>

            {/* volume */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleMute}
                aria-label={muted ? "Unmute" : "Mute"}
                className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              >
                {muted || volume === 0 ? <VolumeX className="h-[18px] w-[18px]" strokeWidth={2} /> : <Volume2 className="h-[18px] w-[18px]" strokeWidth={2} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => setVol(Number(e.target.value))}
                aria-label="Volume"
                className="ahg-range focus-ring h-1.5 w-24 cursor-pointer appearance-none rounded-full"
                style={{ background: `linear-gradient(to right, var(--accent) ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.2) ${(muted ? 0 : volume) * 100}%)` }}
              />
            </div>

            <div className="ml-auto flex items-center gap-2">
              {onImport && (
                <button
                  onClick={doImport}
                  className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-[13px] font-600 text-[var(--on-accent)] transition-colors hover:bg-accent-strong"
                >
                  <UploadCloud className="h-4 w-4" strokeWidth={2.1} />
                  Import to Edit
                </button>
              )}
              <button
                onClick={toggleFs}
                aria-label={fs ? "Exit fullscreen" : "Fullscreen"}
                title={fs ? "Exit fullscreen" : "Fullscreen"}
                className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              >
                {fs ? <Minimize2 className="h-[18px] w-[18px]" strokeWidth={2} /> : <Maximize2 className="h-[18px] w-[18px]" strokeWidth={2} />}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
