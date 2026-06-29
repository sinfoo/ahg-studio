import { ChevronDown, Check, Timer } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx, timecode } from "../lib/format";
import { setSettings, useSettings } from "../store/settings";
import type { useCapture } from "../hooks/useCapture";

type Cap = ReturnType<typeof useCapture>;
type DragMode = "move" | "resize" | "crop";
interface Drag {
  mode: DragMode;
  handle: string;
  id: string;
  startCx: number;
  startCy: number;
  t0: { x: number; y: number; w: number; h: number; crop: { l: number; t: number; r: number; b: number } };
}

const HANDLES = [
  { k: "nw", x: 0, y: 0 },
  { k: "n", x: 0.5, y: 0 },
  { k: "ne", x: 1, y: 0 },
  { k: "e", x: 1, y: 0.5 },
  { k: "se", x: 1, y: 1 },
  { k: "s", x: 0.5, y: 1 },
  { k: "sw", x: 0, y: 1 },
  { k: "w", x: 0, y: 0.5 },
] as const;

const CURSORS: Record<string, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

export function PreviewStage({ cap }: { cap: Cap }) {
  const settings = useSettings();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const dragRef = useRef<Drag | null>(null);
  const [replayMenu, setReplayMenu] = useState(false);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const stageRef = useRef<HTMLDivElement>(null);
  const selBoxRef = useRef<HTMLDivElement>(null);

  // Push the live geometry straight to the canvas refs + the selection-box DOM
  // so a drag follows the cursor with zero React round-trip (instant). State is
  // committed once on pointer-up.
  function applyLive(id: string, x: number, y: number, w: number, h: number, crop?: Drag["t0"]["crop"]) {
    cap.liveTransform(id, crop ? { x, y, w, h, crop } : { x, y, w, h });
    const box = selBoxRef.current;
    if (box && scale) {
      box.style.left = `${x / scale}px`;
      box.style.top = `${y / scale}px`;
      box.style.width = `${w / scale}px`;
      box.style.height = `${h / scale}px`;
    }
  }

  // Deselect when clicking outside the preview (keep selection for the layers panel).
  useEffect(() => {
    const fn = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (stageRef.current?.contains(t)) return;
      if (t.closest?.("[data-keep-selection]")) return;
      cap.select(null);
    };
    document.addEventListener("pointerdown", fn);
    return () => document.removeEventListener("pointerdown", fn);
  }, [cap.select]);

  // Responsive: largest 16:9 box that fits the wrapper (fixes fullscreen stretch).
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const aw = el.clientWidth - 24;
      const ah = el.clientHeight - 24;
      if (aw <= 0 || ah <= 0) return;
      let w = aw;
      let h = (w * cap.CH) / cap.CW;
      if (h > ah) {
        h = ah;
        w = (h * cap.CW) / cap.CH;
      }
      setBox({ w: Math.round(w), h: Math.round(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [cap.CW, cap.CH]);

  const scale = box.w ? cap.CW / box.w : 1; // canvas units per display px
  const toCanvas = (clientX: number, clientY: number, rect: DOMRect) => ({ cx: (clientX - rect.left) * scale, cy: (clientY - rect.top) * scale });

  const selected = cap.sources.find((s) => s.id === cap.selectedId) || null;

  function onPointerDown(e: React.PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const { cx: pcx, cy: pcy } = toCanvas(e.clientX, e.clientY, rect);
    // handle hit on selected first
    if (selected && !selected.locked) {
      const hs = box.w ? 18 * scale : 18;
      const startResize = (handle: string) => {
        cap.snapshot();
        dragRef.current = { mode: e.altKey ? "crop" : "resize", handle, id: selected.id, startCx: pcx, startCy: pcy, t0: { x: selected.x, y: selected.y, w: selected.w, h: selected.h, crop: { ...selected.crop } } };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      };
      for (const h of HANDLES) {
        const hx = selected.x + selected.w * h.x;
        const hy = selected.y + selected.h * h.y;
        if (Math.abs(pcx - hx) <= hs && Math.abs(pcy - hy) <= hs) {
          startResize(h.k);
          return;
        }
      }
      // Smart border detectors: grab ANYWHERE along an edge (not just the handle).
      const m = box.w ? 12 * scale : 12;
      const inX = pcx >= selected.x - m && pcx <= selected.x + selected.w + m;
      const inY = pcy >= selected.y - m && pcy <= selected.y + selected.h + m;
      let edge = "";
      if (inX && Math.abs(pcy - selected.y) <= m) edge += "n";
      if (inX && Math.abs(pcy - (selected.y + selected.h)) <= m) edge += "s";
      if (inY && Math.abs(pcx - selected.x) <= m) edge += "w";
      if (inY && Math.abs(pcx - (selected.x + selected.w)) <= m) edge += "e";
      if (edge) {
        startResize(edge);
        return;
      }
    }
    // hit-test sources front→back
    const ordered = [...cap.sources].sort((a, b) => b.z - a.z);
    const hit = ordered.find((s) => s.visible && !s.locked && pcx >= s.x && pcx <= s.x + s.w && pcy >= s.y && pcy <= s.y + s.h);
    if (hit) {
      cap.select(hit.id);
      cap.snapshot();
      dragRef.current = { mode: "move", handle: "", id: hit.id, startCx: pcx, startCy: pcy, t0: { x: hit.x, y: hit.y, w: hit.w, h: hit.h, crop: { ...hit.crop } } };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } else {
      cap.select(null);
    }
  }

  // Snap a moving box's edges/centers to canvas + other sources; returns adjusted x/y + guides.
  function snap(x: number, y: number, w: number, h: number, id: string) {
    const T = 10 * scale;
    const others = cap.sources.filter((s) => s.id !== id && s.visible);
    const vt = [0, cap.CW / 2, cap.CW, ...others.flatMap((s) => [s.x, s.x + s.w / 2, s.x + s.w])];
    const ht = [0, cap.CH / 2, cap.CH, ...others.flatMap((s) => [s.y, s.y + s.h / 2, s.y + s.h])];
    const gv: number[] = [];
    const gh: number[] = [];
    for (const [val, off] of [[x, 0], [x + w / 2, w / 2], [x + w, w]] as const) {
      for (const t of vt) {
        if (Math.abs(val - t) <= T) {
          x = t - off;
          gv.push(t);
          break;
        }
      }
    }
    for (const [val, off] of [[y, 0], [y + h / 2, h / 2], [y + h, h]] as const) {
      for (const t of ht) {
        if (Math.abs(val - t) <= T) {
          y = t - off;
          gh.push(t);
          break;
        }
      }
    }
    return { x, y, gv, gh };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const { cx: pcx, cy: pcy } = toCanvas(e.clientX, e.clientY, rect);
    const dx = pcx - d.startCx;
    const dy = pcy - d.startCy;
    const t = d.t0;
    if (d.mode === "move") {
      const s = snap(t.x + dx, t.y + dy, t.w, t.h, d.id);
      setGuidesMaybe(s.gv, s.gh);
      applyLive(d.id, Math.round(s.x), Math.round(s.y), t.w, t.h);
      return;
    }
    const left = d.handle.includes("w");
    const right = d.handle.includes("e");
    const top = d.handle.includes("n");
    const bottom = d.handle.includes("s");
    if (d.mode === "crop") {
      const crop = { ...t.crop };
      let { x, y, w, h } = t;
      const visW = 1 - t.crop.l - t.crop.r || 1;
      const visH = 1 - t.crop.t - t.crop.b || 1;
      if (right) {
        const f = (-dx / t.w) * visW;
        crop.r = clamp(t.crop.r + f, 0, 0.95);
        w = Math.max(40, t.w + dx);
      }
      if (left) {
        const f = (dx / t.w) * visW;
        crop.l = clamp(t.crop.l + f, 0, 0.95);
        x = t.x + dx;
        w = Math.max(40, t.w - dx);
      }
      if (bottom) {
        const f = (-dy / t.h) * visH;
        crop.b = clamp(t.crop.b + f, 0, 0.95);
        h = Math.max(40, t.h + dy);
      }
      if (top) {
        const f = (dy / t.h) * visH;
        crop.t = clamp(t.crop.t + f, 0, 0.95);
        y = t.y + dy;
        h = Math.max(40, t.h - dy);
      }
      applyLive(d.id, Math.round(x), Math.round(y), Math.round(w), Math.round(h), crop);
      return;
    }
    // resize
    const corner = (left || right) && (top || bottom);
    let { x, y, w, h } = t;
    if (corner && !e.shiftKey) {
      const ar = t.w / t.h || 16 / 9;
      let nw = t.w + (right ? dx : -dx);
      nw = Math.max(40, nw);
      let nh = nw / ar;
      if (left) x = t.x + (t.w - nw);
      if (top) y = t.y + (t.h - nh);
      w = nw;
      h = nh;
    } else {
      if (left) {
        w = t.w - dx;
        x = t.x + dx;
      }
      if (right) w = t.w + dx;
      if (top) {
        h = t.h - dy;
        y = t.y + dy;
      }
      if (bottom) h = t.h + dy;
      w = Math.max(40, w);
      h = Math.max(40, h);
    }
    applyLive(d.id, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  // Avoid a re-render on every move — only when the snap-guide set changes.
  function setGuidesMaybe(v: number[], h: number[]) {
    setGuides((g) => (g.v.length === v.length && g.h.length === h.length && g.v.every((x, i) => x === v[i]) && g.h.every((y, i) => y === h[i]) ? g : { v, h }));
  }

  function endDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (d) {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      dragRef.current = null;
      setGuides({ v: [], h: [] });
      // Commit the live-mutated geometry to React state (single re-render).
      const cur = cap.sources.find((s) => s.id === d.id);
      if (cur) cap.updateTransform(d.id, { x: cur.x, y: cur.y, w: cur.w, h: cur.h, crop: { ...cur.crop } });
    }
  }

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && cap.selectedId && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        cap.removeSource(cap.selectedId);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [cap.removeSource, cap.selectedId]);

  const replayLabel = (n: number) => (n < 60 ? `${n}s` : `${n / 60}m`);

  return (
    <div ref={wrapRef} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg border border-line bg-sunken p-3">
      <div ref={stageRef} className="relative" style={{ width: box.w || "100%", height: box.h || "100%" }}>
        <canvas ref={cap.attachCanvas} className="absolute inset-0 h-full w-full rounded-lg" />

        {/* snap guides */}
        {guides.v.map((g, i) => (
          <span key={`v${i}`} className="pointer-events-none absolute top-0 z-20 h-full w-px bg-accent/80" style={{ left: g / scale }} />
        ))}
        {guides.h.map((g, i) => (
          <span key={`h${i}`} className="pointer-events-none absolute left-0 z-20 h-px w-full bg-accent/80" style={{ top: g / scale }} />
        ))}

        {/* interaction overlay */}
        <div
          className="absolute inset-0"
          style={{ cursor: dragRef.current?.mode === "move" ? "grabbing" : "default" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          {selected && box.w > 0 && (
            <div
              ref={selBoxRef}
              className="pointer-events-none absolute border-[1.5px] border-accent"
              style={{ left: selected.x / scale, top: selected.y / scale, width: selected.w / scale, height: selected.h / scale }}
            >
              {HANDLES.map((h) => (
                <span
                  key={h.k}
                  className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-accent bg-white shadow"
                  style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, cursor: CURSORS[h.k] }}
                />
              ))}
            </div>
          )}
        </div>

        {/* empty state */}
        {!cap.previewing && (
          <div className="absolute inset-0 grid place-items-center rounded-lg">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-[13px] text-muted">{cap.error ?? "No sources yet"}</p>
              <p className="text-[11.5px] text-dim">Click + in Sources to add a screen, window, camera, image, video or text.</p>
            </div>
          </div>
        )}

        {/* HUD */}
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
          {cap.recording ? (
            <span className="rec-dot flex items-center gap-2 rounded-full bg-black/55 px-2.5 py-1 backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-rec" />
              <span className="font-mono text-[12px] font-700 text-white tnum">{timecode(cap.elapsed)}</span>
              {cap.paused && <span className="text-[10px] font-600 uppercase text-white/70">paused</span>}
            </span>
          ) : (
            cap.previewing && <span className="rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-500 text-white/80 backdrop-blur">Preview</span>
          )}
          {settings.replayEnabled && !cap.recording && (
            <div className="pointer-events-auto relative">
              <button onClick={() => setReplayMenu((m) => !m)} className="focus-ring flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 backdrop-blur hover:bg-black/70">
                <Timer className="h-3 w-3 text-accent" strokeWidth={2.5} />
                <span className="text-[11px] font-600 text-white/90">Replay {replayLabel(settings.replaySeconds)}</span>
                <ChevronDown className="h-3 w-3 text-white/60" strokeWidth={2.5} />
              </button>
              {replayMenu && (
                <div className="absolute left-0 top-full z-20 mt-1.5 w-36 rounded-lg border border-line bg-panel/95 p-1 shadow-[var(--shadow-pop)] backdrop-blur">
                  {[15, 30, 60, 120, 180, 300, 600].map((n) => (
                    <button
                      key={n}
                      onClick={() => {
                        setSettings({ replaySeconds: n });
                        setReplayMenu(false);
                      }}
                      className={cx("focus-ring flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[12px]", settings.replaySeconds === n ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-ink")}
                    >
                      {replayLabel(n)}
                      {settings.replaySeconds === n && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {cap.previewing && (
          <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-line bg-black/50 px-2 py-0.5 font-mono text-[11px] text-white/80 backdrop-blur tnum">
            {cap.CW}×{cap.CH} · {cap.stats.fps || settings.fps} FPS
          </div>
        )}
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
