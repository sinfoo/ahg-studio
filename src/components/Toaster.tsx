import { AnimatePresence, motion } from "framer-motion";
import { Check, Info, X } from "lucide-react";
import { dismiss, useToasts, type Tone } from "../lib/notify";

const toneRing: Record<Tone, string> = {
  success: "var(--good)",
  info: "var(--accent)",
  error: "var(--rec)",
};

export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="pointer-events-auto flex min-w-[300px] max-w-[420px] items-center gap-3 rounded-xl border border-line bg-panel/95 px-3.5 py-2.5 shadow-[var(--shadow-pop)] backdrop-blur"
            style={{ boxShadow: `0 0 0 1px ${toneRing[t.tone]}22, var(--shadow-pop)` }}
          >
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
              style={{ background: `${toneRing[t.tone]}1f`, color: toneRing[t.tone] }}
            >
              {t.tone === "success" ? <Check className="h-4 w-4" strokeWidth={2.5} /> : t.tone === "error" ? <X className="h-4 w-4" strokeWidth={2.5} /> : <Info className="h-4 w-4" strokeWidth={2.5} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-600 text-ink">{t.title}</div>
              {t.desc && <div className="truncate text-[12px] text-muted">{t.desc}</div>}
            </div>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
                className="focus-ring shrink-0 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-600 text-[var(--on-accent)] hover:bg-accent-strong"
              >
                {t.action.label}
              </button>
            )}
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="focus-ring shrink-0 rounded-md p-1 text-dim hover:text-ink">
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
