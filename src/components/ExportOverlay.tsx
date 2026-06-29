import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Clapperboard, FolderOpen, Minimize2, X } from "lucide-react";
import { studio } from "../lib/bridge";
import { mb } from "../lib/format";
import { cancelExportJob, dismissExport, setExportMinimized, useExportJob } from "../store/export";
import { useOptimize } from "../store/optimize";

function Ring({ progress, size = 92, stroke = 7 }: { progress: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-hover)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 0.25s ease" }} />
    </svg>
  );
}

export function ExportOverlay() {
  const job = useExportJob();
  const opt = useOptimize();
  const visible = job.running || (job.done && !!job.output) || !!job.error;
  const pctText = `${Math.round(job.progress * 100)}%`;

  // Stack the export PiP ABOVE the optimize PiP when both are minimized (so two
  // background jobs read like stacked Windows notifications, not overlapping).
  const optPillVisible = (opt.running || (opt.done && !!opt.output) || !!opt.error) && opt.minimized;
  const bottom = optPillVisible ? 84 : 16;

  return (
    <>
      {/* minimized floating PiP (any page) */}
      <AnimatePresence>
        {visible && job.minimized && (
          <motion.button
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => setExportMinimized(false)}
            style={{ bottom, right: 16 }}
            className="focus-ring fixed z-[60] flex items-center gap-3 rounded-2xl border border-line bg-panel/95 py-2.5 pl-2.5 pr-4 shadow-[var(--shadow-pop)] backdrop-blur"
          >
            <span className="relative grid h-9 w-9 place-items-center">
              <Ring progress={job.error ? 1 : job.done ? 1 : job.progress} size={36} stroke={3.5} />
              <span className="absolute grid place-items-center text-accent">
                {job.error ? <X className="h-3.5 w-3.5 text-rec" strokeWidth={2.6} /> : job.done ? <Check className="h-3.5 w-3.5 text-good" strokeWidth={2.6} /> : <Clapperboard className="h-3.5 w-3.5" strokeWidth={2.2} />}
              </span>
            </span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-[12.5px] font-600 text-ink">{job.error ? "Export failed" : job.done ? "Exported" : "Exporting…"}</span>
              <span className="block truncate font-mono text-[11px] text-dim tnum">{job.running ? `${pctText} · ${job.label}` : job.label}</span>
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* full modal */}
      <AnimatePresence>
        {visible && !job.minimized && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-8 backdrop-blur-sm"
            onClick={() => job.running && setExportMinimized(true)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 14, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--shadow-pop)]"
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(80%_100%_at_50%_0%,var(--accent-soft),transparent)]" />

              <div className="relative flex items-center justify-between px-5 pt-4">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">
                    <Clapperboard className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <span className="text-[13px] font-700 text-ink">{job.error ? "Export failed" : job.done ? "Export complete" : "Exporting timeline"}</span>
                </div>
                {job.running ? (
                  <button onClick={() => setExportMinimized(true)} title="Minimize — keep exporting in the background" className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-ink">
                    <Minimize2 className="h-4 w-4" strokeWidth={2} />
                  </button>
                ) : (
                  <button onClick={dismissExport} className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-ink">
                    <X className="h-4 w-4" strokeWidth={2} />
                  </button>
                )}
              </div>

              <div className="relative grid place-items-center gap-4 px-6 py-7">
                <div className="relative grid place-items-center">
                  <Ring progress={job.error ? 1 : job.done ? 1 : job.progress} />
                  <span className="absolute grid place-items-center text-center">
                    {job.error ? <X className="h-8 w-8 text-rec" strokeWidth={2.4} /> : job.done ? <Check className="h-9 w-9 text-good" strokeWidth={2.4} /> : <span className="font-mono text-[22px] font-700 text-ink tnum">{pctText}</span>}
                  </span>
                </div>
                <div className="text-center">
                  <div className="truncate text-[14px] font-600 text-ink">{job.label || "Timeline"}</div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {job.error ? job.error : job.done ? `Saved · ${mb(job.outputSize)}` : job.progress < 0.04 ? "Preparing encoder…" : "Rendering — this can run in the background"}
                  </div>
                </div>
                {job.running && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${Math.max(4, job.progress * 100)}%` }} />
                  </div>
                )}
              </div>

              <div className="relative flex items-center justify-end gap-2 border-t border-line bg-panel2/40 px-5 py-3">
                {job.running ? (
                  <>
                    <button onClick={cancelExportJob} className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-600 text-muted transition-colors hover:bg-rec-soft hover:text-rec">
                      <X className="h-4 w-4" strokeWidth={2} /> Cancel
                    </button>
                    <button onClick={() => setExportMinimized(true)} className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-panel2 px-3.5 text-[13px] font-600 text-ink transition-colors hover:bg-hover">
                      <ChevronDown className="h-4 w-4" strokeWidth={2} /> Keep working in background
                    </button>
                  </>
                ) : job.done ? (
                  <>
                    <button onClick={dismissExport} className="focus-ring inline-flex h-9 items-center rounded-lg px-3.5 text-[13px] font-600 text-muted transition-colors hover:bg-hover hover:text-ink">
                      Done
                    </button>
                    <button onClick={() => job.output && studio?.reveal(job.output)} className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-[13px] font-600 text-[var(--on-accent)] transition-colors hover:bg-accent-strong">
                      <FolderOpen className="h-4 w-4" strokeWidth={2} /> Reveal file
                    </button>
                  </>
                ) : (
                  <button onClick={dismissExport} className="focus-ring inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-[13px] font-600 text-[var(--on-accent)] transition-colors hover:bg-accent-strong">
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
