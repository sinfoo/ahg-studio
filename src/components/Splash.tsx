import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import logo from "../assets/logo-256.png";
import { studio } from "../lib/bridge";
import { warmLibrary } from "../store/library";

// Warm the expensive, normally-lazy work up front so it never hitches mid-session:
// GPU-encoder probe (cached in main), capture source list, and the recordings
// list. Fire-and-forget — the splash doesn't block on these, it just kicks them.
function warmup() {
  try {
    studio?.detectHwEncoders?.();
    studio?.listSources?.();
    // Warm the recordings library (list + on-disk thumbnails) into a shared
    // cache so the Library/Optimize lists render instantly later, never mid-
    // session "generating".
    warmLibrary();
  } catch {
    /* noop */
  }
}

const STAGES = [
  "Initializing capture engine",
  "Probing GPU encoders",
  "Loading FFmpeg",
  "Warming the compositor",
  "Preparing studio",
];

export function Splash({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion();
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    warmup();
    const start = performance.now();
    // A touch longer so the warmup work above has time to land before the app is
    // revealed (less first-interaction hitching).
    const total = reduce ? 420 : 1000;
    let raf = 0;
    let doneTimer: ReturnType<typeof setTimeout> | undefined;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / total);
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(eased);
      setStage(Math.min(STAGES.length - 1, Math.floor(eased * STAGES.length)));
      if (t < 1) raf = requestAnimationFrame(tick);
      else doneTimer = setTimeout(onDone, reduce ? 60 : 100);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (doneTimer) clearTimeout(doneTimer);
    };
  }, [onDone, reduce]);

  return (
    <motion.div
      exit={{ opacity: 0, scale: 1.015 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="fixed inset-0 z-50 grid place-items-center overflow-hidden"
      style={{
        background:
          "radial-gradient(125% 125% at 50% 32%, oklch(0.205 0.022 215), oklch(0.14 0.014 250) 52%, oklch(0.105 0.01 256))",
      }}
    >
      {/* ambient field */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/2 top-[38%] h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.5] blur-[60px]"
          style={{ background: "radial-gradient(circle, oklch(0.74 0.12 195 / 0.5), transparent 66%)" }}
        />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(oklch(0.8 0.06 200) 1px, transparent 1px), linear-gradient(90deg, oklch(0.8 0.06 200) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(circle at 50% 38%, #000 0%, transparent 70%)",
            WebkitMaskImage: "radial-gradient(circle at 50% 38%, #000 0%, transparent 70%)",
          }}
        />
      </div>

      <div className="relative flex flex-col items-center">
        {/* aperture ring + logo */}
        <div className="relative grid h-44 w-44 place-items-center">
          {!reduce && (
            <motion.div
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent, oklch(0.78 0.13 195 / 0.85), transparent 32%)",
                mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))",
                WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))",
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 5, ease: "linear", repeat: Infinity }}
            />
          )}
          <div className="absolute inset-3 rounded-full border border-[oklch(0.74_0.1_195_/_0.22)]" />
          {/* aperture blades */}
          {!reduce &&
            Array.from({ length: 6 }).map((_, i) => (
              <span
                key={i}
                aria-hidden
                className="absolute h-[3px] w-[3px] rounded-full"
                style={{
                  background: "oklch(0.82 0.13 195 / 0.85)",
                  transform: `rotate(${i * 60}deg) translateY(-62px)`,
                  opacity: progress > i / 6 ? 1 : 0.18,
                  transition: "opacity 240ms ease-out",
                }}
              />
            ))}
          <motion.img
            src={logo}
            alt="AHG Studio"
            className="relative h-24 w-24"
            style={{ filter: "drop-shadow(0 0 26px oklch(0.74 0.13 195 / 0.55))" }}
            initial={{ opacity: 0, scale: 0.86 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="mt-7 text-[30px] font-700 tracking-tight text-white"
        >
          AHG Studio
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.24, duration: 0.55 }}
          className="mt-1.5 text-[11px] font-500 uppercase tracking-[0.42em] text-[oklch(0.78_0.1_195)]"
        >
          Record &amp; Optimize
        </motion.div>

        <div className="mt-9 h-[3px] w-72 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full"
            style={{
              width: `${progress * 100}%`,
              background: "linear-gradient(to right, oklch(0.62 0.11 200), oklch(0.82 0.13 195))",
              boxShadow: "0 0 12px oklch(0.78 0.13 195 / 0.6)",
            }}
          />
        </div>
        <div className="mt-3 flex h-4 items-center gap-1 font-mono text-[11px] tracking-tight text-white/55 tnum">
          <span>{STAGES[stage]}</span>
          <span className="text-white/30">· {Math.round(progress * 100)}%</span>
        </div>
      </div>

      <div className="absolute bottom-6 flex items-center gap-2 text-[11px] text-white/30">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "oklch(0.74 0.14 152)" }} />
        v0.1 · GPU-accelerated
      </div>
    </motion.div>
  );
}
