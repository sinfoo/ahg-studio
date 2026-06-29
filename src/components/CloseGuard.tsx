import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Video, X } from "lucide-react";
import { useEffect, useState } from "react";
import { studio } from "../lib/bridge";
import { useCaptureCtx } from "../hooks/CaptureContext";
import { timecode } from "../lib/format";
import { useOptimize } from "../store/optimize";

type Task = { key: string; icon: typeof Video; title: string; detail: string; tone: string };

export function CloseGuard() {
  const cap = useCaptureCtx();
  const opt = useOptimize();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  // Build the live list of things in progress.
  const tasks: Task[] = [];
  if (cap.recording) tasks.push({ key: "rec", icon: Video, title: "Recording in progress", detail: `${timecode(cap.elapsed)} captured${cap.paused ? " · paused" : ""}`, tone: "#ef4444" });
  if (opt.running) tasks.push({ key: "opt", icon: Sparkles, title: "Optimizing a video", detail: `${Math.round(opt.progress * 100)}% · ${opt.label || "encoding"}`, tone: "#22c55e" });

  useEffect(() => {
    const api = studio;
    if (!api) return;
    return api.onCloseRequest?.(() => {
      // Re-read the latest activity at request time.
      const busy = cap.recording || opt.running;
      if (busy) setOpen(true);
      else api.confirmClose();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cap.recording, opt.running]);

  async function closeAnyway() {
    setClosing(true);
    try {
      // Always save an in-progress recording before quitting.
      if (cap.recording) await cap.stopAndWait();
      if (opt.running) studio?.cancelCompress?.();
    } catch {
      /* noop */
    }
    studio?.confirmClose();
  }
  function keepWorking() {
    studio?.cancelClose();
    setOpen(false);
  }

  const recording = cap.recording;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[200] grid place-items-center bg-black/75 p-8 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.92, y: 18, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--shadow-pop)]"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(80%_120%_at_50%_0%,var(--rec-soft),transparent)]" />
            <div className="relative px-6 pt-6 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rec-soft text-rec">
                <X className="h-6 w-6" strokeWidth={2.4} />
              </span>
              <h2 className="mt-3 text-[16px] font-700 text-ink">Hold on — you're still working</h2>
              <p className="mt-1 text-[12.5px] text-muted">{recording ? "Closing now will stop and save your recording." : "Closing now will cancel what's running."}</p>
            </div>

            <div className="relative space-y-2 px-6 py-5">
              {tasks.map((t) => (
                <div key={t.key} className="flex items-center gap-3 rounded-xl border border-line bg-panel2/60 p-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white" style={{ background: t.tone }}>
                    <t.icon className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-600 text-ink">{t.title}</div>
                    <div className="truncate font-mono text-[11.5px] text-dim tnum">{t.detail}</div>
                  </div>
                  {t.key === "rec" && <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-rec rec-dot" />}
                </div>
              ))}
            </div>

            <div className="relative flex items-center justify-end gap-2 border-t border-line bg-panel2/40 px-6 py-4">
              <button onClick={keepWorking} disabled={closing} className="focus-ring inline-flex h-10 items-center rounded-lg border border-line bg-panel2 px-4 text-[13px] font-600 text-ink transition-colors hover:bg-hover disabled:opacity-50">
                Keep working
              </button>
              <button
                onClick={closeAnyway}
                disabled={closing}
                className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg bg-rec px-4 text-[13px] font-700 text-white transition-[filter] hover:brightness-110 disabled:opacity-60"
              >
                {closing ? (recording ? "Saving & closing…" : "Closing…") : recording ? "Stop, save & close" : "Close anyway"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
