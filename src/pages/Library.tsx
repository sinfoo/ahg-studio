import { AnimatePresence } from "framer-motion";
import {
  Check,
  Film,
  FileVideo,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Btn, Dock, IconBtn, Tag } from "../components/ui";
import { VideoPlayerModal } from "../components/VideoPlayerModal";
import { studio, type RecFile } from "../lib/bridge";
import { cx, mb, timecode } from "../lib/format";
import { refreshLibrary, useLibrary } from "../store/library";
import { useGridSelect } from "../hooks/useGridSelect";
import { notify } from "../lib/notify";

export function Library({
  active,
  pickMode,
  onImport,
  onCancelPick,
}: {
  active: boolean;
  pickMode: boolean;
  onImport: (files: RecFile[]) => void;
  onCancelPick: () => void;
}) {
  const items = useLibrary();
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState<RecFile | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Refresh on mount and whenever the page becomes active. refreshLibrary()
  // dedupes in-flight requests, so the overlap on mount is harmless.
  useEffect(() => {
    refreshLibrary();
  }, []);
  useEffect(() => {
    if (active) refreshLibrary();
  }, [active]);

  // Selection only lives while picking — clear it whenever pick mode turns off.
  useEffect(() => {
    if (!pickMode) setSelected(new Set());
  }, [pickMode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((f) => f.name.toLowerCase().includes(q));
  }, [items, query]);

  // Marquee / rectangle multi-selection for NORMAL browsing mode (not pick mode).
  // Keyed on the visible (filtered) paths so Shift-range tracks on-screen order.
  const sel = useGridSelect(useMemo(() => filtered.map((f) => f.path), [filtered]));
  // Stable handle to the latest hook value so the memoized cards and effects can
  // call into it without breaking VideoCard's memoization or re-running effects.
  const selRef = useRef(sel);
  selRef.current = sel;
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  // Marquee/batch-delete is normal-mode only — clear it whenever pick mode turns on.
  useEffect(() => {
    if (pickMode) {
      selRef.current.clear();
      setBatchConfirm(false);
    }
  }, [pickMode]);

  // Drop the inline confirm once the selection empties out.
  useEffect(() => {
    if (sel.selected.size === 0 && batchConfirm) setBatchConfirm(false);
  }, [sel.selected.size, batchConfirm]);

  const onView = useCallback((f: RecFile) => setViewing(f), []);
  const onImportOne = useCallback((f: RecFile) => onImport([f]), [onImport]);
  const onToggleSelect = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  // Stable card-click selector (delegates to the live hook via the ref).
  const onCardSelect = useCallback(
    (path: string, mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => selRef.current.clickSelect(path, mods),
    []
  );

  const doBatchDelete = useCallback(async () => {
    if (batchBusy) return;
    const paths = [...selRef.current.selected];
    if (!paths.length || !studio?.deleteRecording) return;
    setBatchBusy(true);
    for (const p of paths) {
      try {
        await studio.deleteRecording(p);
      } catch {
        /* keep going — report the batch result below */
      }
    }
    await refreshLibrary();
    notify({ title: `Deleted ${paths.length} recordings`, tone: "success" });
    selRef.current.clear();
    setBatchBusy(false);
    setBatchConfirm(false);
  }, [batchBusy]);

  const selectedFiles = useMemo(() => items.filter((f) => selected.has(f.path)), [items, selected]);

  return (
    <div className="flex h-full flex-col p-3">
      <Dock
        title="Library"
        icon={Film}
        className="h-full"
        bodyClass="flex min-h-0 flex-1 flex-col p-0"
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" strokeWidth={2} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search recordings"
                className="focus-ring h-7 w-48 rounded-lg border border-line bg-panel2 pl-7 pr-2 text-[12px] text-ink placeholder:text-dim"
              />
            </div>
            <IconBtn icon={RefreshCw} label="Refresh library" onClick={() => refreshLibrary()} />
          </div>
        }
      >
        {pickMode && (
          <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft/60 px-3 py-2">
            <Sparkles className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.2} />
            <span className="text-[12.5px] font-600 text-ink">Select videos to import to Edit</span>
            <span className="ml-auto text-[11.5px] text-muted">{selected.size} selected</span>
          </div>
        )}

        <div className="flex items-center justify-between px-3.5 pb-1.5 pt-3">
          <p className="text-[12.5px] text-muted">
            {filtered.length} {filtered.length === 1 ? "video" : "videos"}
          </p>
          <p className="text-[11px] text-dim">Double-click a name to rename</p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3.5 pb-4" {...(pickMode ? {} : sel.bind)}>
          {filtered.length === 0 ? (
            <Empty searching={!!query.trim()} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
              {filtered.map((f) => (
                <VideoCard
                  key={f.path}
                  file={f}
                  pickMode={pickMode}
                  selected={pickMode ? selected.has(f.path) : sel.selected.has(f.path)}
                  onView={onView}
                  onImport={onImportOne}
                  onToggleSelect={onToggleSelect}
                  onSelectClick={onCardSelect}
                />
              ))}
            </div>
          )}
        </div>

        {/* normal-mode batch action bar (marquee multi-select) */}
        {!pickMode && sel.selected.size > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-line/70 bg-panel2/60 px-3.5 py-2.5">
            <span className="text-[12.5px] text-muted">
              {sel.selected.size} {sel.selected.size === 1 ? "video" : "videos"} selected
            </span>
            <div className="flex items-center gap-2">
              <Btn
                variant="ghost"
                onClick={() => {
                  selRef.current.clear();
                  setBatchConfirm(false);
                }}
              >
                Clear
              </Btn>
              {batchConfirm ? (
                <Btn variant="danger" icon={Trash2} disabled={batchBusy} onClick={doBatchDelete}>
                  {batchBusy ? "Deleting…" : `Delete ${sel.selected.size}?`}
                </Btn>
              ) : (
                <Btn variant="danger" icon={Trash2} onClick={() => setBatchConfirm(true)}>
                  Delete
                </Btn>
              )}
            </div>
          </div>
        )}

        {pickMode && (
          <div className="flex items-center justify-between gap-3 border-t border-line/70 bg-panel2/60 px-3.5 py-2.5">
            <span className="text-[12.5px] text-muted">
              {selected.size} {selected.size === 1 ? "video" : "videos"} selected
            </span>
            <div className="flex items-center gap-2">
              <Btn variant="ghost" onClick={onCancelPick}>
                Cancel
              </Btn>
              <Btn variant="primary" icon={UploadCloud} disabled={selected.size === 0} onClick={() => onImport(selectedFiles)}>
                Import {selected.size || ""} to Edit
              </Btn>
            </div>
          </div>
        )}
      </Dock>

      {/* rubber-band marquee (viewport-fixed so it tracks the cursor exactly) */}
      {!pickMode && sel.marquee && sel.marquee.w > 2 && sel.marquee.h > 2 && (
        <div
          className="pointer-events-none fixed z-[55] rounded-[3px] border border-accent bg-accent/15"
          style={{ left: sel.marquee.x, top: sel.marquee.y, width: sel.marquee.w, height: sel.marquee.h }}
        />
      )}

      <AnimatePresence>
        {viewing && (
          <VideoPlayerModal
            file={viewing}
            onClose={() => setViewing(null)}
            onImport={(f) => {
              setViewing(null);
              onImport([f]);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Empty({ searching }: { searching: boolean }) {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <div className="flex flex-col items-center gap-2.5 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-panel2 text-dim">
          <FileVideo className="h-7 w-7" strokeWidth={1.6} />
        </span>
        <p className="text-[14px] font-600 text-ink">{searching ? "No matching recordings" : "No recordings yet"}</p>
        <p className="max-w-[280px] text-[12.5px] text-dim">
          {searching ? "Try a different search." : "Record something to see it here."}
        </p>
      </div>
    </div>
  );
}

/* ---------- Memoized card: only repaints when its own props change ---------- */
const VideoCard = React.memo(function VideoCard({
  file,
  pickMode,
  selected,
  onView,
  onImport,
  onToggleSelect,
  onSelectClick,
}: {
  file: RecFile;
  pickMode: boolean;
  selected: boolean;
  onView: (f: RecFile) => void;
  onImport: (f: RecFile) => void;
  onToggleSelect: (path: string) => void;
  onSelectClick: (path: string, mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
}) {
  const [thumb, setThumb] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(() => file.name.replace(/\.[^.]+$/, ""));
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);

  // Lazy thumbnail (disk-cached in main). `live` guards against setState after
  // unmount / fast scroll.
  useEffect(() => {
    if (!studio?.generateThumb || !file.path) return;
    let live = true;
    studio
      .generateThumb(file.path)
      .then((d) => {
        if (live && d) setThumb(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [file.path]);

  const commitRename = useCallback(async () => {
    const clean = name.trim();
    setEditing(false);
    if (!studio?.renameRecording || !clean || clean === file.name.replace(/\.[^.]+$/, "")) return;
    const r = await studio.renameRecording(file.path, clean);
    if (r.ok) {
      refreshLibrary();
      notify({ title: "Renamed", tone: "success" });
    } else {
      setName(file.name.replace(/\.[^.]+$/, ""));
      notify({ title: r.error || "Rename failed", tone: "error" });
    }
  }, [name, file.path, file.name]);

  const cancelRename = useCallback(() => {
    setName(file.name.replace(/\.[^.]+$/, ""));
    setEditing(false);
  }, [file.name]);

  const doDelete = useCallback(async () => {
    if (!studio?.deleteRecording || busy) return;
    setBusy(true);
    const r = await studio.deleteRecording(file.path);
    if (r.ok) {
      refreshLibrary();
      notify({ title: "Recording deleted", tone: "success" });
    } else {
      setBusy(false);
      setConfirmDel(false);
      notify({ title: r.error || "Delete failed", tone: "error" });
    }
  }, [file.path, busy]);

  return (
    <div
      data-sel-id={file.path}
      style={{ contentVisibility: "auto", containIntrinsicSize: "200px 240px" }}
      onClick={
        pickMode
          ? () => onToggleSelect(file.path)
          : (e) => onSelectClick(file.path, { ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey })
      }
      className={cx(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-panel shadow-[0_2px_10px_oklch(0_0_0_/_0.18)] transition-colors",
        "cursor-pointer",
        selected ? "border-accent ring-2 ring-accent" : "border-line hover:border-line-strong"
      )}
    >
      {/* thumbnail */}
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full animate-pulse bg-gradient-to-br from-panel2 to-sunken" />
        )}

        {/* center View button on hover — disabled while PICKING so a card click
            selects the video instead of opening the player. */}
        {!pickMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onView(file);
            }}
            aria-label="View"
            className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 backdrop-blur-[1px] transition-opacity duration-150 group-hover:opacity-100"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white shadow-lg transition-transform group-hover:scale-105">
              <Play className="ml-0.5 h-6 w-6" fill="currentColor" strokeWidth={0} />
            </span>
          </button>
        )}

        {/* optimized badge */}
        {file.optimized && (
          <span className="absolute left-2 top-2">
            <Tag tone="good" mono>
              <Sparkles className="h-3 w-3" /> Optimized
            </Tag>
          </span>
        )}

        {/* duration pill */}
        {file.durationSec > 0 && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10.5px] text-white tnum">
            {timecode(file.durationSec)}
          </span>
        )}

        {/* pick-mode selection check */}
        {pickMode && (
          <span
            className={cx(
              "absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full border-2 transition-colors",
              selected ? "border-accent bg-accent text-[var(--on-accent)]" : "border-white/70 bg-black/30 text-transparent"
            )}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
        )}
      </div>

      {/* body */}
      <div className="flex min-w-0 flex-col gap-1.5 p-2.5">
        {editing ? (
          <input
            autoFocus
            value={name}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") cancelRename();
            }}
            className="focus-ring h-7 w-full rounded-md border border-line bg-panel2 px-2 text-[12.5px] font-500 text-ink"
          />
        ) : (
          <div
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            title={file.name}
            className="truncate text-[12.5px] font-600 text-ink"
          >
            {file.name}
          </div>
        )}

        {/* meta */}
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-dim tnum">
          <span>{mb(file.sizeMb)}</span>
          <span className="text-line-strong">·</span>
          <Tag>{(file.codec || "video").toUpperCase()}</Tag>
        </div>

        {/* action row — hidden in pick mode (selection drives the card there) */}
        {!pickMode && (
          <div className="mt-0.5 flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
            <CardBtn icon={Play} label="View" onClick={() => onView(file)} />
            <CardBtn icon={Pencil} label="Rename" onClick={() => setEditing(true)} />
            {confirmDel ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  doDelete();
                }}
                disabled={busy}
                className="focus-ring inline-flex h-7 items-center gap-1 rounded-md bg-rec px-2 text-[11.5px] font-600 text-white transition-colors hover:brightness-110 disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2.1} /> Delete?
              </button>
            ) : (
              <CardBtn icon={Trash2} label="Delete" tone="rec" onClick={() => setConfirmDel(true)} />
            )}
            {confirmDel && <CardBtn icon={X} label="Cancel delete" onClick={() => setConfirmDel(false)} />}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onImport(file);
              }}
              title="Import to Edit"
              className="focus-ring ml-auto inline-flex h-7 items-center gap-1 rounded-md bg-accent-soft px-2 text-[11.5px] font-600 text-accent transition-colors hover:bg-accent hover:text-[var(--on-accent)]"
            >
              <UploadCloud className="h-3.5 w-3.5" strokeWidth={2.1} /> Edit
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

function CardBtn({
  icon: Icon,
  label,
  tone = "default",
  onClick,
}: {
  icon: typeof Play;
  label: string;
  tone?: "default" | "rec";
  onClick: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className={cx(
        "focus-ring grid h-7 w-7 place-items-center rounded-md transition-colors",
        tone === "rec" ? "text-dim hover:bg-rec-soft hover:text-rec" : "text-dim hover:bg-hover hover:text-ink"
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}
