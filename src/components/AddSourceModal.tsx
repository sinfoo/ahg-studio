import { AnimatePresence, motion } from "framer-motion";
import {
  AppWindow,
  ArrowLeft,
  Camera,
  Check,
  Film,
  Image as ImageIcon,
  Monitor,
  Type as TypeIcon,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { studio, type CaptureSource } from "../lib/bridge";
import { cx } from "../lib/format";
import type { AddSpec, SourceType } from "../hooks/useCapture";
import { Btn } from "./ui";

const TYPES: { type: SourceType; label: string; desc: string; icon: typeof Monitor }[] = [
  { type: "display", label: "Display", desc: "A whole monitor", icon: Monitor },
  { type: "window", label: "Window", desc: "A single app window", icon: AppWindow },
  { type: "camera", label: "Webcam", desc: "A camera / capture device", icon: Camera },
  { type: "image", label: "Image", desc: "PNG, JPG, GIF…", icon: ImageIcon },
  { type: "video", label: "Video", desc: "A video / media file", icon: Film },
  { type: "text", label: "Text", desc: "A text overlay", icon: TypeIcon },
];

export function AddSourceModal({ onClose, onAdd, initialType }: { onClose: () => void; onAdd: (spec: AddSpec) => void; initialType?: SourceType }) {
  const [type, setType] = useState<SourceType | null>(initialType ?? null);
  const [name, setName] = useState("");
  const [screens, setScreens] = useState<CaptureSource[]>([]);
  const [cams, setCams] = useState<{ label: string; value: string }[]>([]);
  const [sel, setSel] = useState<string>(""); // sourceId or deviceId
  const [path, setPath] = useState<string>("");
  const [text, setText] = useState("Your text");
  const [color, setColor] = useState("#ffffff");
  const [fontSize, setFontSize] = useState(80);

  // seed the name when opened directly into a type (via right-click → Add)
  useEffect(() => {
    if (initialType) setName(TYPES.find((x) => x.type === initialType)!.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    if ((type === "display" || type === "window") && studio) {
      studio.listSources().then((list) => {
        if (live) setScreens(list.filter((s) => (type === "display" ? s.type === "screen" : s.type === "window")));
      });
    }
    if (type === "camera") {
      navigator.mediaDevices?.enumerateDevices().then((d) => {
        if (live) setCams(d.filter((x) => x.kind === "videoinput").map((x, i) => ({ label: x.label || `Camera ${i + 1}`, value: x.deviceId })));
      });
    }
    return () => {
      live = false;
    };
  }, [type]);

  function pickType(t: SourceType) {
    setType(t);
    setSel("");
    setPath("");
    setName(TYPES.find((x) => x.type === t)!.label);
  }

  async function browse() {
    if (!studio) return;
    const f = type === "image" ? await studio.pickImage() : await studio.pickFile();
    if (f) {
      setPath(f.path);
      setName(f.name.replace(/\.[^.]+$/, ""));
    }
  }

  const canAdd =
    type === "text"
      ? text.trim().length > 0
      : type === "image" || type === "video"
        ? !!path
        : type === "camera"
          ? cams.length > 0 && !!sel
          : (type === "display" || type === "window") && !!sel;

  function add() {
    if (!type) return;
    const spec: AddSpec = { type, name: name.trim() || "Source" };
    if (type === "display" || type === "window") spec.sourceId = sel;
    if (type === "camera") spec.deviceId = sel;
    if (type === "image" || type === "video") spec.path = path;
    if (type === "text") {
      spec.text = text;
      spec.color = color;
      spec.fontSize = fontSize;
    }
    onAdd(spec);
    onClose();
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-[55] grid place-items-center bg-black/70 p-8 backdrop-blur"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-[var(--shadow-pop)]"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            {type && (
              <button onClick={() => setType(null)} className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-ink">
                <ArrowLeft className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
            <h2 className="text-[14px] font-700 text-ink">{type ? `Add ${TYPES.find((t) => t.type === type)!.label}` : "Add source"}</h2>
          </div>
          <button onClick={onClose} className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <AnimatePresence mode="wait">
            {!type ? (
              <motion.div key="types" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="grid grid-cols-3 gap-3">
                {TYPES.map(({ type: t, label, desc, icon: Icon }) => (
                  <button
                    key={t}
                    onClick={() => pickType(t)}
                    className="focus-ring group flex flex-col items-start gap-2 rounded-xl border border-line bg-panel2 p-4 text-left transition-colors hover:border-accent hover:bg-hover"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-accent">
                      <Icon className="h-5 w-5" strokeWidth={2} />
                    </span>
                    <span className="text-[13px] font-600 text-ink">{label}</span>
                    <span className="text-[11.5px] text-dim">{desc}</span>
                  </button>
                ))}
              </motion.div>
            ) : (
              <motion.div key="config" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.15 }} className="space-y-4">
                {(type === "display" || type === "window") && (
                  <div className="grid grid-cols-3 gap-2">
                    {screens.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setSel(s.id);
                          setName(s.name);
                        }}
                        className={cx("focus-ring overflow-hidden rounded-lg border text-left transition-colors", sel === s.id ? "border-accent ring-1 ring-accent" : "border-line hover:border-line-strong")}
                      >
                        <div className="aspect-video bg-black">
                          {s.thumbnail ? <img src={s.thumbnail} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-dim"><Monitor className="h-5 w-5" /></div>}
                        </div>
                        <div className="truncate px-2 py-1.5 text-[11.5px] text-muted">{s.name}</div>
                      </button>
                    ))}
                    {screens.length === 0 && <p className="col-span-3 py-8 text-center text-[12px] text-dim">Looking for sources…</p>}
                  </div>
                )}

                {type === "camera" && (
                  <div className="space-y-2">
                    {cams.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => {
                          setSel(c.value);
                          setName(c.label);
                        }}
                        className={cx("focus-ring flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-[13px] transition-colors", sel === c.value ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-hover hover:text-ink")}
                      >
                        <Camera className="h-4 w-4" strokeWidth={2} /> {c.label}
                      </button>
                    ))}
                    {cams.length === 0 && <p className="py-8 text-center text-[12px] text-dim">No cameras found.</p>}
                  </div>
                )}

                {(type === "image" || type === "video") && (
                  <button onClick={browse} className="focus-ring flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong bg-sunken py-8 transition-colors hover:border-accent hover:bg-hover">
                    <UploadCloud className="h-6 w-6 text-dim" strokeWidth={2} />
                    <span className="text-[13px] font-500 text-muted">{path ? path.split(/[\\/]/).pop() : `Choose ${type === "image" ? "an image" : "a video"}`}</span>
                    <span className="text-[11px] text-accent">Browse…</span>
                  </button>
                )}

                {type === "text" && (
                  <div className="space-y-3">
                    <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="focus-ring w-full rounded-lg border border-line bg-panel2 p-3 text-[14px] text-ink" />
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-[12px] text-muted">
                        Color
                        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent" />
                      </label>
                      <label className="flex items-center gap-2 text-[12px] text-muted">
                        Size
                        <input type="range" min={24} max={220} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="ahg-range h-1.5 w-32 cursor-pointer appearance-none rounded-full" style={{ background: "var(--bg-hover)" }} />
                        <span className="w-8 font-mono text-ink tnum">{fontSize}</span>
                      </label>
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-[12px] text-muted">Source name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="focus-ring h-9 w-full rounded-lg border border-line bg-panel2 px-3 text-[13px] text-ink" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {type && (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
            <Btn variant="ghost" onClick={onClose}>
              Cancel
            </Btn>
            <Btn variant="primary" icon={Check} disabled={!canAdd} onClick={add}>
              Add source
            </Btn>
          </footer>
        )}
      </motion.div>
    </motion.div>
  );
}
