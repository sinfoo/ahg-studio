import { motion } from "framer-motion";
import { Check, Pipette } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "../lib/format";

/* ============================================================================
   ColorPopover — a premium, advanced color picker popover.

   Self-contained: HSV<->RGB<->HEX math lives here as small pure helpers so the
   2D saturation/value field, the hue rail, the hex field, the RGB readout, the
   native eyedropper, the preset swatches and the session "recent colors" rail
   all share one source of truth. Live `onChange` fires on every adjust so the
   editor preview updates in real time; the committed value is pushed into the
   module-level recents on close / preset / eyedropper pick.
============================================================================ */

/* ---------- session recents (module scope: survive remounts) ---------- */
const RECENTS_MAX = 8;
const recents: string[] = [];
function pushRecent(hex: string) {
  const v = hex.toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(v)) return;
  const i = recents.indexOf(v);
  if (i !== -1) recents.splice(i, 1);
  recents.unshift(v);
  if (recents.length > RECENTS_MAX) recents.length = RECENTS_MAX;
}

/* ---------- color math (pure) ---------- */
type RGB = { r: number; g: number; b: number };
type HSV = { h: number; s: number; v: number };

function clamp01(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function clampByte(n: number) {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (/^[0-9a-f]{6}$/.test(s)) return "#" + s;
  return null;
}

function hexToRgb(hex: string): RGB {
  const h = (normalizeHex(hex) ?? "#ffffff").slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  const to = (n: number) => clampByte(n).toString(16).padStart(2, "0");
  return "#" + to(r) + to(g) + to(b);
}

function rgbToHsv({ r, g, b }: RGB): HSV {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  if (h < 60) [rr, gg, bb] = [c, x, 0];
  else if (h < 120) [rr, gg, bb] = [x, c, 0];
  else if (h < 180) [rr, gg, bb] = [0, c, x];
  else if (h < 240) [rr, gg, bb] = [0, x, c];
  else if (h < 300) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];
  return { r: (rr + m) * 255, g: (gg + m) * 255, b: (bb + m) * 255 };
}

function hsvToHex(hsv: HSV): string {
  return rgbToHex(hsvToRgb(hsv));
}

/* ---------- presets ---------- */
const PRESETS = [
  "#ffffff",
  "#000000",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

/* ---------- component ---------- */
export function ColorPopover({
  value,
  onChange,
  onClose,
  x,
  y,
}: {
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  x: number;
  y: number;
}) {
  // Seed HSV from the incoming value (or a neutral white when "none").
  const seed = useMemo(() => normalizeHex(value) ?? "#ffffff", [value]);
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(seed)));
  // Free-text mirror for the hex field so a user can type partial input.
  const [hexText, setHexText] = useState<string>(seed);
  const committed = useRef<string>(normalizeHex(value) ?? "");

  const rgb = useMemo(() => hsvToRgb(hsv), [hsv]);
  const hex = useMemo(() => rgbToHex(rgb), [rgb]);
  const hueHex = useMemo(() => hsvToHex({ h: hsv.h, s: 1, v: 1 }), [hsv.h]);

  // Live commit helper: update state, mirror hex text, fire onChange.
  const apply = useCallback(
    (next: HSV) => {
      setHsv(next);
      const nx = hsvToHex(next);
      setHexText(nx);
      committed.current = nx;
      onChange(nx);
    },
    [onChange]
  );

  // Apply a finished hex (preset / eyedropper / valid typed value) + recent.
  const applyHex = useCallback(
    (raw: string) => {
      const nx = normalizeHex(raw);
      if (!nx) return;
      const nextHsv = rgbToHsv(hexToRgb(nx));
      setHsv(nextHsv);
      setHexText(nx);
      committed.current = nx;
      pushRecent(nx);
      onChange(nx);
    },
    [onChange]
  );

  /* ----- outside pointerdown + Esc close ----- */
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  /* ----- commit current value into recents on unmount ----- */
  useEffect(() => {
    return () => {
      if (committed.current) pushRecent(committed.current);
    };
  }, []);

  /* ----- saturation / value field drag ----- */
  const svRef = useRef<HTMLDivElement | null>(null);
  const svDragging = useRef(false);
  const svPointer = useRef<number | null>(null);
  const updateSV = useCallback(
    (clientX: number, clientY: number) => {
      const el = svRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const s = clamp01((clientX - r.left) / r.width);
      const v = clamp01(1 - (clientY - r.top) / r.height);
      apply({ h: hsv.h, s, v });
    },
    [apply, hsv.h]
  );

  /* ----- hue rail drag ----- */
  const hueRef = useRef<HTMLDivElement | null>(null);
  const hueDragging = useRef(false);
  const huePointer = useRef<number | null>(null);
  const updateHue = useCallback(
    (clientX: number) => {
      const el = hueRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const h = clamp01((clientX - r.left) / r.width) * 360;
      apply({ h, s: hsv.s, v: hsv.v });
    },
    [apply, hsv.s, hsv.v]
  );

  // Release any captured pointers if we unmount mid-drag (leak-free).
  useEffect(() => {
    return () => {
      const sv = svRef.current;
      const hue = hueRef.current;
      if (sv && svPointer.current != null) {
        try {
          sv.releasePointerCapture(svPointer.current);
        } catch {
          /* noop */
        }
      }
      if (hue && huePointer.current != null) {
        try {
          hue.releasePointerCapture(huePointer.current);
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;
  const pickEyeDropper = useCallback(async () => {
    if (!hasEyeDropper) return;
    try {
      const Ctor = (window as any).EyeDropper;
      const res = await new Ctor().open();
      if (res && typeof res.sRGBHex === "string") applyHex(res.sRGBHex);
    } catch {
      /* user cancelled — ignore */
    }
  }, [hasEyeDropper, applyHex]);

  const onHexInput = (raw: string) => {
    setHexText(raw);
    const nx = normalizeHex(raw);
    if (nx) {
      const nextHsv = rgbToHsv(hexToRgb(nx));
      setHsv(nextHsv);
      committed.current = nx;
      onChange(nx);
    }
  };

  const setChannel = (ch: keyof RGB, raw: string) => {
    const n = clampByte(Number(raw) || 0);
    applyHexQuiet({ ...rgb, [ch]: n });
  };
  // RGB nudges shouldn't spam recents on every keystroke — commit live only.
  const applyHexQuiet = (next: RGB) => {
    const nx = rgbToHex(next);
    const nextHsv = rgbToHsv(next);
    setHsv(nextHsv);
    setHexText(nx);
    committed.current = nx;
    onChange(nx);
  };

  const left = Math.max(8, Math.min(x, window.innerWidth - 260));
  const top = Math.max(8, Math.min(y, window.innerHeight - 320));

  const dotLeft = `${hsv.s * 100}%`;
  const dotTop = `${(1 - hsv.v) * 100}%`;
  const hueLeft = `${(hsv.h / 360) * 100}%`;

  const sessionRecents = recents.slice(0, RECENTS_MAX);

  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-[70] w-[248px] select-none rounded-xl border border-line bg-[var(--bg-elevated,#1a1b22)] p-3 shadow-[0_10px_30px_oklch(0_0_0_/_0.5)] ring-1 ring-black/40"
      style={{ left, top }}
    >
      {/* saturation / value field */}
      <div
        ref={svRef}
        onPointerDown={(e) => {
          e.preventDefault();
          svDragging.current = true;
          svPointer.current = e.pointerId;
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* noop */
          }
          updateSV(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (svDragging.current) updateSV(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          svDragging.current = false;
          svPointer.current = null;
          try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          } catch {
            /* noop */
          }
          if (committed.current) pushRecent(committed.current);
        }}
        className="relative h-[140px] w-full cursor-crosshair touch-none overflow-hidden rounded-lg ring-1 ring-black/30"
        style={{ backgroundColor: hueHex }}
      >
        {/* white -> transparent (left to right) then transparent -> black (top to bottom) */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to right, #fff, rgba(255,255,255,0))" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, #000, rgba(0,0,0,0))" }} />
        <span
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_oklch(0_0_0_/_0.5),0_1px_4px_oklch(0_0_0_/_0.6)]"
          style={{ left: dotLeft, top: dotTop, backgroundColor: hex }}
        />
      </div>

      {/* hue rail */}
      <div
        ref={hueRef}
        onPointerDown={(e) => {
          e.preventDefault();
          hueDragging.current = true;
          huePointer.current = e.pointerId;
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* noop */
          }
          updateHue(e.clientX);
        }}
        onPointerMove={(e) => {
          if (hueDragging.current) updateHue(e.clientX);
        }}
        onPointerUp={(e) => {
          hueDragging.current = false;
          huePointer.current = null;
          try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          } catch {
            /* noop */
          }
          if (committed.current) pushRecent(committed.current);
        }}
        className="relative mt-3 h-3 w-full cursor-pointer touch-none rounded-full ring-1 ring-black/30"
        style={{
          background:
            "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
        }}
      >
        <span
          className="pointer-events-none absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_oklch(0_0_0_/_0.5),0_1px_4px_oklch(0_0_0_/_0.6)]"
          style={{ left: hueLeft, backgroundColor: hueHex }}
        />
      </div>

      {/* preview + hex + eyedropper */}
      <div className="mt-3 flex items-center gap-2">
        <div
          className="h-9 w-9 shrink-0 rounded-lg ring-1 ring-black/40"
          style={{ backgroundColor: hex }}
          title={hex}
        />
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] font-600 text-dim">#</span>
          <input
            value={hexText.replace(/^#/, "")}
            onChange={(e) => onHexInput(e.target.value)}
            onBlur={() => setHexText(hex)}
            spellCheck={false}
            maxLength={6}
            aria-label="Hex color"
            className="focus-ring h-9 w-full rounded-lg border border-line bg-panel2 pl-5 pr-2 font-mono text-[12.5px] uppercase tracking-tight text-ink transition-colors hover:bg-hover"
          />
        </div>
        <button
          type="button"
          onClick={pickEyeDropper}
          disabled={!hasEyeDropper}
          aria-label="Pick color from screen"
          title={hasEyeDropper ? "Pick color from screen" : "Eyedropper not available"}
          className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-panel2 text-muted transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Pipette className="h-[17px] w-[17px]" strokeWidth={2} />
        </button>
      </div>

      {/* RGB readout / inputs */}
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {(["r", "g", "b"] as const).map((ch) => (
          <label key={ch} className="flex items-center gap-1.5">
            <span className="w-3 text-[11px] font-600 uppercase text-dim">{ch}</span>
            <input
              type="number"
              min={0}
              max={255}
              value={Math.round(rgb[ch])}
              onChange={(e) => setChannel(ch, e.target.value)}
              aria-label={`${ch.toUpperCase()} channel`}
              className="focus-ring h-7 w-full min-w-0 rounded-md border border-line bg-panel2 px-1.5 text-center font-mono text-[11.5px] tnum text-ink transition-colors hover:bg-hover"
            />
          </label>
        ))}
      </div>

      {/* presets */}
      <div className="mt-3">
        <div className="mb-1.5 text-[10px] font-700 uppercase tracking-wider text-dim">Presets</div>
        <div className="grid grid-cols-12 gap-1">
          {PRESETS.map((p) => (
            <Swatch key={p} color={p} active={p === hex} onPick={() => applyHex(p)} />
          ))}
        </div>
      </div>

      {/* recent colors */}
      <div className="mt-3">
        <div className="mb-1.5 text-[10px] font-700 uppercase tracking-wider text-dim">Recent</div>
        {sessionRecents.length > 0 ? (
          <div className="grid grid-cols-12 gap-1">
            {sessionRecents.map((p, i) => (
              <Swatch key={p + i} color={p} active={p === hex} onPick={() => applyHex(p)} />
            ))}
          </div>
        ) : (
          <div className="text-[11px] leading-snug text-dim">No recent colors yet.</div>
        )}
      </div>
    </motion.div>
  );
}

/* ---------- swatch cell ---------- */
function Swatch({ color, active, onPick }: { color: string; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={color}
      title={color}
      className={cx(
        "focus-ring relative grid aspect-square w-full place-items-center rounded-md ring-1 transition-transform duration-100 ease-out hover:scale-110",
        active ? "ring-2 ring-accent" : "ring-black/40"
      )}
      style={{ backgroundColor: color }}
    >
      {active && (
        <Check
          className="h-3 w-3 drop-shadow-[0_1px_2px_oklch(0_0_0_/_0.7)]"
          strokeWidth={3}
          style={{ color: color.toLowerCase() === "#ffffff" || color.toLowerCase() === "#eab308" ? "#000" : "#fff" }}
        />
      )}
    </button>
  );
}
