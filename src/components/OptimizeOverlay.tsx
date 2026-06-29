import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, FolderOpen, Minimize2, Sparkles, X } from "lucide-react";
import { studio } from "../lib/bridge";
import { mb } from "../lib/format";
import { cancelOptimize, dismissOptimize, setOptimizeMinimized, useOptimize } from "../store/optimize";

// A ring that fills with progress (or spins indeterminately near the start).
function ProgressRing({ progress, size = 92, stroke = 7 }: { progress: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-hover)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        style={{ transition: "stroke-dashoffset 0.25s ease" }}
      />
    </svg>
  );
}

export function OptimizeOverlay() {
  const opt = useOptimize();
  const visible = opt.running || (opt.done && !!opt.output) || !!opt.error;
  const pctText = `${Math.round(opt.progress * 100)}%`;

  return (
    <>
      {/* ---- minimized floating indicator (any page) ---- */}
      <AnimatePresence>
        {visible && opt.minimized && (
          <motion.button
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => setOptimizeMinimized(false)}
            className="focus-ring fixed bottom-4 right-4 z-[60] flex items-center gap-3 rounded-2xl border border-line bg-panel/95 py-2.5 pl-2.5 pr-4 shadow-[var(--shadow-pop)] backdrop-blur"
          >
            <span className="relative grid h-9 w-9 place-items-center">
              <ProgressRing progress={opt.error ? 1 : opt.done ? 1 : opt.progress} size={36} stroke={3.5} />
              <span className="absolute grid place-items-center text-accent">
                {opt.error ? <X className="h-3.5 w-3.5 text-rec" strokeWidth={2.6} /> : opt.done ? <Check className="h-3.5 w-3.5 text-good" strokeWidth={2.6} /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />}
              </span>
            </span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-[12.5px] font-600 text-ink">{opt.error ? "Optimization failed" : opt.done ? "Optimized" : "Optimizing…"}</span>
              <span className="block truncate font-mono text-[11px] text-dim tnum">{opt.running ? `${pctText} · ${opt.label}` : opt.label}</span>
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* ---- full premium modal ---- */}
      <AnimatePresence>
        {visible && !opt.minimized && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-8 backdrop-blur-sm"
            onClick={() => opt.running && setOptimizeMinimized(true)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 14, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--shadow-pop)]"
            >
              {/* ambient header glow */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(80%_100%_at_50%_0%,var(--accent-soft),transparent)]" />

              <div className="relative flex items-center justify-between px-5 pt-4">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">
                    <Sparkles className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <span className="text-[13px] font-700 text-ink">{opt.error ? "Optimization failed" : opt.done ? "Optimization complete" : "Optimizing video"}</span>
                </div>
                {opt.running ? (
                  <button onClick={() => setOptimizeMinimized(true)} title="Minimize — keep optimizing in the background" className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-ink">
                    <Minimize2 className="h-4 w-4" strokeWidth={2} />
                  </button>
                ) : (
                  <button onClick={dismissOptimize} className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-ink">
                    <X className="h-4 w-4" strokeWidth={2} />
                  </button>
                )}
              </div>

              <div className="relative grid place-items-center gap-4 px-6 py-7">
                <div className="relative grid place-items-center">
                  <ProgressRing progress={opt.error ? 1 : opt.done ? 1 : opt.progress} />
                  <span className="absolute grid place-items-center text-center">
                    {opt.error ? (
                      <X className="h-8 w-8 text-rec" strokeWidth={2.4} />
                    ) : opt.done ? (
                      <Check className="h-9 w-9 text-good" strokeWidth={2.4} />
                    ) : (
                      <span className="font-mono text-[22px] font-700 text-ink tnum">{pctText}</span>
                    )}
                  </span>
                </div>

                <div className="text-center">
                  <div className="truncate text-[14px] font-600 text-ink">{opt.label || "Recording"}</div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {opt.error ? opt.error : opt.done ? `Saved · ${mb(opt.outputSize)}` : opt.progress < 0.04 ? "Preparing encoder…" : "Encoding — this can run in the background"}
                  </div>
                </div>

                {/* slim animated bar under the ring while running */}
                {opt.running && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${Math.max(4, opt.progress * 100)}%` }} />
                  </div>
                )}
              </div>

              <div className="relative flex items-center justify-end gap-2 border-t border-line bg-panel2/40 px-5 py-3">
                {opt.running ? (
                  <>
                    <button
                      onClick={cancelOptimize}
                      className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-600 text-muted transition-colors hover:bg-rec-soft hover:text-rec"
                    >
                      <X className="h-4 w-4" strokeWidth={2} /> Cancel
                    </button>
                    <button
                      onClick={() => setOptimizeMinimized(true)}
                      className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-panel2 px-3.5 text-[13px] font-600 text-ink transition-colors hover:bg-hover"
                    >
                      <ChevronDown className="h-4 w-4" strokeWidth={2} /> Keep working in background
                    </button>
                  </>
                ) : opt.done ? (
                  <>
                    <button onClick={dismissOptimize} className="focus-ring inline-flex h-9 items-center rounded-lg px-3.5 text-[13px] font-600 text-muted transition-colors hover:bg-hover hover:text-ink">
                      Done
                    </button>
                    <button
                      onClick={() => opt.output && studio?.reveal(opt.output)}
                      className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-[13px] font-600 text-[var(--on-accent)] transition-colors hover:bg-accent-strong"
                    >
                      <FolderOpen className="h-4 w-4" strokeWidth={2} /> Reveal file
                    </button>
                  </>
                ) : (
                  <button onClick={dismissOptimize} className="focus-ring inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-[13px] font-600 text-[var(--on-accent)] transition-colors hover:bg-accent-strong">
                    Dismiss
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
