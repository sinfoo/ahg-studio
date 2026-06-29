import {
  BarChart3,
  Check,
  Clock,
  FileVideo,
  Gauge,
  HardDrive,
  ListChecks,
  Pencil,
  Play,
  Sparkles,
  UploadCloud,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { Pause } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Btn, Dock, Field, ResizeHandle, Segmented, Select, Slider, Tag, Toggle } from "../components/ui";
import { isElectron, studio, type FileRef, type HwEncoders } from "../lib/bridge";
import { clamp, cx, mb, timecode } from "../lib/format";
import { runOptimize, useOptimize } from "../store/optimize";
import { getLibrary, refreshLibrary, useLibrary } from "../store/library";
import { setSettings, useSettings } from "../store/settings";

const hwName = (enc: string | null | undefined) =>
  !enc ? null : enc.includes("nvenc") ? "NVENC" : enc.includes("qsv") ? "Intel QuickSync" : enc.includes("amf") ? "AMD AMF" : enc.includes("videotoolbox") ? "VideoToolbox" : enc;

type Codec = "h264" | "hevc" | "av1";
type ResMode = "same" | "1080" | "720";
type Preset = "fast" | "balanced" | "max";
type Mode = "quality" | "size";
type Format = "mp4" | "mkv" | "webm" | "mov" | "gif";

interface QItem {
  id: string;
  name: string;
  sizeMb: number;
  codec: string;
  path?: string;
}

const CODEC_FACTOR: Record<Codec, number> = { h264: 1, hevc: 0.6, av1: 0.46 };
const FORMAT_FACTOR: Record<Format, number> = { mp4: 1, mov: 1, mkv: 1, webm: 0.85, gif: 4 };
const RES_FACTOR: Record<ResMode, number> = { same: 1, "1080": 0.56, "720": 0.32 };

const fileUrl = (p?: string) => (p ? "file:///" + p.replace(/\\/g, "/") : "");
const dropPath = (f: File): string => studio?.pathForFile?.(f) || (f as File & { path?: string }).path || "";

const OPT_LAYOUT_KEY = "ahg.opt.layout.v1";
function loadOptLayout(): { source: number; settings: number } {
  try {
    return { source: 268, settings: 326, ...JSON.parse(localStorage.getItem(OPT_LAYOUT_KEY) || "{}") };
  } catch {
    return { source: 268, settings: 326 };
  }
}

export function Optimize({ incoming }: { incoming: FileRef | null }) {
  const defaults = useSettings();
  const [layout, setLayout] = useState(loadOptLayout);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(OPT_LAYOUT_KEY, JSON.stringify(layout));
      } catch {
        /* noop */
      }
    }, 250);
    return () => clearTimeout(id);
  }, [layout]);
  const [queue, setQueue] = useState<QItem[]>([]);
  const [selId, setSelId] = useState<string>("");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [over, setOver] = useState(false);
  // Multi-selection for batch optimize (marquee + ctrl/shift-click). `selId` stays
  // the previewed item; `marked` is the set the batch queue processes.
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const lastClicked = useRef<string | null>(null);
  const marqueeDrag = useRef<null | { ox: number; oy: number; base: Set<string>; items: { id: string; rect: DOMRect }[]; pid: number }>(null);
  const marqueeRaf = useRef<number | null>(null);
  const [batch, setBatch] = useState<{ total: number; done: number } | null>(null);
  const addSourcePath = (p: string, name: string) => {
    const item: QItem = { id: p, name, sizeMb: 0, codec: "—", path: p };
    setQueue((q) => (q.some((i) => i.id === item.id) ? q : [item, ...q]));
    setSelId(p);
  };

  // The recordings list is warmed into a shared cache during the splash, so seed
  // the queue from it SYNCHRONOUSLY (no empty→populate flash / "rendering"), then
  // kick a background refresh. `lib` (subscribed) keeps it live as recordings are
  // added or the cache refreshes.
  const lib = useLibrary();
  useEffect(() => {
    if (!isElectron || !studio) return;
    const files = getLibrary();
    if (files.length) {
      const items: QItem[] = files.map((f) => ({ id: f.path, name: f.name, sizeMb: f.sizeMb, codec: f.codec, path: f.path }));
      setQueue(items);
      setSelId((cur) => (items.some((i) => i.id === cur) ? cur : items[0]?.id ?? ""));
    }
    refreshLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!lib.length) return;
    const items: QItem[] = lib.map((f) => ({ id: f.path, name: f.name, sizeMb: f.sizeMb, codec: f.codec, path: f.path }));
    setQueue((q) => {
      // Preserve any user-added/incoming items not in the library list.
      const extra = q.filter((i) => !items.some((x) => x.id === i.id) && !lib.some((f) => f.path === i.id));
      return [...extra, ...items];
    });
    setSelId((cur) => (cur ? cur : items[0]?.id ?? ""));
  }, [lib]);

  useEffect(() => {
    if (!incoming) return;
    const item: QItem = { id: incoming.path ?? incoming.name, name: incoming.name, sizeMb: incoming.sizeMb ?? 0, codec: "—", path: incoming.path };
    setQueue((q) => (q.some((i) => i.id === item.id) ? q : [item, ...q]));
    setSelId(item.id);
  }, [incoming]);

  // thumbnails for the source list (small concurrency pool, disk-cached in main)
  useEffect(() => {
    const api = studio;
    if (!api) return;
    let cancelled = false;
    const todo = queue.filter((q) => q.path && !thumbs[q.id]);
    let i = 0;
    let active = 0;
    const pump = () => {
      if (cancelled) return;
      while (active < 3 && i < todo.length) {
        const it = todo[i++];
        active++;
        api.generateThumb(it.path!).then((d) => !cancelled && d && setThumbs((t) => ({ ...t, [it.id]: d }))).finally(() => {
          active--;
          pump();
        });
      }
    };
    pump();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  const sel = queue.find((q) => q.id === selId);

  const [mode, setMode] = useState<Mode>("quality");
  const [quality, setQuality] = useState(defaults.quality);
  const [targetMb, setTargetMb] = useState(400);
  const [codec, setCodec] = useState<Codec>(defaults.codec);
  const [res, setRes] = useState<ResMode>(defaults.scale);
  const [preset, setPreset] = useState<Preset>(defaults.preset);
  const [format, setFormat] = useState<Format>(defaults.optFormat);
  const [fpsCap, setFpsCap] = useState<number>(0); // 0 = keep source
  const [mute, setMute] = useState(false);
  const [audioKbps, setAudioKbps] = useState(160);
  const [stripMeta, setStripMeta] = useState(true);
  const [saveName, setSaveName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hwAccel, setHwAccel] = useState(defaults.hwAccel);
  const [hw, setHw] = useState<HwEncoders | null>(null);
  // Probe the GPU encoders once when the page mounts (cached in main).
  useEffect(() => {
    studio?.detectHwEncoders?.().then(setHw).catch(() => {});
  }, []);
  // Cancel any pending marquee frame on unmount.
  useEffect(() => () => {
    if (marqueeRaf.current != null) cancelAnimationFrame(marqueeRaf.current);
  }, []);
  const hwForCodec = hw ? hw[codec] : null;
  const hwAvailable = format !== "gif" && format !== "webm" && !!hwForCodec;
  const opt = useOptimize();
  const running = opt.running;
  // Scope the "done" result to the CURRENTLY-selected source so a different clip
  // never shows another clip's optimized size / Reveal button. The store's `label`
  // holds the source name (batch) or the output save-name (single optimize), so
  // match either against the selected item.
  const done = opt.done && !!opt.output && !!sel && (opt.label === sel.name || opt.label === saveName);

  useEffect(() => {
    setSaveName(sel ? sel.name.replace(/\.[^.]+$/, "") + "-optimized" : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  const srcMb = sel?.sizeMb ?? 0;
  const qualityFactor = 0.18 + (quality / 100) * 0.82;
  const estimated =
    mode === "quality"
      ? Math.round(srcMb * CODEC_FACTOR[codec] * RES_FACTOR[res] * qualityFactor * FORMAT_FACTOR[format])
      : Math.min(targetMb, srcMb);
  const outMb = done && opt.outputSize ? opt.outputSize : estimated;
  const saved = clamp(srcMb ? 1 - outMb / srcMb : 0, -2, 0.97);
  const vmaf = Math.min(99.4, 79 + quality * 0.2 + (codec === "av1" ? 1.2 : 0));
  const lossless = vmaf >= 95 && format !== "gif";
  const etaMin = (srcMb / 1024) * (preset === "fast" ? 0.5 : preset === "balanced" ? 1.1 : 2.4);

  async function rename() {
    if (!studio || !sel?.path) return;
    const r = await studio.renameRecording(sel.path, saveName);
    if (r.ok && r.path) {
      const np = r.path;
      const nn = np.split(/[\\/]/).pop() || saveName;
      setQueue((q) => q.map((i) => (i.id === sel.id ? { ...i, id: np, name: nn, path: np } : i)));
      setSelId(np);
    } else setError(r.error ?? "Rename failed.");
  }

  async function browse() {
    if (!studio) return;
    const f = await studio.pickFile();
    if (!f) return;
    const item: QItem = { id: f.path, name: f.name, sizeMb: f.sizeMb, codec: "—", path: f.path };
    setQueue((q) => (q.some((i) => i.id === item.id) ? q : [item, ...q]));
    setSelId(item.id);
  }

  // Shared encode options so single + batch optimize behave identically.
  const encodeOpts = (input: string, outputName: string) => ({
    input,
    codec,
    quality,
    scale: res,
    preset,
    format,
    outputName,
    hwAccel: hwAccel && hwAvailable,
    fps: fpsCap,
    mute,
    audioKbps,
    stripMeta,
  });

  async function handleOptimize() {
    if (done && opt.output) {
      studio?.reveal(opt.output);
      return;
    }
    if (!isElectron || !studio || !sel?.path) return;
    setError(null);
    await runOptimize(encodeOpts(sel.path, saveName), saveName);
  }

  // Batch: run every marked item through the encoder in sequence, surfacing
  // per-item progress (via the shared optimize store) + an overall N/total.
  async function optimizeBatch() {
    if (!isElectron || !studio || batch) return;
    const items = [...marked].map((id) => queue.find((q) => q.id === id)).filter((q): q is QItem => !!q?.path);
    if (!items.length) return;
    setError(null);
    setBatch({ total: items.length, done: 0 });
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const out = it.name.replace(/\.[^.]+$/, "") + "-optimized";
      // eslint-disable-next-line no-await-in-loop
      await runOptimize(encodeOpts(it.path!, out), it.name);
      setBatch({ total: items.length, done: i + 1 });
    }
    setBatch(null);
    setMarked(new Set());
  }

  // ---- source multi-selection (ctrl/shift-click + marquee), mirrors the bin ----
  const orderIds = queue.map((q) => q.id);
  const selectItem = (id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    setSelId(id);
    if (e.ctrlKey || e.metaKey) {
      setMarked((p) => {
        const n = new Set(p);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      });
      lastClicked.current = id;
    } else if (e.shiftKey && lastClicked.current) {
      const a = orderIds.indexOf(lastClicked.current);
      const b = orderIds.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
        setMarked((p) => {
          const n = new Set(p);
          for (let i = lo; i <= hi; i++) n.add(orderIds[i]);
          return n;
        });
      }
    } else {
      setMarked(new Set([id]));
      lastClicked.current = id;
    }
  };
  function marqueeDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("[data-sel-id]")) return; // let the card handle it
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!additive) setMarked(new Set());
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    // Cache every card's rect ONCE at drag start — they don't move during a
    // marquee drag, so re-measuring on every pointermove was pure layout thrash.
    const items = listRef.current
      ? Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-sel-id]"))
          .map((node) => ({ id: node.dataset.selId, rect: node.getBoundingClientRect() }))
          .filter((it): it is { id: string; rect: DOMRect } => !!it.id)
      : [];
    marqueeDrag.current = { ox: e.clientX, oy: e.clientY, base: additive ? new Set(marked) : new Set(), items, pid: e.pointerId };
  }
  function marqueeMove(e: React.PointerEvent) {
    const d = marqueeDrag.current;
    if (!d) return;
    const clientX = e.clientX, clientY = e.clientY;
    // Coalesce state updates to one per frame — pointermove fires far faster than
    // we can usefully re-render.
    if (marqueeRaf.current != null) return;
    marqueeRaf.current = requestAnimationFrame(() => {
      marqueeRaf.current = null;
      const x0 = Math.min(d.ox, clientX), y0 = Math.min(d.oy, clientY);
      const x1 = Math.max(d.ox, clientX), y1 = Math.max(d.oy, clientY);
      setMarquee({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      const hits = new Set<string>(d.base);
      for (const { id, rect: r } of d.items) {
        if (r.left < x1 && r.right > x0 && r.top < y1 && r.bottom > y0) hits.add(id);
      }
      setMarked(hits);
    });
  }
  function marqueeUp(e: React.PointerEvent) {
    if (marqueeDrag.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(marqueeDrag.current.pid);
      } catch {
        /* noop */
      }
    }
    if (marqueeRaf.current != null) {
      cancelAnimationFrame(marqueeRaf.current);
      marqueeRaf.current = null;
    }
    marqueeDrag.current = null;
    setMarquee(null);
  }

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-3 flex items-end justify-between px-1">
        <div>
          <h1 className="text-[20px] font-700 tracking-tight text-ink">Optimize</h1>
          <p className="mt-0.5 text-[13px] text-muted">Shrink recordings dramatically with no visible quality loss.</p>
        </div>
        <Tag tone="accent" mono>
          <Sparkles className="h-3 w-3" /> Smart encode
        </Tag>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* source */}
        <div style={{ width: layout.source }} className="min-h-0 shrink-0">
        <Dock title="Source" className="h-full w-full" bodyClass="p-2.5">
        <div
          className={cx("relative flex min-h-full flex-col rounded-lg transition-colors", over && "outline-2 outline-dashed -outline-offset-2 outline-accent")}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              if (!over) setOver(true);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            for (const f of Array.from(e.dataTransfer.files || [])) {
              const p = dropPath(f);
              if (p) addSourcePath(p, f.name);
            }
          }}
        >
          {over && (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg bg-accent-soft/70 backdrop-blur-[1px]">
              <span className="flex flex-col items-center gap-1 text-accent">
                <UploadCloud className="h-6 w-6" strokeWidth={2} />
                <span className="text-[12px] font-700">Drop to add</span>
              </span>
            </div>
          )}
          <button
            onClick={browse}
            className="focus-ring mb-2.5 flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-line-strong bg-sunken py-5 text-center transition-colors hover:border-accent hover:bg-hover"
          >
            <UploadCloud className="h-5 w-5 text-dim" strokeWidth={2} />
            <span className="text-[12.5px] font-500 text-muted">
              Drop video anywhere here or <span className="text-accent">browse</span>
            </span>
            <span className="text-[11px] text-dim">mp4 · mkv · mov · webm</span>
          </button>
          {/* batch bar — appears once more than one source is marked */}
          {marked.size > 1 && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft/50 px-2.5 py-1.5">
              <ListChecks className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.2} />
              <span className="text-[12px] font-700 text-ink">{marked.size} queued</span>
              <div className="ml-auto flex items-center gap-1.5">
                <Btn size="sm" variant="primary" icon={Sparkles} disabled={!!batch || running} onClick={optimizeBatch}>
                  {batch ? `${batch.done}/${batch.total}` : "Optimize all"}
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => setMarked(new Set())}>
                  Clear
                </Btn>
              </div>
            </div>
          )}
          <ul ref={listRef} onPointerDown={marqueeDown} onPointerMove={marqueeMove} onPointerUp={marqueeUp} className="relative flex-1 space-y-1.5">
            {queue.map((q) => {
              const on = q.id === selId;
              const isMarked = marked.has(q.id);
              return (
                <li key={q.id} data-sel-id={q.id}>
                  <button
                    onClick={(e) => selectItem(q.id, e)}
                    className={cx(
                      "focus-ring flex w-full items-center gap-2.5 rounded-lg border p-1.5 text-left transition-colors",
                      isMarked ? "border-accent bg-accent-soft" : on ? "border-accent/50 bg-accent-soft/60" : "border-line/60 hover:border-line-strong hover:bg-hover"
                    )}
                  >
                    <span className="relative aspect-video w-[68px] shrink-0 overflow-hidden rounded-md bg-black">
                      {thumbs[q.id] ? (
                        <img src={thumbs[q.id]} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full place-items-center text-dim">
                          <FileVideo className="h-4 w-4" strokeWidth={2} />
                        </span>
                      )}
                      {on && <span className="absolute inset-0 ring-2 ring-inset ring-accent" />}
                      {isMarked && (
                        <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-accent text-[var(--on-accent)] shadow">
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-500 text-ink">{q.name}</span>
                      <span className="font-mono text-[11px] text-dim tnum">{q.sizeMb ? mb(q.sizeMb) : "—"} · {q.codec}</span>
                    </span>
                  </button>
                </li>
              );
            })}
            {queue.length === 0 && <li className="px-2 py-6 text-center text-[12px] text-dim">No videos yet. Record one, or drop/browse.</li>}
          </ul>
        </div>
        </Dock>
        </div>

        {/* marquee selection rectangle (viewport-fixed so it tracks the cursor) */}
        {marquee && marquee.w > 2 && marquee.h > 2 && (
          <div className="pointer-events-none fixed z-[55] rounded-[3px] border border-accent bg-accent/15" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
        )}

        <ResizeHandle axis="x" onReset={() => setLayout((l) => ({ ...l, source: 268 }))} onDelta={(dx) => setLayout((l) => ({ ...l, source: clamp(l.source + dx, 200, 460) }))} />

        {/* center: single studio view — preview + before/after, analysis beneath */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!sel?.path ? (
            <div className="grid min-h-0 flex-1 place-items-center rounded-lg border border-line bg-sunken">
              <Empty />
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-3 overflow-auto rounded-lg border border-line bg-sunken p-3">
              {/* preview — custom player with the transport UNDER the screen */}
              <section>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-600 uppercase tracking-wide text-dim">
                  <Play className="h-3 w-3" strokeWidth={2.4} /> Preview
                </div>
                <OptimizePlayer src={fileUrl(sel.path)} />
              </section>

              {/* analysis — centered under the preview */}
              <section>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-600 uppercase tracking-wide text-dim">
                  <BarChart3 className="h-3 w-3" strokeWidth={2.4} /> Analysis
                </div>
                <div className="rounded-lg border border-line bg-panel p-4">
                  <Analysis saved={saved} srcMb={srcMb} outMb={outMb} done={!!done} vmaf={vmaf} lossless={lossless} etaMin={etaMin} codec={codec} encoderLabel={hwAccel && hwAvailable && hwForCodec ? hwName(hwForCodec) || "GPU" : "CPU"} />
                </div>
              </section>
            </div>
          )}
        </div>

        <ResizeHandle axis="x" onReset={() => setLayout((l) => ({ ...l, settings: 326 }))} onDelta={(dx) => setLayout((l) => ({ ...l, settings: clamp(l.settings - dx, 270, 480) }))} />

        {/* settings */}
        <div style={{ width: layout.settings }} className="min-h-0 shrink-0">
        <Dock
          title="Encode settings"
          className="h-full w-full"
          action={
            <Btn
              size="sm"
              variant="subtle"
              icon={Sparkles}
              title="Apply the recommended balanced settings"
              onClick={() => {
                setMode("quality");
                setQuality(62);
                setCodec("hevc");
                setRes("same");
                setPreset("balanced");
                setFormat("mp4");
                setFpsCap(0);
                setMute(false);
                setAudioKbps(160);
                setStripMeta(true);
                setHwAccel(true);
              }}
            >
              Recommended
            </Btn>
          }
        >
          <div className="-mt-1">
            <Field label="Save as" stacked hint="Name for the optimized file.">
              <div className="flex gap-2">
                <input value={saveName} onChange={(e) => setSaveName(e.target.value)} className="focus-ring h-9 min-w-0 flex-1 rounded-lg border border-line bg-panel2 px-3 text-[13px] text-ink" />
                <Btn variant="subtle" icon={Pencil} onClick={rename} disabled={!sel?.path} title="Rename the source file">
                  Rename
                </Btn>
              </div>
            </Field>

            <Field label="Goal" stacked hint="Pick a quality level, or aim for a file size.">
              <Segmented value={mode} onChange={(v) => setMode(v as Mode)} options={[{ label: "Target quality", value: "quality" }, { label: "Target size", value: "size" }]} />
            </Field>

            {mode === "quality" ? (
              <Field label="Quality" stacked hint="Higher keeps more detail. 60+ is visually lossless.">
                <div className="rounded-xl border border-line bg-panel2/50 p-3">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-mono text-[24px] font-800 leading-none text-ink tnum">{quality}</span>
                    <span className={cx("rounded-full px-2 py-0.5 text-[10.5px] font-700 uppercase tracking-wide", quality >= 90 ? "bg-good/15 text-good" : quality >= 70 ? "bg-accent-soft text-accent" : "text-muted")}>
                      {quality < 45 ? "Compact" : quality < 70 ? "High" : quality < 90 ? "Very high" : "Lossless"}
                    </span>
                  </div>
                  <Slider value={quality} min={20} max={100} onChange={setQuality} />
                  <div className="mt-1.5 flex justify-between text-[9px] font-700 uppercase tracking-[0.1em] text-dim">
                    <span>Small</span>
                    <span>Balanced</span>
                    <span>Lossless</span>
                  </div>
                </div>
              </Field>
            ) : (
              <Field label="Target size" stacked hint="We tune the encoder to land near this size.">
                <div className="flex items-center gap-3">
                  <Slider value={targetMb} min={50} max={Math.max(100, srcMb)} step={10} onChange={setTargetMb} />
                  <span className="w-16 text-right font-mono text-[13px] font-500 text-ink tnum">{mb(targetMb)}</span>
                </div>
              </Field>
            )}

            <Field label="Format">
              <div className="w-40">
                <Select value={format} onChange={(v) => setFormat(v as Format)} options={[{ label: "MP4", value: "mp4" }, { label: "MKV", value: "mkv" }, { label: "MOV", value: "mov" }, { label: "WebM", value: "webm" }, { label: "GIF", value: "gif" }]} />
              </div>
            </Field>

            {format !== "gif" && (
              <Field label="Codec">
                <Select value={codec} onChange={(v) => setCodec(v as Codec)} options={[{ label: "H.264", value: "h264" }, { label: "HEVC (H.265)", value: "hevc" }, { label: "AV1", value: "av1" }]} />
              </Field>
            )}

            <Field label="Resolution">
              <Select value={res} onChange={(v) => setRes(v as ResMode)} options={[{ label: "Same as source", value: "same" }, { label: "1080p", value: "1080" }, { label: "720p", value: "720" }]} />
            </Field>

            <Field label="Speed" stacked hint="Slower presets compress harder at the same quality.">
              <Segmented value={preset} onChange={(v) => setPreset(v as Preset)} options={[{ label: "Fast", value: "fast" }, { label: "Balanced", value: "balanced" }, { label: "Max", value: "max" }]} />
            </Field>

            {format !== "gif" && (
              <Field label="Frame rate" hint="Capping FPS is an easy size win for screen recordings.">
                <div className="w-40">
                  <Select
                    value={String(fpsCap)}
                    onChange={(v) => setFpsCap(Number(v))}
                    options={[{ label: "Keep source", value: "0" }, { label: "60 fps", value: "60" }, { label: "30 fps", value: "30" }, { label: "24 fps", value: "24" }]}
                  />
                </div>
              </Field>
            )}

            {format !== "gif" && (
              <Field label="Audio" stacked hint={mute ? "Audio will be removed." : "Lower bitrate trims size with little audible loss."}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMute((m) => !m)}
                    className={cx("focus-ring flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-500 transition-colors", mute ? "border-rec/40 bg-rec-soft text-rec" : "border-line bg-panel2 text-ink hover:bg-hover")}
                  >
                    {mute ? <VolumeX className="h-4 w-4" strokeWidth={2} /> : <Volume2 className="h-4 w-4" strokeWidth={2} />}
                    {mute ? "Muted" : "Keep audio"}
                  </button>
                  <div className="min-w-0 flex-1">
                    <Select
                      value={String(audioKbps)}
                      onChange={(v) => setAudioKbps(Number(v))}
                      options={[{ label: "96 kbps", value: "96" }, { label: "128 kbps", value: "128" }, { label: "160 kbps", value: "160" }, { label: "192 kbps", value: "192" }, { label: "256 kbps", value: "256" }]}
                    />
                  </div>
                </div>
              </Field>
            )}

            <Field label="Strip metadata" hint="Remove embedded tags, chapters and creation info.">
              <Toggle checked={stripMeta} onChange={setStripMeta} label="Strip metadata" />
            </Field>

            <Field
              label="Hardware acceleration"
              stacked
              hint={
                hwAvailable
                  ? `Encode on the GPU — dramatically faster, automatic CPU fallback if it fails.`
                  : format === "gif" || format === "webm"
                  ? "Not used for this format."
                  : hw
                  ? "No compatible GPU encoder detected — encoding on CPU."
                  : "Detecting GPU encoder…"
              }
            >
              <div className="flex items-center justify-between gap-2">
                <Toggle checked={hwAccel && hwAvailable} disabled={!hwAvailable} onChange={(v) => { setHwAccel(v); setSettings({ hwAccel: v }); }} label="Hardware acceleration" />
                {hwForCodec ? (
                  <Tag tone="good" mono>
                    <Zap className="h-3 w-3" /> {hwName(hwForCodec)}
                  </Tag>
                ) : hw ? (
                  <Tag mono>CPU</Tag>
                ) : null}
              </div>
            </Field>

            <div className="pt-4">
              <Btn variant={done ? "good" : "primary"} size="lg" full icon={done ? Check : Sparkles} disabled={running || !sel} onClick={handleOptimize}>
                {running ? `Optimizing… ${Math.round(opt.progress * 100)}%` : done ? "Optimized — Reveal file" : "Optimize Video"}
              </Btn>
              {running && (
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${Math.max(4, opt.progress * 100)}%` }} />
                </div>
              )}
              {(error || opt.error) && <p className="mt-2 text-[12px] text-rec">{error || opt.error}</p>}
            </div>
          </div>
        </Dock>
        </div>
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <FileVideo className="h-7 w-7 text-dim" strokeWidth={1.6} />
      <p className="text-[13px] text-muted">Select a video to preview and optimize</p>
    </div>
  );
}

/* ---- Custom video player: clean stage with a premium transport UNDERNEATH ---- */
function OptimizePlayer({ src }: { src: string }) {
  const vref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    const v = vref.current;
    if (!v) return;
    const onLoaded = () => setDur(isFinite(v.duration) ? v.duration : 0);
    const onTime = () => setT(v.currentTime || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [src]);
  const toggle = () => {
    const v = vref.current;
    if (!v) return;
    v.paused ? void v.play() : v.pause();
  };
  const seek = (val: number) => {
    const v = vref.current;
    if (v) v.currentTime = val;
    setT(val);
  };
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-[0_8px_28px_oklch(0_0_0_/_0.28)]">
      <div className="group relative grid place-items-center bg-black">
        <video ref={vref} key={src} src={src} muted={muted} onClick={toggle} className="max-h-[42vh] w-full cursor-pointer bg-black object-contain" />
        {!playing && (
          <button onClick={toggle} aria-label="Play" className="absolute grid h-14 w-14 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition-transform hover:scale-105">
            <Play className="ml-0.5 h-6 w-6" fill="currentColor" strokeWidth={0} />
          </button>
        )}
      </div>
      {/* transport, sitting under the stage */}
      <div className="flex items-center gap-3 border-t border-line bg-panel2/50 px-3 py-2.5">
        <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-[var(--on-accent)] transition-transform active:scale-95">
          {playing ? <Pause className="h-4 w-4" fill="currentColor" strokeWidth={0} /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" strokeWidth={0} />}
        </button>
        <span className="w-12 shrink-0 text-right font-mono text-[11px] text-muted tnum">{timecode(t)}</span>
        <div className="min-w-0 flex-1">
          <Slider value={t} min={0} max={dur || 0.001} step={0.01} onChange={seek} />
        </div>
        <span className="w-12 shrink-0 font-mono text-[11px] text-dim tnum">{timecode(dur)}</span>
        <button onClick={() => setMuted((m) => !m)} aria-label="Mute" className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-hover hover:text-ink">
          {muted ? <VolumeX className="h-4 w-4" strokeWidth={2} /> : <Volume2 className="h-4 w-4" strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
}

/* ---- Analysis tab: size comparison + quality metrics ---- */
function Analysis({ saved, srcMb, outMb, done, vmaf, lossless, etaMin, codec, encoderLabel }: { saved: number; srcMb: number; outMb: number; done: boolean; vmaf: number; lossless: boolean; etaMin: number; codec: string; encoderLabel: string }) {
  const outPct = clamp(srcMb ? (outMb / srcMb) * 100 : 0, 3, 100);
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {/* hero: one proportional bar communicates the whole story */}
      <div className="rounded-xl border border-line bg-panel p-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10.5px] font-600 uppercase tracking-wider text-dim">{done ? "Result" : "Projected"}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-[34px] font-800 leading-none text-good tnum">{Math.round(saved * 100)}%</span>
              <span className="text-[13px] text-muted">smaller</span>
            </div>
          </div>
          <div className="text-right font-mono tnum">
            <div className="text-[12px] text-dim">{mb(srcMb)}</div>
            <div className="text-[18px] font-700 text-ink">{mb(outMb)}</div>
          </div>
        </div>
        {/* original = full track; optimized = filled portion */}
        <div className="mt-3 h-3.5 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-line">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${outPct}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[10.5px] text-dim">
          <span className="text-accent">Optimized</span>
          <span>Original</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini icon={Gauge} label="Quality" value={vmaf.toFixed(1)} sub={lossless ? "lossless" : "high"} tone={lossless ? "good" : "warn"} />
        <Mini icon={HardDrive} label="Saved" value={srcMb ? mb(Math.max(0, srcMb - outMb)) : "—"} sub={`of ${mb(srcMb)}`} />
        <Mini icon={Clock} label="Est. time" value={`~${etaMin.toFixed(1)}m`} sub={codec.toUpperCase()} />
        <Mini icon={Zap} label="Encoder" value={encoderLabel} sub={encoderLabel === "CPU" ? "software" : "GPU"} tone={encoderLabel === "CPU" ? "neutral" : "good"} />
      </div>
    </div>
  );
}

function Mini({ icon: Icon, label, value, sub, tone = "neutral" }: { icon: typeof Gauge; label: string; value: string; sub: string; tone?: "neutral" | "good" | "warn" }) {
  const c = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-panel p-3.5">
      <div className="flex items-center gap-1.5 text-dim">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        <span className="text-[10.5px] font-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className={cx("mt-1 font-mono text-[18px] font-700 tnum", c)}>{value}</div>
      <div className="text-[11px] text-dim">{sub}</div>
    </div>
  );
}
