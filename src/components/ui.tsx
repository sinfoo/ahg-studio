import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import React, { useRef, useState } from "react";
import { clamp, cx } from "../lib/format";

/* ---------- Resize handle: drag to resize panels (shared) ---------- */
export function ResizeHandle({ axis, onDelta, onReset, className }: { axis: "x" | "y"; onDelta: (d: number) => void; onReset?: () => void; className?: string }) {
  const last = useRef(0);
  const dragging = useRef(false);
  return (
    <div
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        dragging.current = true;
        last.current = axis === "x" ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const cur = axis === "x" ? e.clientX : e.clientY;
        const d = cur - last.current;
        if (d) {
          onDelta(d);
          last.current = cur;
        }
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        } catch {
          /* noop */
        }
      }}
      onDoubleClick={onReset}
      title={axis === "x" ? "Drag to resize · double-click to reset" : "Drag to resize · double-click to reset"}
      className={cx(
        "group relative z-20 flex shrink-0 touch-none items-center justify-center",
        axis === "x" ? "w-2.5 cursor-col-resize" : "h-2.5 cursor-row-resize",
        className
      )}
    >
      <span className={cx("rounded-full bg-line-strong/60 transition-colors group-hover:bg-accent", axis === "x" ? "h-9 w-[3px]" : "h-[3px] w-9")} />
    </div>
  );
}

/* ---------- Edge resizers: invisible drag zones on a container's borders ----------
   Drop into a position:relative container to make its own borders draggable — the
   way the program monitor resizes in pro editors (Premiere / DaVinci / CapCut).
   Each hit zone is invisible and a little wider than the visible border so it is
   easy to grab; a thin accent line fades in on hover so the affordance is
   discoverable without adding any permanent chrome. Each enabled edge takes an
   onDelta (pixels dragged, same sign convention as ResizeHandle) + optional
   onReset (double-click). */
type Edge = {
  value: number;
  min: number;
  max: number;
  // +1: dragging toward the +axis grows the value; -1: shrinks it. Sensible
  // per-side defaults (left/top grow, right/bottom shrink) cover the common case.
  sign?: 1 | -1;
  snap?: number[];
  onChange: (v: number) => void;
  onReset?: () => void;
};
export function EdgeResizers({ left, right, top, bottom }: { left?: Edge; right?: Edge; top?: Edge; bottom?: Edge }) {
  return (
    <>
      {left && <EdgeZone side="left" {...left} />}
      {right && <EdgeZone side="right" {...right} />}
      {top && <EdgeZone side="top" {...top} />}
      {bottom && <EdgeZone side="bottom" {...bottom} />}
    </>
  );
}

const SNAP_TOL = 9; // px magnet radius

function EdgeZone({ side, value, min, max, sign, snap, onChange, onReset }: Edge & { side: "left" | "right" | "top" | "bottom" }) {
  const horizontal = side === "left" || side === "right";
  const s = sign ?? (side === "left" || side === "top" ? 1 : -1);
  const start = useRef(0);
  const startVal = useRef(0);
  const dragging = useRef(false);
  const [snapped, setSnapped] = useState(false);
  return (
    <div
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        dragging.current = true;
        start.current = horizontal ? e.clientX : e.clientY;
        startVal.current = value;
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const cur = horizontal ? e.clientX : e.clientY;
        // Track the ABSOLUTE value (start value + total travel) so the edge never
        // drifts, then magnet-snap to the min, max, or any provided target.
        let v = clamp(startVal.current + (cur - start.current) * s, min, max);
        let hit = false;
        for (const t of [min, max, ...(snap || [])]) {
          if (Math.abs(v - t) <= SNAP_TOL) {
            v = t;
            hit = true;
            break;
          }
        }
        if (hit !== snapped) setSnapped(hit);
        onChange(Math.round(v));
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        if (snapped) setSnapped(false);
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        } catch {
          /* noop */
        }
      }}
      onDoubleClick={onReset}
      title="Drag to resize · double-click to reset"
      className={cx(
        "group/er absolute z-30 touch-none",
        horizontal ? "top-0 h-full w-2.5 cursor-col-resize" : "left-0 h-2.5 w-full cursor-row-resize",
        side === "left" && "left-0",
        side === "right" && "right-0",
        side === "top" && "top-0",
        side === "bottom" && "bottom-0"
      )}
    >
      <span
        className={cx(
          "absolute bg-accent transition-all duration-150",
          horizontal ? "inset-y-0" : "inset-x-0",
          side === "left" && "left-0",
          side === "right" && "right-0",
          side === "top" && "top-0",
          side === "bottom" && "bottom-0",
          snapped
            ? cx(horizontal ? "w-[3px]" : "h-[3px]", "opacity-100 shadow-[0_0_12px_var(--accent)]")
            : cx(horizontal ? "w-[2px]" : "h-[2px]", "opacity-0 group-hover/er:opacity-90")
        )}
      />
    </div>
  );
}

/* ---------- Dock: the single repeating panel chrome ---------- */
export function Dock({
  title,
  icon: Icon,
  action,
  children,
  className,
  bodyClass,
}: {
  title?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section
      className={cx(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel",
        className
      )}
    >
      {title && (
        <header className="flex h-9 shrink-0 items-center justify-between border-b border-line/70 px-3">
          <div className="flex items-center gap-2">
            {Icon && <Icon className="h-3.5 w-3.5 text-dim" strokeWidth={2} />}
            <h2 className="text-[11px] font-600 uppercase tracking-[0.13em] text-muted">
              {title}
            </h2>
          </div>
          {action}
        </header>
      )}
      <div className={cx("min-h-0 flex-1 overflow-auto", bodyClass ?? "p-3")}>{children}</div>
    </section>
  );
}

/* ---------- Button ---------- */
type BtnVariant = "primary" | "ghost" | "subtle" | "danger" | "good";
export function Btn({
  children,
  variant = "subtle",
  icon: Icon,
  className,
  full,
  size = "md",
  ...rest
}: {
  children?: React.ReactNode;
  variant?: BtnVariant;
  icon?: LucideIcon;
  full?: boolean;
  size?: "sm" | "md" | "lg";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants: Record<BtnVariant, string> = {
    primary:
      "bg-accent text-[var(--on-accent)] hover:bg-accent-strong font-600 border border-transparent",
    good: "bg-good text-[var(--on-accent)] hover:brightness-110 font-600 border border-transparent",
    danger: "bg-rec text-white hover:brightness-110 font-600 border border-transparent",
    ghost: "bg-transparent text-muted hover:bg-hover hover:text-ink border border-transparent",
    subtle: "bg-panel2 text-ink hover:bg-hover border border-line",
  };
  const sizes = {
    sm: "h-7 px-2.5 text-[12px] gap-1.5 rounded",
    md: "h-9 px-3.5 text-[13px] gap-2 rounded-lg",
    lg: "h-11 px-5 text-[14px] gap-2 rounded-lg",
  };
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.12 }}
      className={cx(
        "focus-ring inline-flex select-none items-center justify-center transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        full && "w-full",
        className
      )}
      {...(rest as any)}
    >
      {Icon && <Icon className={size === "lg" ? "h-[18px] w-[18px]" : "h-4 w-4"} strokeWidth={2.1} />}
      {children}
    </motion.button>
  );
}

/* ---------- Icon button ---------- */
export function IconBtn({
  icon: Icon,
  label,
  active,
  tone = "default",
  className,
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  tone?: "default" | "rec";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        "focus-ring grid h-8 w-8 place-items-center rounded-lg transition-colors duration-150 ease-out",
        active
          ? "bg-accent-soft text-accent"
          : "text-dim hover:bg-hover hover:text-ink",
        tone === "rec" && "text-rec hover:text-rec",
        className
      )}
      {...rest}
    >
      <Icon className="h-[17px] w-[17px]" strokeWidth={2} />
    </button>
  );
}

/* ---------- Toggle ---------- */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cx(
        "focus-ring relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-150 ease-out",
        checked ? "bg-accent" : "bg-line-strong",
        disabled && "cursor-not-allowed opacity-40"
      )}
    >
      {/* CSS transform transition (not framer `layout`) — a layout projection
          mis-fired into a detached, ghosted knob when the page was cross-faded on
          a fast tab switch. A plain transform is glitch-proof. */}
      <span
        className="absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ease-out"
        style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

/* ---------- Segmented control ---------- */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { label: string; value: T; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className={cx(
              "focus-ring relative rounded-[7px] font-500 transition-colors duration-150 ease-out",
              size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]",
              on ? "text-[var(--on-accent)]" : "text-muted hover:text-ink"
            )}
          >
            {/* Static per-button pill (no shared-layout projection) — a framer
                layoutId here would fly across the screen when a parent panel is
                resized mid-drag. A CSS cross-fade is glitch-proof. */}
            {on && <span className="absolute inset-0 -z-0 rounded-[7px] bg-accent animate-[fadein_.16s_ease]" />}
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Range slider ---------- */
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="ahg-range focus-ring h-1.5 w-full cursor-pointer appearance-none rounded-full"
      style={{
        background: `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-hover) ${pct}%)`,
      }}
    />
  );
}

/* ---------- Native select, styled ---------- */
export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="focus-ring h-9 w-full cursor-pointer appearance-none rounded-lg border border-line bg-panel2 px-3 pr-8 text-[13px] text-ink transition-colors hover:bg-hover"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dim"
        viewBox="0 0 16 16"
        fill="none"
      >
        <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/* ---------- Settings field row ---------- */
export function Field({
  label,
  hint,
  children,
  stacked,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cx(
        "border-b border-line/60 py-4 last:border-0",
        stacked ? "space-y-2.5" : "flex items-center justify-between gap-6"
      )}
    >
      <div className={stacked ? "" : "min-w-0"}>
        <div className="text-[13px] font-500 text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-dim">{hint}</div>}
      </div>
      <div className={stacked ? "" : "shrink-0"}>{children}</div>
    </div>
  );
}

/* ---------- Tag / chip ---------- */
export function Tag({
  children,
  tone = "neutral",
  mono,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "good" | "rec" | "warn";
  mono?: boolean;
}) {
  const tones = {
    neutral: "bg-panel2 text-muted border-line",
    accent: "bg-accent-soft text-accent border-transparent",
    good: "text-good border-transparent bg-[var(--bg-hover)]",
    rec: "bg-rec-soft text-rec border-transparent",
    warn: "text-warn border-transparent bg-[var(--bg-hover)]",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-500",
        tones[tone],
        mono && "font-mono tnum tracking-tight"
      )}
    >
      {children}
    </span>
  );
}
