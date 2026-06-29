import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeftRight,
  Camera,
  AudioWaveform,
  Check,
  Clapperboard,
  LibraryBig,
  Type,
  Combine,
  Copy,
  Diamond,
  Download,
  Eye,
  EyeOff,
  Film,
  FlipHorizontal,
  FolderOpen,
  Keyboard,
  Layers,
  Lock,
  Magnet,
  MapPin,
  Maximize,
  MousePointer2,
  MoveHorizontal,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat,
  Scissors,
  Search,
  Sparkles,
  SkipBack,
  SkipForward,
  SplitSquareHorizontal,
  Trash2,
  Type as TypeIcon,
  Undo2,
  Unlink,
  Unlock,
  Upload,
  Volume2,
  VolumeX,
  Wand2,
  Workflow,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Btn, Dock, EdgeResizers, Field, ResizeHandle, Segmented, Select, Slider, Tag, Toggle } from "../components/ui";
import { studio, type FileRef } from "../lib/bridge";
import { clamp, cx } from "../lib/format";
import { notify } from "../lib/notify";
import { runExportJob } from "../store/export";
import { setSettings, useSettings } from "../store/settings";
import { ColorPopover } from "../components/ColorPopover";
import { useFilmstrip, useWaveform } from "../lib/thumbnails";
import {
  ASPECTS,
  BLEND_MODES,
  type BlendMode,
  clipAt,
  clipAtFast,
  clipEnd,
  clipFrame,
  clipFrameAt,
  clipLen,
  clipsOf,
  hasMotion,
  upsertKeyframe,
  DEFAULT_PIP,
  emptyProject,
  FONTS,
  fmtTime,
  newId,
  projectDuration,
  snapCandidates,
  snapTime,
  splitClips,
  TEXT_ANIMS,
  TRANSITION_DIRS,
  TRANSITIONS,
  type Clip,
  type Project,
  type TextAnim,
  type Track,
  type TransitionDir,
  type TransitionKind,
} from "../lib/timeline";
import { PreviewPlayer } from "../components/PreviewPlayer";
import { useGridSelect } from "../hooks/useGridSelect";

const fileUrl = (p: string) => "file:///" + p.replace(/\\/g, "/");
// Electron 32+ dropped File.path — resolve a dropped file's path via the bridge.
const dropPath = (f: File): string => studio?.pathForFile?.(f) || (f as File & { path?: string }).path || "";
const MEDIA_DND = "application/ahg-media";

// Sticky timeline tools (like a pro NLE). A tool stays active after use — e.g. the
// Split tool keeps splitting on each click — until you pick Select (V) again.
type Tool = "select" | "split" | "text" | "mark";
// Custom SVG cursors (not the OS defaults) — a black halo keeps them visible on any
// background. `hx/hy` is the hotspot (the exact pixel the click registers at).
const mkCursor = (svg: string, hx: number, hy: number) => `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, auto`;
// Premium two-tone cursors (gradient fills + crisp dark halo + white highlight)
// so they read on any background and feel designed, not flat. Gradients render in
// SVG data-URI cursors in Chromium; filters don't, so contrast comes from the halo.
const SPLIT_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='22' height='34' viewBox='0 0 22 34'>
<defs><linearGradient id='b' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#7dd3fc'/><stop offset='1' stop-color='#2da6f5'/></linearGradient></defs>
<line x1='11' y1='3' x2='11' y2='31' stroke='black' stroke-width='4.5' stroke-linecap='round'/>
<line x1='11' y1='3' x2='11' y2='31' stroke='url(#b)' stroke-width='2' stroke-linecap='round'/>
<path d='M11 1.5 L15.5 7 L11 12.5 L6.5 7 Z' fill='url(#b)' stroke='black' stroke-width='1.3' stroke-linejoin='round'/>
<circle cx='11' cy='7' r='1.4' fill='white'/>
<circle cx='11' cy='16' r='2.7' fill='white' stroke='black' stroke-width='1.1'/></svg>`;
const TEXT_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='18' height='28' viewBox='0 0 18 28'>
<g stroke='black' stroke-width='4.6' stroke-linecap='round' fill='none'><path d='M9 4v20M5 4h8M5 24h8'/></g>
<g stroke='white' stroke-width='2' stroke-linecap='round' fill='none'><path d='M9 4v20M5 4h8M5 24h8'/></g>
<circle cx='9' cy='14' r='2.4' fill='#38bdf8' stroke='black' stroke-width='1'/></svg>`;
const MARK_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='30' viewBox='0 0 24 30'>
<defs><linearGradient id='a' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fcd34d'/><stop offset='1' stop-color='#f59e0b'/></linearGradient></defs>
<path d='M12 28 L5.5 13.5 a6.5 6.5 0 1 1 13 0 Z' fill='url(#a)' stroke='black' stroke-width='1.6' stroke-linejoin='round'/>
<circle cx='12' cy='10' r='2.6' fill='white' stroke='#b45309' stroke-width='0.8'/></svg>`;
const TOOL_CURSOR: Record<Tool, string> = {
  select: "",
  split: mkCursor(SPLIT_SVG, 11, 16),
  text: mkCursor(TEXT_SVG, 9, 14),
  mark: mkCursor(MARK_SVG, 12, 28),
};

// Timeline zoom range (px per second). The high end lets you zoom past frame level
// (e.g. 800px/s ≈ 27px/frame at 30fps) so the ruler can show per-frame ticks.
const MIN_PPS = 8;
const MAX_PPS = 800;

// Clip fields mirrored to a linked partner (video ⇄ its detached audio).
const LINK_FIELDS = ["start", "in", "out", "speed", "reverse", "volume", "fadeIn", "fadeOut"] as const;

// The media item currently being dragged from the bin — lets the timeline draw a
// correctly-sized ghost clip during dragover (dataTransfer can't be read then).
let dragMediaInfo: { dur: number; name: string; kind: "video" | "audio" } | null = null;
type DropHint = { trackId: string | null; t: number; newTrack: boolean; dur: number; name: string; kind: "video" | "audio"; top: number; h: number };

// A video clip on an overlay track (not the bottom-most/base video track) — it
// renders as a resizable PiP layer in the preview and the export overlay.
function isOverlayClip(p: Project, c: Clip): boolean {
  if (c.kind !== "video") return false;
  const vts = p.tracks.filter((t) => t.kind === "video");
  const base = vts.length ? vts[vts.length - 1] : null;
  const tr = p.tracks.find((t) => t.id === c.trackId);
  return !!tr && tr.kind === "video" && !!base && tr.id !== base.id;
}

// Persisted, resizable layout sizes for the Edit Studio.
const LAYOUT_KEY = "ahg.edit.layout.v1";
type Layout = { bin: number; inspector: number; timeline: number; header: number; track: number };
const DEFAULT_LAYOUT: Layout = { bin: 200, inspector: 288, timeline: 280, header: 128, track: 60 };
function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return { ...DEFAULT_LAYOUT, ...JSON.parse(raw) };
  } catch {
    /* noop */
  }
  return { ...DEFAULT_LAYOUT };
}

interface MediaItem {
  id: string;
  path: string;
  name: string;
  kind: "video" | "audio";
  dur: number;
  w: number;
  h: number;
}

const isAudioPath = (p: string) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(p);

// Load duration + natural size. WebM has no duration header → seek to force it.
function loadMeta(path: string): Promise<{ dur: number; w: number; h: number }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    let done = false;
    let timer = 0;
    // Free the throwaway probe element + its decoder once we have the answer —
    // otherwise every import left a detached <video> (with a loaded source) and a
    // 4s timer alive, which added up over many imports.
    const release = () => {
      clearTimeout(timer);
      try {
        v.onloadedmetadata = null;
        v.onerror = null;
        v.removeAttribute("src");
        v.load();
      } catch {
        /* noop */
      }
    };
    const settle = (r: { dur: number; w: number; h: number }) => {
      if (done) return;
      done = true;
      release();
      resolve(r);
    };
    const finish = () => settle({ dur: (isFinite(v.duration) && v.duration > 0 ? v.duration : 0) || 5, w: v.videoWidth || 0, h: v.videoHeight || 0 });
    v.onloadedmetadata = () => {
      if (!isFinite(v.duration) || v.duration <= 0) {
        const up = () => {
          v.removeEventListener("timeupdate", up);
          finish();
        };
        v.addEventListener("timeupdate", up);
        try {
          v.currentTime = 1e101;
        } catch {
          finish();
        }
      } else finish();
    };
    v.onerror = () => settle({ dur: 5, w: 0, h: 0 });
    timer = window.setTimeout(finish, 4000);
    v.src = fileUrl(path);
  });
}

export function Edit({ incoming, importBatch, onOpenLibrary, active = true }: { incoming: FileRef | null; importBatch?: FileRef[] | null; onOpenLibrary?: () => void; active?: boolean }) {
  const [project, setProject] = useState<Project>(emptyProject);
  const [selIds, setSelIds] = useState<string[]>([]);
  const selId = selIds.length ? selIds[selIds.length - 1] : null;
  const setSelId = useCallback((id: string | null) => setSelIds(id ? [id] : []), []);
  const selIdsRef = useRef<string[]>([]);
  useEffect(() => {
    selIdsRef.current = selIds;
  }, [selIds]);
  const toggleSelect = useCallback((id: string) => setSelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])), []);
  const addSelect = useCallback((id: string) => setSelIds((prev) => (prev.includes(id) ? prev : [...prev, id])), []);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [pxPerSec, setPxPerSec] = useState(64);
  // Latest pxPerSec for the playback rAF's autoScroll (the tick effect doesn't
  // depend on pxPerSec, so without this it would auto-scroll at a stale scale
  // after a mid-playback zoom).
  const pxPerSecRef = useRef(64);
  pxPerSecRef.current = pxPerSec;
  const [busy, setBusy] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [snapping, setSnapping] = useState(true);
  const [loop, setLoop] = useState(false);
  const [ripple, setRipple] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const toolRef = useRef<Tool>(tool);
  toolRef.current = tool;
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);
  const bgPickRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [markers, setMarkers] = useState<number[]>([]);
  const [range, setRange] = useState<{ a: number; b: number } | null>(null);
  const [flashTrack, setFlashTrack] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const [snapGuide, setSnapGuide] = useState<number | null>(null);
  const [aspect, setAspect] = useState<string>("source");
  const [layout, setLayout] = useState<Layout>(loadLayout);

  // Fit the preview box to the available area at the project's aspect ratio, so
  // switching to 9:16 / 1:1 / etc. visibly reshapes the preview (not just letterbox).
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const [previewBox, setPreviewBox] = useState({ w: 0, h: 0 });

  // Persist panel sizes (debounced) so the studio remembers your layout.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
      } catch {
        /* noop */
      }
    }, 250);
    return () => clearTimeout(id);
  }, [layout]);

  useEffect(() => {
    if (!active) return; // don't observe/reflow the preview while Edit is hidden
    const el = previewAreaRef.current;
    if (!el) return;
    const compute = () => {
      const aw = el.clientWidth - 24; // account for p-3 padding
      const ah = el.clientHeight - 24;
      if (aw <= 0 || ah <= 0) return;
      const ar = project.width / project.height || 16 / 9;
      let w = aw;
      let h = w / ar;
      if (h > ah) {
        h = ah;
        w = h * ar;
      }
      setPreviewBox({ w: Math.round(w), h: Math.round(h) });
    };
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    return () => ro.disconnect();
  }, [active, project.width, project.height, layout.bin, layout.inspector, layout.timeline]);

  const playheadRef = useRef(0);
  const projectRef = useRef(project);
  const scrollRef = useRef<HTMLDivElement>(null);
  // External "playhead store": the timeline's playhead visuals subscribe to this
  // and re-render per frame on their OWN (tiny leaf components) instead of forcing
  // the whole memoized TimelineView to reconcile 60x/s. setPlayhead still drives
  // React state for the preview side; this just fans the value out to the leaves.
  const phStore = useRef({ v: 0, subs: new Set<() => void>() }).current;
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  useEffect(() => {
    playheadRef.current = playhead;
    phStore.v = playhead;
    phStore.subs.forEach((f) => f());
  }, [playhead, phStore]);

  const duration = useMemo(() => projectDuration(project), [project]);
  // Memoized so the O(clips) lookup doesn't re-run on every playback frame (the
  // master clock re-renders Edit ~60x/s; `sel` only changes on selection/edits).
  const sel = useMemo(() => project.clips.find((c) => c.id === selId) || null, [project.clips, selId]);
  const videoTracks = useMemo(() => project.tracks.filter((t) => t.kind === "video"), [project.tracks]);
  const mainTrack = useMemo(() => (videoTracks.length ? videoTracks[videoTracks.length - 1] : null), [videoTracks]);
  const pipTracks = useMemo(() => videoTracks.slice(0, -1), [videoTracks]);

  // ---- undo / redo ----
  const undo = useRef<Project[]>([]);
  const redo = useRef<Project[]>([]);
  // While a clip drag is in progress, commits update state WITHOUT pushing an undo
  // snapshot — a 60fps move/trim previously pushed dozens of entries, evicting the
  // whole 100-deep history. beginDrag() pushes exactly one snapshot of the pre-drag
  // state, so a single Ctrl+Z reverts the entire drag.
  const draggingRef = useRef(false);
  const commit = useCallback((next: Project | ((p: Project) => Project)) => {
    setProject((prev) => {
      if (!draggingRef.current) {
        undo.current.push(prev);
        if (undo.current.length > 100) undo.current.shift();
        redo.current = [];
      }
      return typeof next === "function" ? (next as (p: Project) => Project)(prev) : next;
    });
  }, []);
  const beginDrag = useCallback(() => {
    undo.current.push(projectRef.current);
    if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
    draggingRef.current = true;
  }, []);
  const endDragCommit = useCallback(() => {
    draggingRef.current = false;
  }, []);
  // Background colour: the native <input type=color> fires onChange continuously
  // while dragging, and each full `commit` (undo push + project re-render that
  // re-runs the preview slave effect) caused the "black screen for a while" lag.
  // Apply the colour to the preview container INSTANTLY via a ref (cheap, no React
  // churn) and collapse the storm into a single committed undo step (debounced).
  const bgElRef = useRef<HTMLDivElement>(null);
  const bgTimer = useRef(0);
  const setBgLive = useCallback(
    (c: string) => {
      if (bgElRef.current) bgElRef.current.style.background = c;
      clearTimeout(bgTimer.current);
      bgTimer.current = window.setTimeout(() => commit((p) => ({ ...p, bg: c })), 140);
    },
    [commit]
  );
  const doUndo = useCallback(() => {
    const p = undo.current.pop();
    if (!p) return;
    setProject((cur) => {
      redo.current.push(cur);
      return p;
    });
  }, []);
  const doRedo = useCallback(() => {
    const n = redo.current.pop();
    if (!n) return;
    setProject((cur) => {
      undo.current.push(cur);
      return n;
    });
  }, []);

  // ---- canvas / aspect ----
  function applyAspect(id: string, firstW?: number, firstH?: number) {
    setAspect(id);
    if (id === "source") {
      if (firstW && firstH) commit((p) => ({ ...p, width: firstW, height: firstH }));
      return;
    }
    const a = ASPECTS.find((x) => x.id === id);
    if (a) commit((p) => ({ ...p, width: a.w, height: a.h }));
  }

  // original source path → CFR editing-proxy path (built in the background on
  // import). The preview plays the proxy for smooth, VFR-free scrubbing while the
  // original is always used for export.
  const [proxyMap, setProxyMap] = useState<Record<string, string>>({});

  // ---- media bin + import ----
  const addToBin = useCallback(async (path: string, name: string): Promise<MediaItem> => {
    const kind = isAudioPath(path) ? "audio" : "video";
    const meta = await loadMeta(path);
    const item: MediaItem = { id: newId("m"), path, name: name.replace(/\.[^.]+$/, ""), kind, dur: meta.dur, w: meta.w, h: meta.h };
    setMedia((m) => (m.some((x) => x.path === path) ? m : [...m, item]));
    // Build a constant-frame-rate editing proxy in the background (video only).
    // This is the real fix for VFR screen-recording stutter; when it lands the
    // preview transparently swaps to it.
    if (kind === "video" && studio?.makeProxy) {
      studio
        .makeProxy(path)
        .then((r) => {
          if (r?.ok && r.path) setProxyMap((m) => (m[path] ? m : { ...m, [path]: r.path! }));
        })
        .catch(() => {});
    }
    return item;
  }, []);
  // Removing a media item also removes EVERY clip derived from that source on the
  // timeline — the video, its linked audio, detached audio and any split halves
  // all share the same path, so one filter clears them all.
  const removeFromBin = useCallback(
    (id: string) => {
      const it = media.find((x) => x.id === id);
      setMedia((m) => m.filter((x) => x.id !== id));
      if (it?.path) {
        commit((p) => ({ ...p, clips: p.clips.filter((c) => c.path !== it.path) }));
        setSelIds((prev) => prev.filter((sid) => projectRef.current.clips.some((c) => c.id === sid && c.path !== it.path)));
      }
    },
    [media, commit]
  );

  const appendClip = useCallback(
    (item: MediaItem) => {
      const firstVideo = item.kind === "video" && !projectRef.current.clips.some((c) => c.kind === "video");
      let selectId = "";
      commit((p) => {
        let tracks = p.tracks;
        // Default a video to the BASE track (Video 1 = bottom-most), not the top
        // overlay track; audio goes to the first audio track.
        const vtracks = tracks.filter((t) => t.kind === "video" && !t.locked);
        const vTrackId = item.kind === "video" ? vtracks[vtracks.length - 1]?.id || "v1" : tracks.find((t) => t.kind === "audio" && !t.locked)?.id || "a1";
        const tail = clipsOf(p, vTrackId).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
        const mainClip = makeClip(item, vTrackId, tail);
        selectId = mainClip.id;
        let clips = [...p.clips, mainClip];
        // A video carries audio → drop a LINKED audio clip on its own audio track,
        // so the video and its waveform sit on separate, linked tracks.
        if (item.kind === "video") {
          const linkId = newId("lk");
          mainClip.linkId = linkId;
          let aTrack = tracks.find((t) => t.kind === "audio" && !t.locked);
          if (!aTrack) {
            aTrack = { id: newId("t"), kind: "audio", name: `Audio ${tracks.filter((t) => t.kind === "audio").length + 1}`, muted: false, hidden: false, locked: false };
            tracks = [...tracks, aTrack];
          }
          const aClip: Clip = { ...makeClip(item, aTrack.id, tail), kind: "audio", linkId, opacity: undefined };
          clips = [...clips, aClip];
        }
        let next = { ...p, tracks, clips };
        if (firstVideo && aspect === "source" && item.w && item.h) next = { ...next, width: item.w, height: item.h };
        return next;
      });
      if (selectId) setSelId(selectId);
    },
    [commit, aspect]
  );

  // Import only adds to the media bin — the user drags onto the timeline when ready
  // (double-clicking a bin tile still appends it). This is the "make it manual" ask:
  // no clip is auto-placed on the timeline anymore.
  async function importFiles() {
    const f = await studio?.pickFile();
    if (!f) return;
    await addToBin(f.path, f.name);
  }

  async function importLastRecording() {
    if (!studio) return;
    setBusy("Finding last recording…");
    const files = await studio.listRecordings();
    setBusy(null);
    const last = files[0];
    if (!last) {
      notify({ title: "No recordings yet", desc: "Record something first, then it shows up here.", tone: "info" });
      return;
    }
    await addToBin(last.path, last.name);
  }

  // load incoming clip from Library / Record — added to the bin (not auto-placed).
  const lastIncoming = useRef<string | null>(null);
  useEffect(() => {
    if (incoming?.path && incoming.path !== lastIncoming.current) {
      lastIncoming.current = incoming.path;
      addToBin(incoming.path, incoming.name);
    }
  }, [incoming, addToBin]);

  // Batch import from the Library picker — a new array identity each time signals
  // a fresh import; add every file to the bin (deduped against the last batch).
  const lastBatch = useRef<FileRef[] | null>(null);
  useEffect(() => {
    if (!importBatch || importBatch === lastBatch.current) return;
    lastBatch.current = importBatch;
    for (const f of importBatch) if (f.path) addToBin(f.path, f.name);
  }, [importBatch, addToBin]);

  // ---- clip ops ----
  // Fields mirrored to a linked partner clip (video ⇄ its detached audio) so the
  // pair stays in sync when you move, trim, retime, or re-level either one.
  const updateClip = useCallback(
    (id: string, patch: Partial<Clip>) =>
      commit((p) => {
        const target = p.clips.find((c) => c.id === id);
        const link = target?.linkId;
        const mirror: Partial<Clip> = {};
        if (link) for (const k of LINK_FIELDS) if (k in patch) (mirror as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k];
        const hasMirror = !!link && Object.keys(mirror).length > 0;
        return { ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : hasMirror && c.linkId === link && c.id !== id ? { ...c, ...mirror } : c)) };
      }),
    [commit]
  );
  // Collect a clip's id plus any linked partners.
  const withLinked = (p: Project, ids: Iterable<string>): Set<string> => {
    const set = new Set(ids);
    const links = new Set(p.clips.filter((c) => set.has(c.id) && c.linkId).map((c) => c.linkId));
    for (const c of p.clips) if (c.linkId && links.has(c.linkId)) set.add(c.id);
    return set;
  };
  const removeClip = useCallback(
    (id: string) => {
      commit((p) => ({ ...p, clips: p.clips.filter((c) => !withLinked(p, [id]).has(c.id)) }));
      setSelIds((prev) => prev.filter((x) => x !== id));
    },
    [commit]
  );
  const removeMany = useCallback(
    (ids: string[]) => {
      commit((p) => {
        const kill = withLinked(p, ids);
        return { ...p, clips: p.clips.filter((c) => !kill.has(c.id)) };
      });
      setSelIds([]);
    },
    [commit]
  );
  // Shift every selected clip by the same time delta (multi-drag). Linked partners
  // ride along by the same delta so A/V never desyncs.
  const moveMany = useCallback(
    (updates: { id: string; start: number }[]) => {
      commit((p) => {
        const map = new Map(updates.map((u) => [u.id, u.start]));
        const delta = new Map<string, number>();
        for (const u of updates) {
          const c = p.clips.find((x) => x.id === u.id);
          if (c?.linkId) delta.set(c.linkId, u.start - c.start);
        }
        return {
          ...p,
          clips: p.clips.map((c) => {
            if (map.has(c.id)) return { ...c, start: map.get(c.id)! };
            if (c.linkId && delta.has(c.linkId) && !map.has(c.id)) return { ...c, start: Math.max(0, c.start + delta.get(c.linkId)!) };
            return c;
          }),
        };
      });
    },
    [commit]
  );
  const rippleDelete = useCallback(
    (id: string) => {
      const p0 = projectRef.current;
      const c = p0.clips.find((x) => x.id === id);
      if (!c) return;
      // Remove the clip AND any linked partner, then close the gap on EVERY track
      // that lost a clip (so a linked A/V pair ripples together and stays in sync).
      const kill = withLinked(p0, [id]);
      const gap = clipLen(c);
      const killedEndByTrack = new Map<string, number>();
      for (const x of p0.clips) if (kill.has(x.id)) killedEndByTrack.set(x.trackId, Math.max(killedEndByTrack.get(x.trackId) ?? 0, clipEnd(x)));
      commit((p) => ({
        ...p,
        clips: p.clips
          .filter((x) => !kill.has(x.id))
          .map((x) => {
            const end = killedEndByTrack.get(x.trackId);
            return end != null && x.start >= end - 0.001 ? { ...x, start: Math.max(0, x.start - gap) } : x;
          }),
      }));
      setSelId(null);
    },
    [commit]
  );
  const duplicateClip = useCallback(
    (id: string) => {
      const p0 = projectRef.current;
      const c = p0.clips.find((x) => x.id === id);
      if (!c) return;
      const newPrimary = newId();
      const adds: Clip[] = [];
      if (c.linkId) {
        // Duplicate the WHOLE linked group as a fresh, independent pair (a new
        // linkId) — otherwise the copy joined the original's link group and edits
        // mirrored across all of them. Each partner's copy sits right after itself
        // (linked A/V share start/in/out, so they stay aligned).
        const fresh = newId("lk");
        for (const x of p0.clips.filter((x) => x.linkId === c.linkId)) adds.push({ ...x, id: x.id === id ? newPrimary : newId(), linkId: fresh, start: clipEnd(x) });
      } else {
        adds.push({ ...c, id: newPrimary, start: clipEnd(c) });
      }
      commit((p) => ({ ...p, clips: [...p.clips, ...adds] }));
      setSelId(newPrimary);
    },
    [commit]
  );
  // Alt-drag duplicate: copy a clip (+ its linked partner, freshly re-paired) IN
  // PLACE and return the new primary id so the drag can carry the copy away.
  const duplicateForDrag = useCallback(
    (id: string): string | null => {
      const p = projectRef.current;
      const c = p.clips.find((x) => x.id === id);
      if (!c) return null;
      const newPrimary = newId();
      const adds: Clip[] = [];
      if (c.linkId) {
        const fresh = newId("lk");
        for (const x of p.clips.filter((x) => x.linkId === c.linkId)) adds.push({ ...x, id: x.id === id ? newPrimary : newId(), linkId: fresh });
      } else adds.push({ ...c, id: newPrimary });
      commit((pp) => ({ ...pp, clips: [...pp.clips, ...adds] }));
      return newPrimary;
    },
    [commit]
  );
  const detachAudio = useCallback(
    (id: string) => {
      const c = projectRef.current.clips.find((x) => x.id === id);
      if (!c || c.kind !== "video" || !c.path) return;
      commit((p) => {
        let tracks = p.tracks;
        let audioTrack = tracks.find((t) => t.kind === "audio" && !clipsOf(p, t.id).some((cl) => overlaps(cl, c.start, clipEnd(c))));
        if (!audioTrack) {
          audioTrack = { id: newId("t"), kind: "audio", name: `Audio ${tracks.filter((t) => t.kind === "audio").length + 1}`, muted: false, hidden: false, locked: false };
          tracks = [...tracks, audioTrack];
        }
        // The detached audio is an INDEPENDENT clip (no linkId) — "detach" means it
        // no longer rides with the video; sharing the video's linkId made edits
        // mirror across them, the opposite of detaching.
        const audioClip: Clip = { ...c, id: newId(), kind: "audio", trackId: audioTrack.id, opacity: undefined, linkId: undefined };
        const muted: Clip = { ...c, volume: 0 };
        return { ...p, tracks, clips: [...p.clips.map((x) => (x.id === c.id ? muted : x)), audioClip] };
      });
    },
    [commit]
  );
  const removeGaps = useCallback(
    (trackId: string) => {
      commit((p) => {
        const ordered = clipsOf(p, trackId);
        let cursor = 0;
        const moved = new Map<string, number>();
        for (const c of ordered) {
          moved.set(c.id, cursor);
          cursor += clipLen(c);
        }
        return { ...p, clips: p.clips.map((c) => (moved.has(c.id) ? { ...c, start: moved.get(c.id)! } : c)) };
      });
    },
    [commit]
  );

  function splitAtPlayhead() {
    const t = playheadRef.current;
    const p = projectRef.current;
    const hit = (c: Clip) => t > c.start + 0.05 && t < clipEnd(c) - 0.05;
    // Prefer splitting the selected clip under the playhead; else the topmost one.
    const target = p.clips.find((c) => selIdsRef.current.includes(c.id) && hit(c)) || p.clips.find(hit);
    if (!target) return;
    const next = splitClips(p, target.id, t);
    if (next === p.clips) return; // nothing actually split
    commit((pp) => ({ ...pp, clips: next }));
    // Select the right half of the clip we targeted (same track, starts at t).
    const right = next.find((c) => c.trackId === target.trackId && Math.abs(c.start - t) < 0.001);
    if (right) setSelId(right.id);
  }

  // Split a SPECIFIC clip at an arbitrary time (used by the sticky Split tool — you
  // click the clip where you want the cut, not necessarily at the playhead).
  const splitClipAt = useCallback(
    (clipId: string, t: number) => {
      const p = projectRef.current;
      const target = p.clips.find((c) => c.id === clipId);
      if (!target || !(t > target.start + 0.05 && t < clipEnd(target) - 0.05)) return;
      const next = splitClips(p, clipId, t);
      if (next === p.clips) return;
      commit((pp) => ({ ...pp, clips: next }));
      const right = next.find((c) => c.trackId === target.trackId && Math.abs(c.start - t) < 0.001);
      if (right) setSelId(right.id);
    },
    [commit]
  );
  const addMarkerAt = useCallback((t: number) => setMarkers((m) => (m.some((x) => Math.abs(x - t) < 0.05) ? m : [...m, t].sort((a, b) => a - b))), []);

  // Break the A/V link on a clip and its partner so they move/trim/split alone.
  const unlinkClip = useCallback(
    (id: string) =>
      commit((p) => {
        const c = p.clips.find((x) => x.id === id);
        const link = c?.linkId;
        if (!link) return p;
        return { ...p, clips: p.clips.map((x) => (x.linkId === link ? { ...x, linkId: undefined } : x)) };
      }),
    [commit]
  );

  // Remove a whole track (and its clips). Never let the project run out of a base
  // video track + an audio track, so the editor always has somewhere to drop.
  const removeTrack = useCallback(
    (trackId: string) =>
      commit((p) => {
        const tr = p.tracks.find((t) => t.id === trackId);
        if (!tr) return p;
        const sameKind = p.tracks.filter((t) => t.kind === tr.kind);
        if ((tr.kind === "video" || tr.kind === "audio") && sameKind.length <= 1) return p; // keep at least one
        return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId), clips: p.clips.filter((c) => c.trackId !== trackId) };
      }),
    [commit]
  );

  const addText = useCallback((preset?: Partial<Clip>) => {
    const id = newId();
    const base: Omit<Clip, "trackId"> = {
      id,
      kind: "text",
      start: playheadRef.current,
      in: 0,
      out: 3,
      speed: 1,
      name: "Title",
      text: "Your text",
      color: "#ffffff",
      bg: "",
      fontSize: 72,
      fontFamily: "Inter",
      bold: true,
      weight: 800,
      align: "center",
      anim: "fade",
      posX: 0.5,
      posY: 0.5,
      opacity: 1,
      transition: { kind: "none", duration: 0.5 },
      ...preset,
    };
    // Text lives on its own dedicated track at the top — never on a video track.
    commit((p) => {
      let tracks = p.tracks;
      let ttId = tracks.find((t) => t.kind === "text")?.id;
      if (!ttId) {
        const tt: Track = { id: newId("t"), kind: "text", name: "Text", muted: false, hidden: false, locked: false };
        ttId = tt.id;
        tracks = [tt, ...tracks];
      }
      return { ...p, tracks, clips: [...p.clips, { ...base, trackId: ttId } as Clip] };
    });
    setSelId(id);
  }, [commit, setSelId]);

  const patchTrack = useCallback((id: string, patch: Partial<Track>) => commit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })), [commit]);

  // Insert a new empty track of the given kind, just above the track you clicked
  // (or at the top for text). Used by the empty-track right-click "Insert" menu.
  const insertTrack = useCallback(
    (kind: Track["kind"], nearId?: string) =>
      commit((p) => {
        const n = p.tracks.filter((t) => t.kind === kind).length + 1;
        const name = kind === "video" ? `Video ${n}` : kind === "audio" ? `Audio ${n}` : "Text";
        const nt: Track = { id: newId("t"), kind, name, muted: false, hidden: false, locked: false };
        if (kind === "text") return { ...p, tracks: [nt, ...p.tracks.filter((t) => t.kind !== "text" || t.id !== nt.id)] };
        const idx = nearId ? p.tracks.findIndex((t) => t.id === nearId) : -1;
        const tracks = [...p.tracks];
        tracks.splice(idx >= 0 ? idx : tracks.length, 0, nt);
        return { ...p, tracks };
      }),
    [commit]
  );

  async function autoCutSilence() {
    if (!studio || !sel?.path) return;
    setBusy("Analyzing audio…");
    // 1s min silence; voice-band detection in main ignores background music.
    const r = await studio.detectSilence(sel.path, -30, 1.0);
    setBusy(null);
    if (!r.ok || !r.ranges.length) {
      notify({ title: "No long silences found", tone: "info" });
      return;
    }
    const c = sel;
    const pad = 1.0; // keep 1s after speech and 1s before the next speech
    const keep: Clip[] = [];
    let cursor = c.in;
    let cuts = 0;
    for (const g of r.ranges) {
      const gs = clamp(g.start, c.in, c.out);
      const ge = clamp(g.end, c.in, c.out);
      if (ge - gs <= 2 * pad) continue; // too short to cut anything after padding
      const segEnd = Math.min(gs + pad, c.out); // hold 1s into the silence
      // Segments are standalone (linkId dropped): the linked audio partner is not
      // cut here, so keeping the link would mirror edits and desync A/V.
      if (segEnd > cursor + 0.1) keep.push({ ...c, id: newId(), in: cursor, out: segEnd, linkId: undefined });
      cursor = Math.max(cursor, ge - pad); // resume 1s before the next speech
      cuts++;
    }
    if (cursor < c.out - 0.1) keep.push({ ...c, id: newId(), in: cursor, out: c.out, linkId: undefined });
    if (!cuts || !keep.length) {
      notify({ title: "No long silences to cut", desc: "Nothing over ~2s of quiet (with 1s buffers).", tone: "info" });
      return;
    }
    let s = c.start;
    keep.forEach((k) => {
      k.start = s;
      k.transition = { kind: "none", duration: 0.5 };
      s += clipLen(k);
    });
    commit((p) => ({ ...p, clips: [...p.clips.filter((x) => x.id !== c.id), ...keep] }));
    setSelId(keep[0].id);
    notify({ title: `Removed ${cuts} silent gap${cuts > 1 ? "s" : ""}`, tone: "success" });
  }

  // ---- markers / range ----
  // Stable so the (memoized) Ruler doesn't re-render every playhead frame.
  const removeMarker = useCallback((t: number) => setMarkers((m) => m.filter((x) => x !== t)), []);
  const removeAllMarkers = useCallback(() => setMarkers([]), []);
  const jumpMarker = (dir: 1 | -1) => {
    const t = playheadRef.current;
    const next = dir > 0 ? markers.find((m) => m > t + 0.01) : [...markers].reverse().find((m) => m < t - 0.01);
    if (next != null) seek(next);
  };

  // ---- playback (master clock follows the active video for tight A/V sync) ----
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const videoClockRef = useRef<{ t: number | null; progressing: boolean; stalled?: boolean }>({ t: null, progressing: false });
  const bufferingRef = useRef(false);
  const [buffering, setBuffering] = useState(false);

  // Allocation-free lookups (these run on every 60fps playhead tick — clipAt's
  // per-call filter()+sort() churned the GC and stuttered playback).
  const activeMain = mainTrack ? clipAtFast(project.clips, mainTrack.id, playhead) : null;
  const activePip = pipTracks.length ? pipTracks.reduce<Clip | null>((found, t) => found || clipAtFast(project.clips, t.id, playhead), null) : null;
  const hiddenTrackIds = useMemo(() => new Set(project.tracks.filter((t) => t.hidden).map((t) => t.id)), [project.tracks]);
  const activeTexts = project.clips.filter((c) => c.kind === "text" && !hiddenTrackIds.has(c.trackId) && playhead >= c.start && playhead < clipEnd(c));
  // ANY video clip can be moved/resized in the preview frame (webcam PiP, or a
  // punch-in/reframe on the base track). Editable whenever it's under the playhead.
  const selFrameEditable = !!sel && sel.kind === "video" && playhead >= sel.start && playhead < clipEnd(sel);

  const play = () => {
    if (!project.clips.length) return;
    const start = range ? range.a : 0;
    if (playheadRef.current >= (range ? range.b : duration) - 0.05) {
      setPlayhead(start);
      playheadRef.current = start;
    }
    setPlaying(true);
  };
  const stop = () => setPlaying(false);
  const togglePlay = () => (playing ? stop() : play());

  // Click the preview → select the top-most video clip whose frame is under the
  // cursor (so you can grab/resize it right in the preview). Empty hit = play/pause.
  const selectAtPreview = (nx: number, ny: number) => {
    const vts = project.tracks.filter((t) => t.kind === "video" && !t.hidden);
    const baseTrack = vts.length ? vts[vts.length - 1] : null;
    for (let ti = 0; ti < vts.length; ti++) {
      const track = vts[ti];
      const c = clipAt(project, track.id, playhead);
      if (!c || c.kind !== "video") continue;
      const fr = clipFrame(c, !!baseTrack && track.id !== baseTrack.id);
      if (nx >= fr.x && nx <= fr.x + fr.w && ny >= fr.y && ny <= fr.y + fr.h) {
        setSelId(c.id);
        return;
      }
    }
    // Clicked the background (no clip under the cursor): first click clears the
    // selection (removes the resize box); a second clears-then toggles play.
    if (selId) setSelId(null);
    else togglePlay();
  };

  // Snapshot the current preview frame → composite the project bg behind the
  // compositor canvas (which is transparent where there's no video) and save a PNG.
  const snapshotPreview = useCallback(async () => {
    const c = document.querySelector<HTMLCanvasElement>("canvas[data-preview-canvas]");
    if (!c || !studio || c.width < 2) return;
    const tmp = document.createElement("canvas");
    tmp.width = c.width;
    tmp.height = c.height;
    const ctx = tmp.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = projectRef.current.bg || "#000";
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    ctx.drawImage(c, 0, 0);
    const blob = await new Promise<Blob | null>((r) => tmp.toBlob(r, "image/png"));
    if (!blob) return;
    const res = await studio.saveScreenshot(await blob.arrayBuffer());
    if (res?.path) notify({ title: "Frame saved", tone: "success", action: { label: "Open", run: () => studio?.reveal(res.path) } });
  }, []);

  useEffect(() => {
    if (!playing || !active) {
      cancelAnimationFrame(rafRef.current);
      if (bufferingRef.current) {
        bufferingRef.current = false;
        setBuffering(false);
      }
      return;
    }
    lastTsRef.current = performance.now();
    const end = range ? range.b : duration;
    const begin = range ? range.a : 0;
    // Master clock = WALL TIME (the standard media-sync model). It advances
    // smoothly and is independent of any decoder, so it never crawls or freezes —
    // even with several videos decoding at once. Each <video> is a SLAVE that the
    // PreviewPlayer nudges toward this clock by gently trimming its playbackRate
    // (seeking is disruptive, so it's reserved for big jumps). Previously the
    // clock FOLLOWED the base decoder, which spiralled when two videos competed
    // for decode bandwidth (the "two stacked videos lag, pause/resume fixes it"
    // bug — pausing reset the feedback loop).
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTsRef.current) / 1000); // clamp big gaps (tab stalls)
      lastTsRef.current = now;
      let ph = playheadRef.current + dt;
      const vc = videoClockRef.current;
      if (!!vc.stalled !== bufferingRef.current) {
        bufferingRef.current = !!vc.stalled;
        setBuffering(!!vc.stalled);
      }
      if (ph >= end) {
        if (loop) ph = begin;
        else {
          ph = end;
          playheadRef.current = ph;
          setPlayhead(ph);
          setPlaying(false);
          return;
        }
      }
      playheadRef.current = ph;
      setPlayhead(ph);
      autoScroll(ph);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration, range, loop, active]);

  // Leaving the Edit tab pauses playback so we stop seeking videos in the
  // background — keeps section switches snappy and avoids wasted decode work.
  useEffect(() => {
    if (!active && playing) setPlaying(false);
  }, [active, playing]);


  function autoScroll(ph: number) {
    const el = scrollRef.current;
    if (!el) return;
    const x = ph * pxPerSecRef.current;
    if (x < el.scrollLeft + 60 || x > el.scrollLeft + el.clientWidth - 80) el.scrollLeft = x - el.clientWidth * 0.4;
  }

  const seek = useCallback(
    (t: number) => {
      const tt = clamp(t, 0, duration || 0);
      setPlayhead(tt);
      playheadRef.current = tt;
    },
    [duration]
  );

  function zoomToFit() {
    const el = scrollRef.current;
    if (!el || duration <= 0) return setPxPerSec(64);
    setPxPerSec(clamp((el.clientWidth - 40) / (duration + 2), MIN_PPS, MAX_PPS));
  }
  // Zoom while keeping the PLAYHEAD anchored at its on-screen position (or centred if
  // it was off-screen) — so zooming always focuses on where the playhead is.
  function zoomAnchored(next: number) {
    const el = scrollRef.current;
    const nz = clamp(next, MIN_PPS, MAX_PPS);
    const ph = playheadRef.current;
    const screenX = el ? ph * pxPerSec - el.scrollLeft : 0;
    const onScreen = !!el && screenX >= 0 && screenX <= el.clientWidth;
    setPxPerSec(nz);
    requestAnimationFrame(() => {
      const e = scrollRef.current;
      if (!e) return;
      e.scrollLeft = Math.max(0, ph * nz - (onScreen ? screenX : e.clientWidth / 2));
    });
  }

  // ---- keyboard ----
  useEffect(() => {
    // Edit is kept mounted across tabs (keep-alive). Don't even attach the window
    // listener while hidden — otherwise every keystroke on Record/Optimize/Library
    // ran this handler, and the listener was re-bound on every Edit state change.
    if (!active) return;
    const fn = (e: KeyboardEvent) => {
      // Only swallow shortcuts when a real TEXT field is focused — not range
      // sliders / selects / buttons (otherwise Delete stops working after you
      // touch an inspector slider, which keeps focus).
      const el = document.activeElement as HTMLElement | null;
      const tag = (el?.tagName || "").toLowerCase();
      const type = (el as HTMLInputElement | null)?.type || "";
      const isTextField =
        tag === "textarea" ||
        el?.isContentEditable === true ||
        (tag === "input" && !["range", "checkbox", "radio", "button", "submit", "reset", "color", "file"].includes(type));
      if (isTextField) return;
      const meta = e.ctrlKey || e.metaKey;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "Escape") {
        setSelId(null);
        setTool("select");
      } else if ((e.key === "a" || e.key === "A") && meta) {
        e.preventDefault();
        setSelIds(projectRef.current.clips.map((c) => c.id));
      } else if ((e.key === "v" || e.key === "V") && !meta) setTool("select");
      else if ((e.key === "s" || e.key === "S") && !meta) setTool("split");
      else if ((e.key === "t" || e.key === "T") && !meta) setTool("text");
      else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const ids = selIdsRef.current;
        if (ids.length > 1) removeMany(ids);
        else if (ids.length === 1) (e.shiftKey ? rippleDelete : removeClip)(ids[0]);
      } else if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? doRedo() : doUndo();
      } else if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
      } else if (meta && e.key.toLowerCase() === "d" && selId) {
        e.preventDefault();
        duplicateClip(selId);
      } else if ((e.key === "m" || e.key === "M") && !meta) setTool("mark");
      else if ((e.key === "i" || e.key === "I") && !meta) {
        // Set the export range IN point to the playhead (keeps OUT, clamped after).
        const a = playheadRef.current;
        const b = range ? Math.max(range.b, a + 0.1) : duration;
        setRange({ a, b });
      } else if ((e.key === "o" || e.key === "O") && !meta) {
        // Set the export range OUT point to the playhead (keeps IN, clamped before).
        const b = playheadRef.current;
        const a = range ? Math.min(range.a, b - 0.1) : 0;
        setRange({ a, b });
      } else if ((e.key === "x" || e.key === "X") && !meta) setRange(null);
      else if (e.key === "," && !meta) jumpMarker(-1);
      else if (e.key === "." && !meta) jumpMarker(1);
      else if (e.key === "Home" && !meta) seek(0);
      else if (e.key === "End" && !meta) seek(duration);
      else if (e.key === "ArrowLeft" && !meta) seek(playheadRef.current - (e.shiftKey ? 1 / project.fps : 5));
      else if (e.key === "ArrowRight" && !meta) seek(playheadRef.current + (e.shiftKey ? 1 / project.fps : 5));
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selId, selIds, playing, project, duration, markers, range]);

  // ---- drag & drop onto the timeline (bin items + OS files) ----
  const laneWrapRef = useRef<HTMLDivElement>(null);
  // Cumulative row tops, honoring each track's custom height (falls back to the
  // global default). Used for drop hit-testing so variable-height rows still map.
  const trackTops = useCallback(() => {
    const arr: number[] = [];
    let y = 0;
    for (const tr of project.tracks) {
      arr.push(y);
      y += (tr.height ?? layout.track) + 4;
    }
    return arr;
  }, [project.tracks, layout.track]);
  function pointToTrack(clientX: number, clientY: number): { trackId: string | null; t: number; index: number; top: number; h: number } {
    const wrap = laneWrapRef.current;
    if (!wrap) return { trackId: null, t: 0, index: -1, top: 0, h: layout.track };
    const rect = wrap.getBoundingClientRect();
    // rect.left already includes horizontal scroll (laneWrap is inside the scroll
    // content), so don't add scrollLeft again — that misplaced dropped clips.
    const t = Math.max(0, (clientX - rect.left) / pxPerSec);
    const y = clientY - rect.top;
    const tops = trackTops();
    let index = -1;
    for (let i = project.tracks.length - 1; i >= 0; i--) {
      if (y >= tops[i]) {
        index = i;
        break;
      }
    }
    const track = index >= 0 ? project.tracks[index] : null;
    return { trackId: track?.id ?? null, t, index, top: index >= 0 ? tops[index] : 0, h: track ? track.height ?? layout.track : layout.track };
  }

  function onLaneDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes(MEDIA_DND) && !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    const { trackId, t, top, h } = pointToTrack(e.clientX, e.clientY);
    const track = project.tracks.find((x) => x.id === trackId);
    const info = dragMediaInfo;
    const kind = info?.kind ?? "video";
    const dur = Math.max(0.4, info?.dur || 5);
    // Incompatible if the hovered track's kind doesn't match the media kind.
    const occupied = track ? clipsOf(project, track.id).some((c) => overlaps(c, t, t + dur)) : false;
    const newTrack = !track || track.kind !== kind || occupied;
    setDropHint({ trackId, t, newTrack, dur, name: info?.name ?? "Clip", kind, top, h });
  }

  async function onLaneDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropHint(null);
    const { trackId, t } = pointToTrack(e.clientX, e.clientY);
    let item: MediaItem | null = null;
    const raw = e.dataTransfer.getData(MEDIA_DND);
    if (raw) {
      try {
        const m = JSON.parse(raw) as MediaItem;
        item = media.find((x) => x.id === m.id) || m;
      } catch {
        /* noop */
      }
    } else if (e.dataTransfer.files?.length) {
      const f = e.dataTransfer.files[0];
      const p = dropPath(f);
      if (p) item = await addToBin(p, f.name);
    }
    if (!item) return;
    dropClipAt(item, trackId, t);
  }

  function dropClipAt(item: MediaItem, trackId: string | null, t: number) {
    const cur = projectRef.current;
    const track = cur.tracks.find((x) => x.id === trackId);
    const wantKind = item.kind;
    const len = clipLen(makeClip(item, trackId || "x", t));
    const occupied = track && track.kind === wantKind ? clipsOf(cur, track.id).some((c) => overlaps(c, t, t + len)) : false;
    const needNewTrack = !track || track.kind !== wantKind || occupied;

    let tracks = cur.tracks;
    let vTrackId = trackId || "";
    let flashId: string | null = null;
    if (needNewTrack) {
      const newTrack: Track = {
        id: newId("t"),
        kind: wantKind,
        name: `${wantKind === "video" ? "Video" : "Audio"} ${cur.tracks.filter((x) => x.kind === wantKind).length + 1}`,
        muted: false,
        hidden: false,
        locked: false,
      };
      // text tracks stay pinned at top; video tracks above audio; new video stacks above.
      const texts = cur.tracks.filter((x) => x.kind === "text");
      const vids = cur.tracks.filter((x) => x.kind === "video");
      const auds = cur.tracks.filter((x) => x.kind === "audio");
      tracks = wantKind === "video" ? [...texts, newTrack, ...vids, ...auds] : [...texts, ...vids, ...auds, newTrack];
      vTrackId = newTrack.id;
      flashId = newTrack.id;
    }

    let clips: Clip[];
    let selectId: string;
    if (wantKind === "video") {
      // A dropped video ALWAYS brings its linked audio (this was the "drops without
      // audio" bug), spawning a stacked audio lane when needed.
      const plan = planVideoDrop({ ...cur, tracks }, item, vTrackId, t);
      tracks = plan.tracks;
      clips = plan.clips;
      selectId = plan.selectId;
    } else {
      const clip = makeClip(item, vTrackId, t);
      clips = [...cur.clips, clip];
      selectId = clip.id;
    }

    commit((p) => ({ ...p, tracks, clips }));
    setSelId(selectId);
    if (flashId) {
      setFlashTrack(flashId);
      setTimeout(() => setFlashTrack(null), 700);
    }
  }

  const hasClips = project.clips.length > 0;
  const aspectRatio = `${project.width}/${project.height}`;

  // ---- stable handlers for the memoized TimelineView ----
  // The master clock re-renders Edit ~60x/s during playback. For <TimelineView>
  // (memoized) to actually bail, EVERY prop must keep a stable identity. Some
  // underlying handlers are plain functions (recreated each render); we route
  // them through a ref that always holds the latest closures, and expose a
  // single set of identity-stable useCallback wrappers. (Setters from useState
  // and the useCallback handlers above are already stable and passed directly.)
  const liveRef = useRef<{
    sel: Clip | null;
    addText: typeof addText;
    splitAtPlayhead: () => void;
    onLaneDragOver: (e: React.DragEvent) => void;
    onLaneDrop: (e: React.DragEvent) => void;
    duplicateClip: typeof duplicateClip;
    removeClip: typeof removeClip;
    rippleDelete: typeof rippleDelete;
    detachAudio: typeof detachAudio;
    unlinkClip: typeof unlinkClip;
    removeGaps: typeof removeGaps;
    updateClip: typeof updateClip;
    applyAspect: typeof applyAspect;
    autoCutSilence: typeof autoCutSilence;
    importFiles: typeof importFiles;
    importLastRecording: typeof importLastRecording;
  }>(null as never);
  liveRef.current = { sel, addText, splitAtPlayhead, onLaneDragOver, onLaneDrop, duplicateClip, removeClip, rippleDelete, detachAudio, unlinkClip, removeGaps, updateClip, applyAspect, autoCutSilence, importFiles, importLastRecording };

  const tlHeaderW = useCallback((w: number) => setLayout((l) => ({ ...l, header: clamp(w, 92, 280) })), []);
  const tlAddTextAt = useCallback((t: number) => liveRef.current.addText({ start: t }), []);
  const tlToggleLoop = useCallback(() => setLoop((v) => !v), []);
  const tlToggleSnap = useCallback(() => setSnapping((v) => !v), []);
  const tlToggleRipple = useCallback(() => setRipple((v) => !v), []);
  const tlDragLeave = useCallback(() => setDropHint(null), []);
  const tlDragOver = useCallback((e: React.DragEvent) => liveRef.current.onLaneDragOver(e), []);
  const tlDrop = useCallback((e: React.DragEvent) => liveRef.current.onLaneDrop(e), []);
  const tlMoveClip = useCallback(
    (id: string, trackId: string, start: number) =>
      commit((p) => {
        const moved = p.clips.find((c) => c.id === id);
        const link = moved?.linkId;
        const delta = moved ? start - moved.start : 0;
        return { ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, trackId, start } : link && c.linkId === link && c.id !== id ? { ...c, start: Math.max(0, c.start + delta) } : c)) };
      }),
    [commit]
  );
  // Stable handlers for the (memoized) Inspector + MediaBin so they bail during
  // playback. They read the latest `sel`/closures from liveRef.
  const insOnAspect = useCallback((id: string) => liveRef.current.applyAspect(id, projectRef.current.width, projectRef.current.height), []);
  const insOnChange = useCallback((patch: Partial<Clip>) => { const s = liveRef.current.sel; if (s) liveRef.current.updateClip(s.id, patch); }, []);
  const insOnDelete = useCallback(() => { const s = liveRef.current.sel; if (s) liveRef.current.removeClip(s.id); }, []);
  const insOnRipple = useCallback(() => { const s = liveRef.current.sel; if (s) liveRef.current.rippleDelete(s.id); }, []);
  const insOnDuplicate = useCallback(() => { const s = liveRef.current.sel; if (s) liveRef.current.duplicateClip(s.id); }, []);
  const insOnDetach = useCallback(() => { const s = liveRef.current.sel; if (s) liveRef.current.detachAudio(s.id); }, []);
  const insOnAutoCut = useCallback(() => liveRef.current.autoCutSilence(), []);
  const insOnAddKeyframe = useCallback(() => {
    const s = liveRef.current.sel;
    if (!s) return;
    const relT = Math.max(0, playheadRef.current - s.start);
    const pos = clipFrameAt(s, isOverlayClip(projectRef.current, s), relT);
    liveRef.current.updateClip(s.id, { kf: upsertKeyframe(s.kf, relT, pos.x, pos.y) });
  }, []);
  const insOnClearMotion = useCallback(() => { const s = liveRef.current.sel; if (s) liveRef.current.updateClip(s.id, { kf: undefined }); }, []);
  const binOnImport = useCallback(() => liveRef.current.importFiles(), []);
  const binOnImportLast = useCallback(() => liveRef.current.importLastRecording(), []);

  const tlContextAction = useCallback((action: string, id: string) => {
    const L = liveRef.current;
    if (action === "split") L.splitAtPlayhead();
    else if (action === "duplicate") L.duplicateClip(id);
    else if (action === "delete") L.removeClip(id);
    else if (action === "ripple") L.rippleDelete(id);
    else if (action === "detach") L.detachAudio(id);
    else if (action === "unlink") L.unlinkClip(id);
    else if (action === "removeGaps") {
      const c = projectRef.current.clips.find((x) => x.id === id);
      if (c) L.removeGaps(c.trackId);
    }
  }, []);

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      {/* header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">
            <Clapperboard className="h-4 w-4" strokeWidth={2} />
          </span>
          <h1 className="text-[16px] font-700 tracking-tight text-ink">Edit Studio</h1>
          {hasClips && (
            <>
              <Tag mono>{fmtTime(duration)}</Tag>
              <Tag tone="accent" mono>
                {project.clips.length} clip{project.clips.length > 1 ? "s" : ""}
              </Tag>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <IconAction icon={Undo2} label="Undo" disabled={!undo.current.length} onClick={doUndo} />
          <IconAction icon={Redo2} label="Redo" disabled={!redo.current.length} onClick={doRedo} />
          <IconAction icon={Keyboard} label="Shortcuts" onClick={() => setShortcutsOpen(true)} />
          <div className="mx-1 h-5 w-px bg-line" />
          <Btn variant="ghost" icon={Upload} onClick={importFiles}>
            Import
          </Btn>
          <Btn variant="primary" icon={Download} disabled={!hasClips} onClick={() => setExportOpen(true)}>
            Export
          </Btn>
        </div>
      </div>

      {/* media bin + preview + inspector */}
      <div className="flex min-h-0 flex-1">
        <div style={{ width: layout.bin }} className="min-h-0 shrink-0">
          <MediaBin items={media} onImport={binOnImport} onImportLast={binOnImportLast} onAppend={appendClip} onRemove={removeFromBin} onDropPath={addToBin} onOpenLibrary={onOpenLibrary} busy={busy} />
        </div>
        <ResizeHandle axis="x" onReset={() => setLayout((l) => ({ ...l, bin: DEFAULT_LAYOUT.bin }))} onDelta={(dx) => setLayout((l) => ({ ...l, bin: clamp(l.bin + dx, 150, 460) }))} />

        <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div ref={previewAreaRef} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg border border-line bg-sunken p-3">
          {hasClips ? (
            <div
              ref={bgElRef}
              className="relative rounded-lg shadow-[0_8px_28px_oklch(0_0_0_/_0.35)]"
              style={{ width: previewBox.w || "100%", height: previewBox.h || undefined, aspectRatio: previewBox.w ? undefined : aspectRatio, background: project.bg || "#000", containerType: "size" }}
              onContextMenu={(e) => {
                // Right-click the preview surface → quick "Change background colour".
                e.preventDefault();
                setBgMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              {/* visual content is clipped to the rounded frame… */}
              <div className="absolute inset-0 overflow-hidden rounded-lg">
                <PreviewPlayer project={project} playhead={playhead} playing={playing} active={active} onTogglePlay={togglePlay} onStageClick={selectAtPreview} clockRef={videoClockRef} proxyMap={proxyMap} />
                {activeTexts.map((t) => (
                  <TextOverlay key={t.id} clip={t} playhead={playhead} onEditText={(text) => updateClip(t.id, { text })} />
                ))}
                {!activeMain && !activePip && activeTexts.length === 0 && <div className="absolute inset-0 grid place-items-center text-[12px] text-dim">No clip at playhead</div>}
                {buffering && (
                  <div className="pointer-events-none absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 backdrop-blur">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/25 border-t-accent" />
                    <span className="text-[11px] font-600 text-white/85">Buffering</span>
                  </div>
                )}
              </div>
              {/* …but the resize box/handles sit ON TOP, never clipped by the radius */}
              {selFrameEditable && sel && (
                <FrameEditor
                  key={sel.id}
                  frame={clipFrameAt(sel, isOverlayClip(project, sel), playhead - sel.start)}
                  videoPath={sel.path}
                  onCommit={(f) => {
                    // In motion mode (≥1 keyframe) a drag writes/updates the keyframe
                    // at the current playhead; size still lives on the static frame.
                    if (sel.kf && sel.kf.length) updateClip(sel.id, { frame: { ...(sel.frame ?? { x: 0, y: 0, w: 1, h: 1 }), w: f.w, h: f.h }, kf: upsertKeyframe(sel.kf, Math.max(0, playhead - sel.start), f.x, f.y) });
                    else updateClip(sel.id, { frame: f });
                  }}
                  onReset={() => updateClip(sel.id, { frame: { x: 0, y: 0, w: 1, h: 1 }, kf: undefined })}
                />
              )}
            </div>
          ) : (
            <EmptyPreview onImport={importFiles} onImportLast={importLastRecording} onDropFile={(p, n) => addToBin(p, n)} />
          )}
          {/* Invisible border detectors on the preview itself — grab any edge to
              resize the surrounding panels (bin / inspector / timeline) without
              hunting for the thin dividers, like pro editors. */}
          <EdgeResizers
            left={{ value: layout.bin, min: 150, max: 460, snap: [DEFAULT_LAYOUT.bin], onChange: (v) => setLayout((l) => ({ ...l, bin: v })), onReset: () => setLayout((l) => ({ ...l, bin: DEFAULT_LAYOUT.bin })) }}
            right={{ value: layout.inspector, min: 230, max: 520, snap: [DEFAULT_LAYOUT.inspector], onChange: (v) => setLayout((l) => ({ ...l, inspector: v })), onReset: () => setLayout((l) => ({ ...l, inspector: DEFAULT_LAYOUT.inspector })) }}
            bottom={{ value: layout.timeline, min: 150, max: 620, snap: [DEFAULT_LAYOUT.timeline], onChange: (v) => setLayout((l) => ({ ...l, timeline: v })), onReset: () => setLayout((l) => ({ ...l, timeline: DEFAULT_LAYOUT.timeline })) }}
          />
        </div>
        {/* compact player — sits directly UNDER the preview, never covering it */}
        {hasClips && (
          <PreviewTransport
            playing={playing}
            playhead={playhead}
            duration={duration}
            onToggle={togglePlay}
            onSkip={(d) => seek(playheadRef.current + d)}
            onScrub={seek}
            onSnapshot={snapshotPreview}
            onFullscreen={() => previewAreaRef.current?.requestFullscreen?.().catch(() => {})}
          />
        )}
        </div>

        <ResizeHandle axis="x" onReset={() => setLayout((l) => ({ ...l, inspector: DEFAULT_LAYOUT.inspector }))} onDelta={(dx) => setLayout((l) => ({ ...l, inspector: clamp(l.inspector - dx, 230, 520) }))} />
        <div style={{ width: layout.inspector }} className="min-h-0 shrink-0">
          <Inspector
            sel={sel}
            project={project}
            aspect={aspect}
            onAspect={insOnAspect}
            onBg={setBgLive}
            onChange={insOnChange}
            onDelete={insOnDelete}
            onRipple={insOnRipple}
            onDuplicate={insOnDuplicate}
            onDetach={insOnDetach}
            onAutoCut={insOnAutoCut}
            onAddText={addText}
            onAddKeyframe={insOnAddKeyframe}
            onClearMotion={insOnClearMotion}
            busy={busy}
          />
        </div>
      </div>

      {/* transport */}
      <div className="flex shrink-0 items-center gap-2 px-1">
        <button onClick={togglePlay} disabled={!hasClips} aria-label={playing ? "Pause" : "Play"} className="focus-ring grid h-9 w-9 place-items-center rounded-lg bg-accent text-[var(--on-accent)] disabled:opacity-40">
          {playing ? (
            <span className="flex gap-0.5">
              <span className="h-3.5 w-1 rounded-sm bg-current" />
              <span className="h-3.5 w-1 rounded-sm bg-current" />
            </span>
          ) : (
            <span className="ml-0.5 h-0 w-0 border-y-[7px] border-l-[11px] border-y-transparent border-l-current" />
          )}
        </button>
        <span className="font-mono text-[12px] text-muted tnum">
          {fmtTime(playhead)} <span className="text-dim">/ {fmtTime(duration)}</span>
        </span>
        <div className="ml-1 flex items-center gap-1">
          {/* Split / Text / Marker + Snapping / Ripple / Loop now live in the timeline
              header as sticky tools — only the aspect control stays in the transport. */}
          <div className="flex items-center gap-1.5" title="Canvas aspect ratio">
            <Maximize className="h-3.5 w-3.5 text-dim" strokeWidth={2} />
            <div className="w-[148px]">
              <Select
                value={aspect}
                onChange={(id) => applyAspect(id, project.width, project.height)}
                options={[{ label: "Match first clip", value: "source" }, ...ASPECTS.map((a) => ({ label: a.label, value: a.id }))]}
              />
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <IconAction icon={Maximize} label="Zoom to fit" onClick={zoomToFit} />
          <button onClick={() => zoomAnchored(pxPerSec / 1.4)} aria-label="Zoom out" className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-ink">
            <ZoomOut className="h-4 w-4" strokeWidth={2} />
          </button>
          <div className="w-24">
            {/* cubic zoom: lots of fine control at the low end, coarse at the top
                (a linear 8→320 slider felt twitchy), matching pro NLEs. */}
            <Slider value={Math.round(Math.cbrt((clamp(pxPerSec, MIN_PPS, MAX_PPS) - MIN_PPS) / (MAX_PPS - MIN_PPS)) * 100)} min={0} max={100} step={1} onChange={(v) => zoomAnchored(Math.round(MIN_PPS + Math.pow(v / 100, 3) * (MAX_PPS - MIN_PPS)))} />
          </div>
          <button onClick={() => zoomAnchored(pxPerSec * 1.4)} aria-label="Zoom in" className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-ink">
            <ZoomIn className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* drag to resize the timeline height */}
      <ResizeHandle axis="y" onReset={() => setLayout((l) => ({ ...l, timeline: DEFAULT_LAYOUT.timeline }))} onDelta={(dy) => setLayout((l) => ({ ...l, timeline: clamp(l.timeline - dy, 150, 620) }))} />

      {/* timeline */}
      <TimelineView
        project={project}
        pxPerSec={pxPerSec}
        phStore={phStore}
        duration={duration}
        height={layout.timeline}
        headerW={layout.header}
        onHeaderW={tlHeaderW}
        trackH={layout.track}
        selId={selId}
        selIds={selIds}
        onToggleSelect={toggleSelect}
        onAddSelect={addSelect}
        onSelectMany={setSelIds}
        onMoveMany={moveMany}
        snapping={snapping}
        ripple={ripple}
        tool={tool}
        onSetTool={setTool}
        onSplitAt={splitClipAt}
        onAltDuplicate={duplicateForDrag}
        onAddTextAt={tlAddTextAt}
        onAddMarkAt={addMarkerAt}
        loop={loop}
        onToggleLoop={tlToggleLoop}
        onToggleSnap={tlToggleSnap}
        onToggleRipple={tlToggleRipple}
        markers={markers}
        range={range}
        flashTrack={flashTrack}
        dropHint={dropHint}
        snapGuide={snapGuide}
        scrollRef={scrollRef}
        laneWrapRef={laneWrapRef}
        onSelect={setSelId}
        onSeek={seek}
        onCommit={commit}
        onUpdateClip={updateClip}
        onMoveClip={tlMoveClip}
        onPatchTrack={patchTrack}
        onDeleteTrack={removeTrack}
        onInsertTrack={insertTrack}
        onContextAction={tlContextAction}
        onSetZoom={setPxPerSec}
        onSnapGuide={setSnapGuide}
        onDragOver={tlDragOver}
        onDrop={tlDrop}
        onDragLeave={tlDragLeave}
        onSetRange={setRange}
        onRemoveMarker={removeMarker}
        onRemoveAllMarkers={removeAllMarkers}
        onDragStartClip={beginDrag}
        onDragEndClip={endDragCommit}
      />

      <AnimatePresence>{exportOpen && <ExportModal project={project} range={range} onClose={() => setExportOpen(false)} />}</AnimatePresence>
      <AnimatePresence>{shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}</AnimatePresence>

      {/* hidden colour picker driven by the preview right-click menu */}
      <input ref={bgPickRef} type="color" value={project.bg || "#000000"} onChange={(e) => setBgLive(e.target.value)} className="pointer-events-none fixed h-0 w-0 opacity-0" tabIndex={-1} />
      <AnimatePresence>
        {bgMenu && (
          <>
            <div className="fixed inset-0 z-[59]" onPointerDown={() => setBgMenu(null)} onContextMenu={(e) => { e.preventDefault(); setBgMenu(null); }} />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="fixed z-[60] w-52 rounded-xl border border-line bg-[var(--bg-elevated,#1a1b22)] p-1 shadow-[0_10px_30px_oklch(0_0_0_/_0.5)] ring-1 ring-black/40"
              style={{ left: Math.min(bgMenu.x, window.innerWidth - 220), top: Math.min(bgMenu.y, window.innerHeight - 100) }}
            >
              <button onClick={() => { bgPickRef.current?.click(); setBgMenu(null); }} className="focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-ink">
                <span className="h-4 w-4 shrink-0 rounded border border-line" style={{ background: project.bg || "#000" }} /> Change background colour
              </button>
              <button onClick={() => { setSelId(null); setBgMenu(null); }} className="focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-ink">
                <Workflow className="h-4 w-4 shrink-0 text-dim" strokeWidth={2} /> Deselect clip
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- helpers ---------- */
function makeClip(item: MediaItem, trackId: string, start: number): Clip {
  return {
    id: newId(),
    kind: item.kind,
    trackId,
    start,
    in: 0,
    out: item.dur || 5,
    speed: 1,
    name: item.name,
    path: item.path,
    srcDuration: item.dur || 5,
    volume: 1,
    opacity: 1,
    fadeIn: 0,
    fadeOut: 0,
    contrast: 1,
    saturate: 1,
    brightness: 0,
    transition: { kind: "none", duration: 0.5 },
  };
}
const overlaps = (c: Clip, a: number, b: number) => c.start < b && clipEnd(c) > a;

// Place a VIDEO clip plus its LINKED audio clip. The audio lands on the first
// audio track that's free at [t, t+len]; if every audio track is occupied there
// (e.g. a second video dropped over the first), a fresh audio track is spawned so
// each video keeps its own audio lane. Returns the new tracks/clips + select id.
function planVideoDrop(p: Project, item: MediaItem, vTrackId: string, t: number): { tracks: Track[]; clips: Clip[]; selectId: string } {
  const linkId = newId("lk");
  const vClip: Clip = { ...makeClip(item, vTrackId, t), linkId };
  const len = clipLen(vClip);
  let tracks = p.tracks;
  let aTrack = tracks.find((tr) => tr.kind === "audio" && !tr.locked && !p.clips.some((c) => c.trackId === tr.id && overlaps(c, t, t + len)));
  if (!aTrack) {
    aTrack = { id: newId("t"), kind: "audio", name: `Audio ${tracks.filter((x) => x.kind === "audio").length + 1}`, muted: false, hidden: false, locked: false };
    tracks = [...tracks, aTrack];
  }
  const aClip: Clip = { ...makeClip(item, aTrack.id, t), kind: "audio", linkId, opacity: undefined };
  return { tracks, clips: [...p.clips, vClip, aClip], selectId: vClip.id };
}

/* ---------- small UI atoms ---------- */
function IconAction({ icon: Icon, label, onClick, active, disabled }: { icon: typeof Plus; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx("focus-ring grid h-8 w-8 place-items-center rounded-lg transition-colors disabled:opacity-30", active ? "bg-accent-soft text-accent" : "text-dim hover:bg-hover hover:text-ink")}
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}

/* ---------- Floating preview transport (see reference) ---------- */
function PreviewTransport({
  playing,
  playhead,
  duration,
  onToggle,
  onSkip,
  onScrub,
  onSnapshot,
  onFullscreen,
}: {
  playing: boolean;
  playhead: number;
  duration: number;
  onToggle: () => void;
  onSkip: (delta: number) => void;
  onScrub: (t: number) => void;
  onSnapshot: () => void;
  onFullscreen: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pct = duration > 0 ? clamp((playhead / duration) * 100, 0, 100) : 0;
  const seekAt = (clientX: number) => {
    const el = barRef.current;
    if (!el || duration <= 0) return;
    const r = el.getBoundingClientRect();
    onScrub(clamp((clientX - r.left) / r.width, 0, 1) * duration);
  };
  const mmss = (s: number) => {
    if (!isFinite(s) || s < 0) s = 0;
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
  };
  // In-flow player bar — sits directly under the preview, never covering it.
  return (
    <div className="flex w-full justify-center">
      <div className="flex w-full max-w-[680px] items-center gap-2.5 rounded-2xl border border-line/80 bg-gradient-to-b from-panel2 to-[var(--bg-sunken)] px-3.5 py-2 shadow-[0_4px_18px_oklch(0_0_0_/_0.28),inset_0_1px_0_oklch(1_0_0_/_0.04)]">
        <TransportBtn label="Back 5s" onClick={() => onSkip(-5)}>
          <SkipBack className="h-4 w-4" strokeWidth={2.2} fill="currentColor" />
        </TransportBtn>
        <button
          onClick={onToggle}
          aria-label={playing ? "Pause" : "Play"}
          className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[var(--on-accent)] transition-transform hover:scale-105 active:scale-95"
        >
          {playing ? <Pause className="h-4 w-4" strokeWidth={0} fill="currentColor" /> : <Play className="ml-px h-4 w-4" strokeWidth={0} fill="currentColor" />}
        </button>
        <TransportBtn label="Forward 5s" onClick={() => onSkip(5)}>
          <SkipForward className="h-4 w-4" strokeWidth={2.2} fill="currentColor" />
        </TransportBtn>
        <span className="font-mono text-[11px] font-600 text-ink tnum">{mmss(playhead)}</span>
        {/* draggable scrubber — fills the bar */}
        <div
          ref={barRef}
          onPointerDown={(e) => {
            dragging.current = true;
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            seekAt(e.clientX);
          }}
          onPointerMove={(e) => dragging.current && seekAt(e.clientX)}
          onPointerUp={(e) => {
            dragging.current = false;
            try {
              (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
            } catch {
              /* noop */
            }
          }}
          className="group relative flex h-4 min-w-0 flex-1 cursor-pointer items-center"
        >
          <div className="relative h-[5px] w-full overflow-hidden rounded-full bg-line-strong/40 shadow-[inset_0_1px_2px_oklch(0_0_0_/_0.4)]">
            {/* the "line of time" — accent fill with a soft glow trailing the head */}
            <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent/80 to-accent shadow-[0_0_10px_oklch(0.78_0.13_80_/_0.7)]" style={{ width: `${pct}%` }} />
          </div>
          <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_1px_4px_oklch(0_0_0_/_0.4),0_0_10px_oklch(0.78_0.13_80_/_0.6)] ring-2 ring-[var(--bg-sunken)] transition-transform group-hover:scale-125" style={{ left: `${pct}%` }} />
        </div>
        <span className="font-mono text-[11px] font-600 text-dim tnum">{mmss(duration)}</span>
        {/* right-side actions next to the end time */}
        <div className="ml-0.5 flex items-center gap-0.5 border-l border-line/60 pl-1.5">
          <TransportBtn label="Save frame (snapshot)" onClick={onSnapshot}>
            <Camera className="h-4 w-4" strokeWidth={2} />
          </TransportBtn>
          <TransportBtn label="Fullscreen preview" onClick={onFullscreen}>
            <Maximize className="h-4 w-4" strokeWidth={2} />
          </TransportBtn>
        </div>
      </div>
    </div>
  );
}
function TransportBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
}

/* ---------- Media bin ---------- */
const MediaBin = memo(function MediaBin({
  items,
  onImport,
  onImportLast,
  onAppend,
  onRemove,
  onDropPath,
  onOpenLibrary,
  busy,
}: {
  items: MediaItem[];
  onImport: () => void;
  onImportLast: () => void;
  onAppend: (m: MediaItem) => void;
  onRemove: (id: string) => void;
  onDropPath: (path: string, name: string) => void;
  onOpenLibrary?: () => void;
  busy: string | null;
}) {
  const sel = useGridSelect(items.map((m) => m.id));
  const [over, setOver] = useState(false);
  return (
    <Dock title="Media" icon={Layers} className="h-full w-full" bodyClass="p-2 overflow-auto">
      <div
        className={cx("relative flex min-h-full flex-col rounded-lg transition-colors", over && "outline-2 outline-dashed -outline-offset-2 outline-accent")}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (!over) setOver(true);
          }
        }}
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!e.dataTransfer.files?.length) return;
          for (const f of Array.from(e.dataTransfer.files)) {
            const p = dropPath(f);
            if (p) onDropPath(p, f.name);
          }
        }}
      >
        {over && (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg bg-accent-soft/70 backdrop-blur-[1px]">
            <span className="flex flex-col items-center gap-1 text-accent">
              <Upload className="h-6 w-6" strokeWidth={2} />
              <span className="text-[12px] font-700">Drop to add</span>
            </span>
          </div>
        )}
        <div className="space-y-1.5">
          <Btn variant="primary" full size="sm" icon={Upload} onClick={onImport}>
            Import
          </Btn>
          {onOpenLibrary && (
            <Btn variant="subtle" full size="sm" icon={LibraryBig} onClick={onOpenLibrary}>
              Import from library
            </Btn>
          )}
          <Btn variant="subtle" full size="sm" icon={Clapperboard} onClick={onImportLast} disabled={!!busy}>
            {busy ? "Loading…" : "Last recording"}
          </Btn>
        </div>
        {sel.selected.size > 0 && (
          <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft/40 px-2 py-1.5">
            <span className="text-[11.5px] font-700 text-ink">{sel.selected.size} selected</span>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => items.filter((m) => sel.selected.has(m.id)).forEach(onAppend)} title="Add all to timeline" className="focus-ring grid h-6 w-6 place-items-center rounded text-accent hover:bg-hover">
                <Plus className="h-4 w-4" strokeWidth={2.2} />
              </button>
              <button
                onClick={() => {
                  sel.selected.forEach((id) => onRemove(id));
                  sel.clear();
                }}
                title="Remove from media"
                className="focus-ring grid h-6 w-6 place-items-center rounded text-dim hover:bg-rec-soft hover:text-rec"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
              <button onClick={sel.clear} title="Clear selection" className="focus-ring grid h-6 w-6 place-items-center rounded text-dim hover:bg-hover hover:text-ink">
                <Plus className="h-4 w-4 rotate-45" strokeWidth={2.2} />
              </button>
            </div>
          </div>
        )}
        <div {...sel.bind} className="relative mt-2.5 flex-1">
          {items.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((m) => (
                <MediaTile key={m.id} item={m} onAppend={onAppend} onRemove={() => onRemove(m.id)} selected={sel.selected.has(m.id)} onSelectClick={(e) => sel.clickSelect(m.id, e)} />
              ))}
            </div>
          ) : (
            <div className="grid h-full place-items-center px-2 text-center text-[11px] leading-snug text-dim">Drag &amp; drop video/audio anywhere here, or use Import. Then drag clips onto the timeline.</div>
          )}
        </div>
      </div>
      {sel.marquee && sel.marquee.w > 2 && sel.marquee.h > 2 && (
        <div className="pointer-events-none fixed z-[55] rounded-[3px] border border-accent bg-accent/15" style={{ left: sel.marquee.x, top: sel.marquee.y, width: sel.marquee.w, height: sel.marquee.h }} />
      )}
    </Dock>
  );
});

const MediaTile = memo(function MediaTile({ item, onAppend, onRemove, selected, onSelectClick }: { item: MediaItem; onAppend: (m: MediaItem) => void; onRemove: () => void; selected?: boolean; onSelectClick?: (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (item.kind !== "video" || !item.path) return;
    let live = true;
    // Single poster frame from the main process (same generator as the Library) —
    // no renderer-side video decoding.
    studio?.generateThumb(item.path)
      .then((d) => live && d && setThumb(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [item.path, item.kind, item.dur]);
  return (
    <div
      data-sel-id={item.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MEDIA_DND, JSON.stringify(item));
        e.dataTransfer.effectAllowed = "copy";
        dragMediaInfo = { dur: item.dur || 5, name: item.name, kind: item.kind };
      }}
      onDragEnd={() => {
        dragMediaInfo = null;
      }}
      onClickCapture={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          onSelectClick?.(e);
        }
      }}
      onDoubleClick={() => onAppend(item)}
      title={`${item.name} — drag onto the timeline or double-click to append`}
      className={cx("group cursor-grab overflow-hidden rounded-lg border bg-panel2 transition-colors hover:border-accent/70 hover:bg-hover active:cursor-grabbing", selected ? "border-accent ring-1 ring-accent" : "border-line/60")}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {item.kind === "audio" ? (
          <div className="grid h-full w-full place-items-center bg-sunken text-dim">
            <Music className="h-5 w-5" strokeWidth={2} />
          </div>
        ) : thumb ? (
          <img src={thumb} alt="" className="h-full w-full animate-[fadein_.25s_ease] object-cover" draggable={false} />
        ) : (
          <div className="relative h-full w-full overflow-hidden bg-sunken">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
          </div>
        )}
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 font-mono text-[9px] font-600 text-white tnum">{fmtTime(item.dur).replace(/\.\d+$/, "")}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Remove from media"
          title="Remove from media"
          className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-md bg-black/60 text-white/90 opacity-0 backdrop-blur-sm transition-opacity hover:bg-rec group-hover:opacity-100"
        >
          <Plus className="h-3.5 w-3.5 rotate-45" strokeWidth={2.4} />
        </button>
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/25">
          <span className="grid h-7 w-7 scale-90 place-items-center rounded-full bg-accent/90 text-[var(--on-accent)] opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100">
            <Plus className="h-4 w-4" strokeWidth={2.4} />
          </span>
        </span>
      </div>
      <div className="truncate px-1.5 py-1 text-[11px] font-500 text-ink">{item.name}</div>
    </div>
  );
});

/* ---------- Empty preview ---------- */
function EmptyPreview({ onImport, onImportLast, onDropFile }: { onImport: () => void; onImportLast: () => void; onDropFile: (path: string, name: string) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        const p = f ? dropPath(f) : "";
        if (f && p) onDropFile(p, f.name);
      }}
      className={cx("m-6 flex h-[calc(100%-3rem)] w-[calc(100%-3rem)] flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed transition-colors", over ? "border-accent bg-accent-soft/40" : "border-line-strong/60")}
    >
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Upload className="h-8 w-8" strokeWidth={1.7} />
      </span>
      <div className="text-center">
        <div className="text-[16px] font-700 text-ink">Add a video to start editing</div>
        <p className="mt-1 text-[12.5px] text-muted">Drop files here to add them to the Media bin, then drag a clip onto the timeline. Or use the buttons below.</p>
      </div>
      <div className="flex items-center gap-2">
        <Btn variant="primary" icon={Upload} onClick={onImport}>
          Import video
        </Btn>
        <Btn variant="subtle" icon={Clapperboard} onClick={onImportLast}>
          Import last recording
        </Btn>
      </div>
    </div>
  );
}

/* ---------- Text overlay (preview) ---------- */
function TextOverlay({ clip, playhead, onEditText }: { clip: Clip; playhead: number; onEditText?: (text: string) => void }) {
  const editRef = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState(false);
  const t = playhead - clip.start;
  const dur = clipLen(clip);
  const p = clamp(t / Math.max(0.001, dur), 0, 1);
  let opacity = 1;
  let transform = "";
  let shownText = clip.text || "";
  if (clip.anim === "fade") opacity = clamp(Math.min(t / 0.4, (dur - t) / 0.4), 0, 1);
  else if (clip.anim === "rise") {
    const k = clamp(t / 0.5, 0, 1);
    opacity = k;
    transform = `translateY(${(1 - k) * 24}px)`;
  } else if (clip.anim === "pop") {
    const k = clamp(t / 0.4, 0, 1);
    opacity = k;
    transform = `scale(${0.7 + 0.3 * (1 - Math.pow(1 - k, 3))})`;
  } else if (clip.anim === "typewriter") shownText = (clip.text || "").slice(0, Math.ceil((clip.text || "").length * p));
  const commit = () => {
    const next = (editRef.current?.innerText ?? "").replace(/\n$/, "");
    setEditing(false);
    if (onEditText && next !== (clip.text || "")) onEditText(next);
  };
  return (
    <div
      className={editing ? "absolute z-30" : "pointer-events-none absolute z-20"}
      style={{ left: `${(clip.posX ?? 0.5) * 100}%`, top: `${(clip.posY ?? 0.5) * 100}%`, transform: `translate(-50%, -50%) ${transform}`, opacity: editing ? 1 : opacity * (clip.opacity ?? 1), textAlign: clip.align, maxWidth: "90%" }}
    >
      <span
        ref={editRef}
        // Double-click the text on the preview to edit it inline (contentEditable).
        contentEditable={editing}
        suppressContentEditableWarning
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); requestAnimationFrame(() => { if (editRef.current) { editRef.current.innerText = clip.text || ""; editRef.current.focus(); document.getSelection()?.selectAllChildren(editRef.current); } }); }}
        onBlur={() => editing && commit()}
        onKeyDown={(e) => { if (editing) { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); } else if (e.key === "Escape") { setEditing(false); } } }}
        style={{
          pointerEvents: "auto",
          cursor: editing ? "text" : "pointer",
          outline: editing ? "2px solid oklch(0.78 0.13 80)" : "none",
          fontFamily: clip.fontFamily,
          fontSize: `min(${(clip.fontSize ?? 72) / 10}vw, ${clip.fontSize}px)`,
          fontWeight: clip.weight ?? (clip.bold ? 800 : 500),
          letterSpacing: clip.letterSpacing ? `${clip.letterSpacing}px` : undefined,
          // Gradient fill clips a gradient to the glyphs (no box); otherwise a
          // solid color with an optional background box.
          ...(clip.gradient
            ? {
                backgroundImage: `linear-gradient(90deg, ${clip.color || "#ffffff"}, ${clip.gradient})`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                WebkitTextFillColor: "transparent",
              }
            : { color: clip.color, background: clip.bg || "transparent" }),
          WebkitTextStroke: clip.stroke ? `${clip.stroke}px ${clip.strokeColor || "#000000"}` : undefined,
          padding: clip.bg && !clip.gradient ? "0.1em 0.35em" : 0,
          borderRadius: 6,
          textShadow: (clip.bg && !clip.gradient) || clip.stroke ? "none" : "0 2px 12px rgba(0,0,0,0.6)",
          whiteSpace: "pre-wrap",
          lineHeight: 1.15,
          display: "inline-block",
        }}
      >
        {editing ? undefined : shownText}
      </span>
    </div>
  );
}

/* ---------- Interactive PiP frame editor (preview) ----------
   Drag the box to move, the handles to resize the selected overlay clip within
   the preview frame. Coordinates are normalized 0..1 of the stage so they map
   straight onto the clip's `frame` (and the export overlay). */
type Frame = { x: number; y: number; w: number; h: number };
const FRAME_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const FRAME_CURSOR: Record<string, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

function FrameEditor({ frame, videoPath, onCommit, onReset }: { frame: Frame; videoPath?: string; onCommit: (f: Frame) => void; onReset: () => void }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<null | { mode: string; sx: number; sy: number; f0: Frame }>(null);
  const latest = useRef(frame);
  latest.current = frame;

  // Write the frame straight to the box + the live <video> element — zero React
  // round-trip, so the box and the footage follow the cursor instantly. State
  // is committed once on pointer-up.
  const paint = (f: Frame) => {
    const box = boxRef.current;
    if (box) {
      box.style.left = `${f.x * 100}%`;
      box.style.top = `${f.y * 100}%`;
      box.style.width = `${f.w * 100}%`;
      box.style.height = `${f.h * 100}%`;
    }
    const stage = layerRef.current?.parentElement;
    if (stage && videoPath) {
      const vids = stage.querySelectorAll<HTMLVideoElement>("video");
      vids.forEach((v) => {
        if (v.dataset.clipPath === videoPath) {
          v.style.left = `${f.x * 100}%`;
          v.style.top = `${f.y * 100}%`;
          v.style.width = `${f.w * 100}%`;
          v.style.height = `${f.h * 100}%`;
          // We bypassed PreviewPlayer's write-on-change cache to move the element
          // directly during the drag — invalidate the cached geometry so the next
          // slaving pass re-applies the committed frame cleanly.
          delete (v as unknown as { __s?: Record<string, string> }).__s;
        }
      });
    }
  };

  const begin = (mode: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, f0: { ...latest.current } };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const rect = layerRef.current?.getBoundingClientRect();
    if (!d || !rect || rect.width < 2 || rect.height < 2) return;
    const dx = (e.clientX - d.sx) / rect.width;
    const dy = (e.clientY - d.sy) / rect.height;
    let { x, y, w, h } = d.f0;
    const MIN = 0.06;
    // A PiP may extend BEYOND the preview (be bigger / sit partly off-frame), like
    // pro editors — so positions/sizes are clamped to a generous overscan range,
    // not [0,1]. Shift-drag disables the magnet for free placement.
    const OVER = 0.6;
    const magnet = !e.shiftKey;
    const TOL = 0.016;
    // Snap a value to the nearest target edge/center within tolerance.
    const snap = (v: number, targets: number[]) => {
      if (!magnet) return v;
      for (const t of targets) if (Math.abs(v - t) < TOL) return t;
      return v;
    };
    if (d.mode === "move") {
      x = clamp(x + dx, -OVER, Math.max(-OVER, 1 - w + OVER));
      y = clamp(y + dy, -OVER, Math.max(-OVER, 1 - h + OVER));
      // Magnet the box's left/right/center to the frame's left/right/center.
      x = snap(x, [0, 1 - w, 0.5 - w / 2]);
      y = snap(y, [0, 1 - h, 0.5 - h / 2]);
    } else {
      if (d.mode.includes("w")) {
        let nx = clamp(x + dx, -OVER, x + w - MIN);
        nx = snap(nx, [0, 0.5]); // left edge snaps to frame-left / center
        w = x + w - nx;
        x = nx;
      }
      if (d.mode.includes("e")) {
        w = clamp(w + dx, MIN, 1 + OVER - x);
        const right = snap(x + w, [1, 0.5]); // right edge snaps to frame-right / center
        w = right - x;
      }
      if (d.mode.includes("n")) {
        let ny = clamp(y + dy, -OVER, y + h - MIN);
        ny = snap(ny, [0, 0.5]);
        h = y + h - ny;
        y = ny;
      }
      if (d.mode.includes("s")) {
        h = clamp(h + dy, MIN, 1 + OVER - y);
        const bottom = snap(y + h, [1, 0.5]);
        h = bottom - y;
      }
    }
    const f = { x, y, w, h };
    latest.current = f;
    paint(f);
  };
  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
    const f = latest.current;
    // Only commit (one undo step) if it actually moved — a plain click shouldn't.
    if (f.x !== d.f0.x || f.y !== d.f0.y || f.w !== d.f0.w || f.h !== d.f0.h) onCommit(f);
  };

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-30">
      <div
        ref={boxRef}
        className="pointer-events-auto absolute cursor-move border-[1.5px] border-accent"
        style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, width: `${frame.w * 100}%`, height: `${frame.h * 100}%` }}
        onPointerDown={begin("move")}
        onPointerMove={move}
        onPointerUp={end}
        onDoubleClick={(e) => { e.stopPropagation(); onReset(); }}
      >
        {/* invisible EDGE detectors — grab anywhere along a border to resize it,
            with a generous hit zone that extends slightly outside the box */}
        {(["n", "s"] as const).map((k) => (
          <span key={k} onPointerDown={begin(k)} onPointerMove={move} onPointerUp={end} className="pointer-events-auto absolute inset-x-0 z-0 h-4 -translate-y-1/2" style={{ top: k === "n" ? "0%" : "100%", cursor: "ns-resize" }} />
        ))}
        {(["w", "e"] as const).map((k) => (
          <span key={k} onPointerDown={begin(k)} onPointerMove={move} onPointerUp={end} className="pointer-events-auto absolute inset-y-0 z-0 w-4 -translate-x-1/2" style={{ left: k === "w" ? "0%" : "100%", cursor: "ew-resize" }} />
        ))}
        {/* corner + midpoint handles — small visible marker inside a large hit area */}
        {FRAME_HANDLES.map((k) => {
          const left = k.includes("w") ? "0%" : k.includes("e") ? "100%" : "50%";
          const top = k.includes("n") ? "0%" : k.includes("s") ? "100%" : "50%";
          return (
            <span
              key={k}
              onPointerDown={begin(k)}
              onPointerMove={move}
              onPointerUp={end}
              className="pointer-events-auto absolute z-10 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center"
              style={{ left, top, cursor: FRAME_CURSOR[k] }}
            >
              <span className="h-2.5 w-2.5 rounded-[2px] border border-accent bg-white shadow" />
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Inspector ---------- */
const Inspector = memo(function Inspector({
  sel,
  project,
  aspect,
  onAspect,
  onBg,
  onChange,
  onDelete,
  onRipple,
  onDuplicate,
  onDetach,
  onAutoCut,
  onAddText,
  onAddKeyframe,
  onClearMotion,
  busy,
}: {
  sel: Clip | null;
  project: Project;
  aspect: string;
  onAspect: (id: string) => void;
  onBg: (c: string) => void;
  onChange: (patch: Partial<Clip>) => void;
  onDelete: () => void;
  onRipple: () => void;
  onDuplicate: () => void;
  onDetach: () => void;
  onAutoCut: () => void;
  onAddText: (preset?: Partial<Clip>) => void;
  onAddKeyframe: () => void;
  onClearMotion: () => void;
  busy: string | null;
}) {
  return (
    <Dock title={sel ? (sel.kind === "text" ? "Text" : sel.kind === "audio" ? "Audio" : "Clip") : "Project"} icon={sel?.kind === "text" ? TypeIcon : sel ? Wand2 : Workflow} className="h-full w-full" bodyClass="p-3 overflow-auto">
      {/* Canvas background is ALWAYS reachable (it used to vanish the moment a clip
          was selected). It colors the letterbox bars around a contain-fit video. */}
      {sel && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-line bg-panel2/50 px-2.5 py-2">
          <span className="text-[12px] text-muted">Canvas background</span>
          <input type="color" value={project.bg || "#000000"} onChange={(e) => onBg(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent" />
        </div>
      )}
      {!sel ? (
        <ProjectInspector project={project} aspect={aspect} onAspect={onAspect} onBg={onBg} onAddText={onAddText} />
      ) : sel.kind === "text" ? (
        <TextInspector sel={sel} onChange={onChange} onDelete={onDelete} onDuplicate={onDuplicate} />
      ) : (
        <MediaInspector sel={sel} isOverlay={isOverlayClip(project, sel)} onChange={onChange} onDelete={onDelete} onRipple={onRipple} onDuplicate={onDuplicate} onDetach={onDetach} onAutoCut={onAutoCut} onAddKeyframe={onAddKeyframe} onClearMotion={onClearMotion} busy={busy} />
      )}
    </Dock>
  );
});

function ProjectInspector({ project, aspect, onAspect, onBg, onAddText }: { project: Project; aspect: string; onAspect: (id: string) => void; onBg: (c: string) => void; onAddText: (preset?: Partial<Clip>) => void }) {
  const TEXT_PRESETS: { label: string; hint: string; preset: Partial<Clip> }[] = [
    { label: "Title", hint: "Big centered", preset: { fontSize: 96, bold: true, posY: 0.42, anim: "rise" } },
    { label: "Lower third", hint: "Name / role", preset: { fontSize: 52, bold: true, posX: 0.28, posY: 0.82, align: "left", bg: "#0c0c10", anim: "fade" } },
    { label: "Caption", hint: "Boxed bottom", preset: { fontSize: 46, bold: false, posY: 0.9, bg: "#000000", anim: "fade" } },
    { label: "Subtitle", hint: "Clean bottom", preset: { fontSize: 40, bold: false, posY: 0.88, anim: "none" } },
  ];
  const fps = project.fps || 30;
  const bg = project.bg || "#000000";
  const ar = project.width / project.height;
  // Compact aspect glyph (a small proportional outline) — no big dead canvas.
  const gw = ar >= 1 ? 40 : Math.max(14, Math.round(30 * ar));
  const gh = ar >= 1 ? Math.max(14, Math.round(40 / ar)) : 30;
  return (
    <div className="space-y-4">
      {/* Compact canvas summary — aspect glyph + resolution / ratio / fps */}
      <div className="flex items-center gap-3 rounded-xl border border-line bg-panel2 px-3 py-2.5">
        <div className="grid h-11 w-11 shrink-0 place-items-center">
          <div className="rounded-[3px] border-2 border-accent/70 bg-accent-soft/50" style={{ width: gw, height: gh, background: bg !== "#000000" ? bg : undefined }} />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[12.5px] font-700 tabular-nums text-ink">{project.width}×{project.height}</div>
          <div className="font-mono text-[10.5px] text-dim tabular-nums">{aspectLabel(aspect, ar)} · {fps} fps</div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[12px] font-600 text-muted">Canvas size</div>
        <Select value={aspect} onChange={onAspect} options={[{ label: "Match first clip", value: "source" }, ...ASPECTS.map((a) => ({ label: a.label, value: a.id }))]} />
      </div>

      <Swatch label="Background" value={bg} fallback="#000000" onChange={onBg} />

      <div className="border-t border-line/60 pt-3.5">
        <div className="mb-2 flex items-center gap-2 text-[12px] font-600 text-muted">
          <Type className="h-3.5 w-3.5 text-accent" strokeWidth={2.2} />
          Add text
        </div>
        <div className="grid grid-cols-2 gap-2">
          {TEXT_PRESETS.map((tp) => (
            <button
              key={tp.label}
              onClick={() => onAddText(tp.preset)}
              className="focus-ring group flex flex-col items-start gap-0.5 rounded-xl border border-line bg-panel2 px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-accent hover:bg-accent-soft/40 hover:shadow-[0_4px_14px_color-mix(in_oklch,var(--accent)_18%,transparent)]"
            >
              <span className="text-[12.5px] font-700 text-ink">{tp.label}</span>
              <span className="text-[10.5px] text-dim group-hover:text-muted">{tp.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="border-t border-line/60 pt-3 text-[11.5px] leading-snug text-dim">Select a clip to trim it, set speed, fades, color and transitions. Drag media from the left onto the timeline to stack tracks.</p>
    </div>
  );
}

// Friendly aspect label (uses the matched preset name when the ratio matches one).
function aspectLabel(aspect: string, ar: number): string {
  if (aspect !== "source") {
    const a = ASPECTS.find((x) => x.id === aspect);
    if (a) return a.label;
  }
  const r = Math.round(ar * 100) / 100;
  if (Math.abs(r - 16 / 9) < 0.02) return "16:9 Landscape";
  if (Math.abs(r - 9 / 16) < 0.02) return "9:16 Vertical";
  if (Math.abs(r - 1) < 0.02) return "1:1 Square";
  if (Math.abs(r - 4 / 3) < 0.02) return "4:3";
  return `${r.toFixed(2)}:1`;
}

function MediaInspector({ sel, isOverlay, onChange, onDelete, onRipple, onDuplicate, onDetach, onAutoCut, onAddKeyframe, onClearMotion, busy }: { sel: Clip; isOverlay: boolean; onChange: (p: Partial<Clip>) => void; onDelete: () => void; onRipple: () => void; onDuplicate: () => void; onDetach: () => void; onAutoCut: () => void; onAddKeyframe: () => void; onClearMotion: () => void; busy: string | null }) {
  // Quick-filter the (many) controls — type to find an option fast instead of
  // scrolling. A section shows if the query matches its name or any of its labels.
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const show = (kw: string) => !ql || kw.toLowerCase().includes(ql);
  return (
    <div className="space-y-3">
      <div className="truncate text-[12.5px] font-600 text-ink">{sel.name}</div>
      <div className="font-mono text-[11px] text-dim tnum">
        in {fmtTime(sel.in)} · out {fmtTime(sel.out)} · {fmtTime(clipLen(sel))}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" strokeWidth={2} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search options…" className="focus-ring h-8 w-full rounded-lg border border-line bg-panel2 pl-8 pr-7 text-[12px] text-ink placeholder:text-dim" />
        {q && <button onClick={() => setQ("")} className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-dim hover:text-ink"><Plus className="h-3.5 w-3.5 rotate-45" strokeWidth={2} /></button>}
      </div>

      {show("speed") && (
        <Field label="Speed" stacked hint="0.5×–2× (audio kept in sync).">
          <Segmented value={sel.speed} onChange={(v) => onChange({ speed: v })} options={[0.5, 1, 1.5, 2].map((s) => ({ label: `${s}×`, value: s }))} />
        </Field>
      )}

      {show("volume") && <RowSlider label="Volume" value={Math.round((sel.volume ?? 1) * 100)} suffix="%" min={0} max={200} onChange={(v) => onChange({ volume: v / 100 })} />}
      {sel.kind === "video" && show("opacity") && <RowSlider label="Opacity" value={Math.round((sel.opacity ?? 1) * 100)} suffix="%" min={0} max={100} onChange={(v) => onChange({ opacity: v / 100 })} />}

      {show("fade in out") && (
        <div className="grid grid-cols-2 gap-2 border-t border-line/60 pt-3">
          <RowSlider label="Fade in" value={Number((sel.fadeIn ?? 0).toFixed(1))} suffix="s" min={0} max={3} step={0.1} onChange={(v) => onChange({ fadeIn: v })} compact />
          <RowSlider label="Fade out" value={Number((sel.fadeOut ?? 0).toFixed(1))} suffix="s" min={0} max={3} step={0.1} onChange={(v) => onChange({ fadeOut: v })} compact />
        </div>
      )}

      {/* ---- Layout (resizable PiP) for overlay video clips ---- */}
      {sel.kind === "video" && isOverlay && show("layout pip width height position") && (
        <div className="space-y-2 border-t border-line/60 pt-3">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-600 text-muted">Layout (PiP)</div>
            <button onClick={() => onChange({ frame: { ...DEFAULT_PIP } })} className="text-[11px] text-accent underline hover:text-ink">Reset</button>
          </div>
          <p className="text-[10.5px] leading-snug text-dim">Drag the box in the preview to move it, or the handles to resize. Double-click the box to reset.</p>
          <div className="grid grid-cols-2 gap-2">
            <RowSlider label="Width" value={Math.round((sel.frame ?? DEFAULT_PIP).w * 100)} suffix="%" min={6} max={100} onChange={(v) => { const f = sel.frame ?? DEFAULT_PIP; onChange({ frame: { ...f, w: clamp(v / 100, 0.06, 1 - f.x) } }); }} compact />
            <RowSlider label="Height" value={Math.round((sel.frame ?? DEFAULT_PIP).h * 100)} suffix="%" min={6} max={100} onChange={(v) => { const f = sel.frame ?? DEFAULT_PIP; onChange({ frame: { ...f, h: clamp(v / 100, 0.06, 1 - f.y) } }); }} compact />
          </div>
        </div>
      )}

      {sel.kind === "video" && show("transform mirror flip rotate") && (
        <div className="space-y-2 border-t border-line/60 pt-3">
          <div className="text-[12px] font-600 text-muted">Transform</div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onChange({ flipH: !sel.flipH })} className={cx("focus-ring flex h-8 items-center justify-center gap-1.5 rounded-lg border text-[12px] font-500 transition-colors", sel.flipH ? "border-accent/50 bg-accent-soft text-accent" : "border-line bg-panel2 text-muted hover:bg-hover hover:text-ink")}>
              <FlipHorizontal className="h-3.5 w-3.5" strokeWidth={2} /> Mirror
            </button>
            <button onClick={() => onChange({ flipV: !sel.flipV })} className={cx("focus-ring flex h-8 items-center justify-center gap-1.5 rounded-lg border text-[12px] font-500 transition-colors", sel.flipV ? "border-accent/50 bg-accent-soft text-accent" : "border-line bg-panel2 text-muted hover:bg-hover hover:text-ink")}>
              <FlipHorizontal className="h-3.5 w-3.5 rotate-90" strokeWidth={2} /> Flip
            </button>
          </div>
          <RowSlider label="Rotate" value={Math.round(sel.rotate ?? 0)} suffix="°" min={-180} max={180} onChange={(v) => onChange({ rotate: v })} compact />
        </div>
      )}

      {/* ---- Motion (position keyframes) — overlay/PiP clips ---- */}
      {sel.kind === "video" && isOverlay && show("motion keyframe animate") && (
        <div className="space-y-2 border-t border-line/60 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[12px] font-600 text-muted"><Diamond className="h-3 w-3 text-accent" fill={hasMotion(sel) ? "currentColor" : "none"} strokeWidth={2} /> Motion</div>
            <span className="text-[10.5px] text-dim">{(sel.kf?.length ?? 0)} keyframe{(sel.kf?.length ?? 0) === 1 ? "" : "s"}{hasMotion(sel) ? " · animated" : ""}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Btn size="sm" variant="subtle" onClick={onAddKeyframe}>+ Keyframe here</Btn>
            <Btn size="sm" variant="subtle" onClick={onClearMotion} disabled={!sel.kf?.length}>Clear motion</Btn>
          </div>
          <div className="text-[10.5px] leading-snug text-dim">Move the playhead, drag the box to a new spot, and add a keyframe. Two or more keyframes animate the clip across the screen.</div>
        </div>
      )}

      {sel.kind === "video" && show("effects zoom blur vignette sharpen blend") && (
        <div className="space-y-2 border-t border-line/60 pt-3">
          <div className="text-[12px] font-600 text-muted">Effects</div>
          {!isOverlay && <RowSlider label="Zoom" value={Number((sel.zoom ?? 1).toFixed(2))} suffix="×" min={1} max={3} step={0.05} onChange={(v) => onChange({ zoom: v })} compact />}
          <RowSlider label="Blur" value={Math.round((sel.blur ?? 0) * 100)} suffix="%" min={0} max={100} onChange={(v) => onChange({ blur: v / 100 })} compact />
          <RowSlider label="Vignette" value={Math.round((sel.vignette ?? 0) * 100)} suffix="%" min={0} max={100} onChange={(v) => onChange({ vignette: v / 100 })} compact />
          <RowSlider label="Sharpen" value={Math.round((sel.sharpen ?? 0) * 100)} suffix="%" min={0} max={100} onChange={(v) => onChange({ sharpen: v / 100 })} compact />
          {isOverlay && (
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12px] text-muted">Blend</div>
              <div className="w-[58%]">
                <Select value={sel.blend ?? "normal"} onChange={(v) => onChange({ blend: v as BlendMode })} options={BLEND_MODES.map((b) => ({ label: b.label, value: b.id }))} />
              </div>
            </div>
          )}
        </div>
      )}

      {sel.kind === "video" && show("color brightness contrast saturation hue levels black white gamma") && (
        <div className="space-y-2 border-t border-line/60 pt-3">
          <div className="text-[12px] font-600 text-muted">Color</div>
          <RowSlider label="Brightness" value={Math.round((sel.brightness ?? 0) * 100)} suffix="" min={-100} max={100} onChange={(v) => onChange({ brightness: v / 100 })} compact />
          <RowSlider label="Contrast" value={Math.round((sel.contrast ?? 1) * 100)} suffix="%" min={0} max={200} onChange={(v) => onChange({ contrast: v / 100 })} compact />
          <RowSlider label="Saturation" value={Math.round((sel.saturate ?? 1) * 100)} suffix="%" min={0} max={200} onChange={(v) => onChange({ saturate: v / 100 })} compact />
          <RowSlider label="Hue" value={Math.round(sel.hue ?? 0)} suffix="°" min={-180} max={180} onChange={(v) => onChange({ hue: v })} compact />
          <div className="text-[10.5px] text-dim pt-0.5">Levels (export)</div>
          <RowSlider label="Black" value={Math.round((sel.levels?.black ?? 0) * 100)} suffix="%" min={0} max={90} onChange={(v) => onChange({ levels: { ...sel.levels, black: v / 100 } })} compact />
          <RowSlider label="White" value={Math.round((sel.levels?.white ?? 1) * 100)} suffix="%" min={10} max={100} onChange={(v) => onChange({ levels: { ...sel.levels, white: v / 100 } })} compact />
          <RowSlider label="Gamma" value={Number((sel.levels?.gamma ?? 1).toFixed(2))} suffix="" min={0.2} max={3} step={0.05} onChange={(v) => onChange({ levels: { ...sel.levels, gamma: v } })} compact />
        </div>
      )}

      {/* ---- Audio mix ---- */}
      {(sel.kind === "video" || sel.kind === "audio") && show("audio mix gain pan equalizer eq low mid high compressor") && (
        <div className="space-y-2 border-t border-line/60 pt-3">
          <div className="text-[12px] font-600 text-muted">Audio mix</div>
          <RowSlider label="Gain" value={Number((sel.gainDb ?? 0).toFixed(1))} suffix="dB" min={-24} max={12} step={0.5} onChange={(v) => onChange({ gainDb: v })} compact />
          <RowSlider label="Pan" value={Math.round((sel.pan ?? 0) * 100)} suffix={(sel.pan ?? 0) === 0 ? "C" : (sel.pan ?? 0) < 0 ? "L" : "R"} min={-100} max={100} onChange={(v) => onChange({ pan: v / 100 })} compact />
          <div className="text-[10.5px] text-dim pt-0.5">Equalizer (dB)</div>
          <RowSlider label="Low" value={Number((sel.eqLow ?? 0).toFixed(1))} suffix="dB" min={-12} max={12} step={0.5} onChange={(v) => onChange({ eqLow: v })} compact />
          <RowSlider label="Mid" value={Number((sel.eqMid ?? 0).toFixed(1))} suffix="dB" min={-12} max={12} step={0.5} onChange={(v) => onChange({ eqMid: v })} compact />
          <RowSlider label="High" value={Number((sel.eqHigh ?? 0).toFixed(1))} suffix="dB" min={-12} max={12} step={0.5} onChange={(v) => onChange({ eqHigh: v })} compact />
          <div className="flex items-center justify-between pt-0.5">
            <div>
              <div className="text-[12px] font-600 text-muted">Compressor</div>
              <div className="text-[10.5px] text-dim">Evens out loud / quiet parts (export).</div>
            </div>
            <Toggle checked={!!sel.compress} onChange={(v) => onChange({ compress: v })} label="Compressor" />
          </div>
        </div>
      )}

      {/* ---- AI audio tools — premium buttons side by side ---- */}
      {show("ai silence cut auto noise suppression denoise clean") && (
        <div className={cx("grid gap-1.5 border-t border-line/60 pt-3", sel.kind === "video" ? "grid-cols-2" : "grid-cols-1")}>
          {sel.kind === "video" && <AiAutoCutButton onClick={onAutoCut} busy={busy} />}
          <NoiseSuppressButton active={!!sel.denoise} onToggle={() => onChange({ denoise: !sel.denoise })} />
        </div>
      )}

      {/* ---- Normalize loudness (export-side) ---- */}
      {show("normalize loudness") && (
        <div className="flex items-center justify-between border-t border-line/60 pt-3">
          <div>
            <div className="text-[12px] font-600 text-muted">Normalize loudness</div>
            <div className="text-[10.5px] text-dim">Auto-levels to broadcast loudness on export.</div>
          </div>
          <Toggle checked={!!sel.audioNormalize} onChange={(v) => onChange({ audioNormalize: v })} label="Normalize loudness" />
        </div>
      )}

      {show("transition crossfade fade dissolve wipe slide") && <TransitionPicker sel={sel} onChange={onChange} />}

      <div className="grid grid-cols-2 gap-1.5 border-t border-line/60 pt-3">
        <Btn size="sm" variant="subtle" icon={Copy} onClick={onDuplicate}>
          Duplicate
        </Btn>
        <Btn size="sm" variant={sel.reverse ? "primary" : "subtle"} icon={FlipHorizontal} onClick={() => onChange({ reverse: !sel.reverse })}>
          Reverse
        </Btn>
        {sel.kind === "video" && (
          <Btn size="sm" variant="subtle" icon={ArrowLeftRight} onClick={onDetach} className="col-span-2">
            Detach audio
          </Btn>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Btn size="sm" variant="subtle" icon={Scissors} onClick={onRipple}>
          Ripple delete
        </Btn>
        <Btn size="sm" variant="danger" icon={Trash2} onClick={onDelete}>
          Delete
        </Btn>
      </div>
    </div>
  );
}

/* ---------- Premium AI auto-cut button ---------- */
function AiAutoCutButton({ onClick, busy }: { onClick: () => void; busy: string | null }) {
  const working = !!busy;
  return (
    <button
      onClick={onClick}
      disabled={working}
      className={cx(
        "focus-ring group relative w-full overflow-hidden rounded-xl border border-accent/40 px-3 py-2.5 text-left transition-all",
        "bg-[linear-gradient(110deg,var(--accent-soft),transparent_60%)] hover:border-accent disabled:cursor-wait",
      )}
    >
      {/* sheen sweep */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(110deg,transparent,oklch(1_0_0_/_0.12),transparent)] transition-transform duration-700 group-hover:translate-x-full"
      />
      <div className="relative flex items-center gap-2.5">
        <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-[var(--on-accent)] shadow-[0_2px_10px_var(--accent-soft)]", working && "animate-pulse")}>
          <Sparkles className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[12.5px] font-700 text-ink">
            {working ? busy : "Auto-cut silence"}
            {!working && <span className="rounded bg-accent/20 px-1 py-px text-[8.5px] font-800 uppercase tracking-wide text-accent">AI</span>}
          </span>
          <span className="block truncate text-[10.5px] text-dim">{working ? "Analyzing audio…" : "Detect & remove quiet gaps automatically"}</span>
        </span>
      </div>
    </button>
  );
}

/* ---------- Premium noise-suppression AI button (emerald — distinct from the
   violet auto-cut). A toggle: active = a denoise pass is baked on export. ---------- */
function NoiseSuppressButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={active}
      className={cx(
        "focus-ring group relative w-full overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all",
        active
          ? "border-[oklch(0.7_0.15_165)] bg-[linear-gradient(110deg,oklch(0.7_0.15_165/0.22),transparent_62%)]"
          : "border-[oklch(0.7_0.15_165/0.4)] bg-[linear-gradient(110deg,oklch(0.7_0.15_165/0.1),transparent_60%)] hover:border-[oklch(0.7_0.15_165/0.75)]"
      )}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(110deg,transparent,oklch(1_0_0_/_0.12),transparent)] transition-transform duration-700 group-hover:translate-x-full" />
      <div className="relative flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[oklch(0.7_0.15_165)] text-[oklch(0.16_0.02_165)] shadow-[0_2px_10px_oklch(0.7_0.15_165/0.4)]">
          <AudioWaveform className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[12.5px] font-700 text-ink">
            Noise suppression
            <span className="rounded bg-[oklch(0.7_0.15_165/0.22)] px-1 py-px text-[8.5px] font-800 uppercase tracking-wide text-[oklch(0.78_0.15_165)]">AI</span>
            {active && <Check className="h-3.5 w-3.5 text-[oklch(0.78_0.15_165)]" strokeWidth={3} />}
          </span>
          <span className="block truncate text-[10.5px] text-dim">{active ? "Hiss / hum removed on export" : "Remove hiss & hum from voice"}</span>
        </span>
      </div>
    </button>
  );
}

function RowSlider({ label, value, suffix, min, max, step = 1, onChange, compact }: { label: string; value: number; suffix: string; min: number; max: number; step?: number; onChange: (v: number) => void; compact?: boolean }) {
  return (
    <div className={compact ? "" : ""}>
      <div className="mb-1 flex items-center justify-between text-[11.5px] text-muted">
        <span>{label}</span>
        <span className="font-mono text-ink tnum">
          {value}
          {suffix}
        </span>
      </div>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} />
    </div>
  );
}

function TransitionPicker({ sel, onChange }: { sel: Clip; onChange: (p: Partial<Clip>) => void }) {
  const tr = sel.transition || { kind: "none" as TransitionKind, duration: 0.5, dir: "between" as TransitionDir };
  const dir: TransitionDir = tr.dir ?? "between";
  const set = (patch: Partial<NonNullable<Clip["transition"]>>) => onChange({ transition: { kind: tr.kind, duration: tr.duration, dir, ...patch } });
  return (
    <div className="border-t border-line/60 pt-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-muted">
        <Combine className="h-3.5 w-3.5" strokeWidth={2} /> Transition
      </div>
      <Select value={tr.kind} onChange={(v) => set({ kind: v as TransitionKind })} options={TRANSITIONS.map((t) => ({ label: t.label, value: t.kind }))} />
      {tr.kind !== "none" && (
        <div className="mt-2 space-y-2">
          <div>
            <div className="mb-1 text-[11.5px] text-dim">Applies</div>
            <Segmented value={dir} onChange={(v) => set({ dir: v as TransitionDir })} options={TRANSITION_DIRS.map((d) => ({ label: d.label, value: d.id }))} size="sm" />
            <p className="mt-1 text-[10.5px] leading-snug text-dim">
              {dir === "between" ? "Blends from the previous clip on this track." : dir === "in" ? "Eases the clip on at its start." : "Eases the clip off at its end."}
            </p>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11.5px] text-dim">
              <span>Duration</span>
              <span className="font-mono tnum">{tr.duration.toFixed(1)}s</span>
            </div>
            <Slider value={tr.duration} min={0.2} max={2} step={0.1} onChange={(v) => set({ duration: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

const TEXT_PRESETS: { label: string; patch: Partial<Clip> }[] = [
  { label: "Clean", patch: { color: "#ffffff", gradient: "", bg: "", stroke: 0, weight: 700 } },
  { label: "Heavy", patch: { color: "#ffffff", gradient: "", bg: "", stroke: 0, weight: 900 } },
  { label: "Outline", patch: { color: "#ffffff", gradient: "", bg: "", stroke: 4, strokeColor: "#000000", weight: 800 } },
  { label: "Boxed", patch: { color: "#ffffff", gradient: "", bg: "#101014", stroke: 0, weight: 700 } },
  { label: "Gradient", patch: { color: "#7c5cff", gradient: "#22d3ee", bg: "", stroke: 0, weight: 800 } },
  { label: "Pop", patch: { color: "#ffd84d", gradient: "", bg: "", stroke: 3, strokeColor: "#1a1300", weight: 900 } },
];

function Swatch({ label, value, fallback, onChange, onClear, clearLabel, preview }: { label: string; value?: string; fallback: string; onChange: (v: string) => void; onClear?: () => void; clearLabel?: string; preview?: string }) {
  const [pick, setPick] = useState<{ x: number; y: number } | null>(null);
  const active = !!value;
  return (
    <div className="flex items-center justify-between gap-1.5 rounded-lg border border-line bg-panel2 px-2.5 py-1.5">
      <span className="truncate text-[12px] text-muted">{label}</span>
      <div className="flex items-center gap-1">
        {onClear && active && (
          <button onClick={onClear} title={clearLabel || "Remove"} className="grid h-5 w-5 place-items-center rounded text-dim transition-colors hover:bg-rec-soft hover:text-rec">
            <Plus className="h-3 w-3 rotate-45" strokeWidth={2.4} />
          </button>
        )}
        {/* Circular colour disc on a tiny checkerboard (so "off" reads as empty),
            opens the advanced ColorPopover (spectrum + hex + eyedropper). */}
        <button
          onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPick({ x: Math.round(r.right - 252), y: Math.round(r.bottom + 6) }); }}
          title={label}
          className="relative grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full ring-2 ring-white/15 shadow-[0_1px_3px_oklch(0_0_0_/_0.5)] transition-transform hover:scale-110"
          style={{ backgroundImage: active ? undefined : "repeating-conic-gradient(#2a2a33 0% 25%, #1b1b24 0% 50%)", backgroundSize: "8px 8px", background: active ? preview || value : undefined }}
        >
          {!active && <Plus className="h-3 w-3 text-white/70" strokeWidth={2.4} />}
        </button>
      </div>
      <AnimatePresence>
        {pick && <ColorPopover value={value || fallback} onChange={onChange} onClose={() => setPick(null)} x={pick.x} y={pick.y} />}
      </AnimatePresence>
    </div>
  );
}

function TextInspector({ sel, onChange, onDelete, onDuplicate }: { sel: Clip; onChange: (p: Partial<Clip>) => void; onDelete: () => void; onDuplicate: () => void }) {
  return (
    <div className="space-y-3.5">
      {/* live preview chip */}
      <div className="grid min-h-[52px] place-items-center overflow-hidden rounded-lg border border-line bg-[repeating-conic-gradient(#15151c_0%_25%,#1b1b24_0%_50%)] bg-[length:16px_16px] p-2">
        <span
          className="truncate text-[20px] leading-tight"
          style={{
            fontFamily: sel.fontFamily,
            fontWeight: sel.weight ?? (sel.bold ? 800 : 500),
            letterSpacing: sel.letterSpacing ? `${sel.letterSpacing}px` : undefined,
            ...(sel.gradient
              ? { backgroundImage: `linear-gradient(90deg, ${sel.color || "#fff"}, ${sel.gradient})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }
              : { color: sel.color, background: sel.bg || "transparent", padding: sel.bg ? "0.05em 0.3em" : 0, borderRadius: 4 }),
            WebkitTextStroke: sel.stroke ? `${Math.min(sel.stroke, 4)}px ${sel.strokeColor || "#000"}` : undefined,
          }}
        >
          {sel.text || "Your text"}
        </span>
      </div>

      <textarea value={sel.text || ""} onChange={(e) => onChange({ text: e.target.value })} rows={2} placeholder="Type your text…" className="focus-ring w-full resize-none rounded-lg border border-line bg-panel2 p-2.5 text-[14px] text-ink" />

      {/* quick styles */}
      <div>
        <div className="mb-1.5 text-[11px] font-600 uppercase tracking-wide text-dim">Quick styles</div>
        <div className="flex flex-wrap gap-1.5">
          {TEXT_PRESETS.map((p) => (
            <button key={p.label} onClick={() => onChange(p.patch)} className="focus-ring rounded-md border border-line bg-panel2 px-2 py-1 text-[11.5px] font-500 text-muted transition-colors hover:border-accent hover:text-ink">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* font */}
      <div className="space-y-2.5 border-t border-line/60 pt-3">
        <div className="text-[11px] font-600 uppercase tracking-wide text-dim">Font</div>
        <Select value={sel.fontFamily || "Inter"} onChange={(v) => onChange({ fontFamily: v })} options={FONTS.map((f) => ({ label: f, value: f }))} />
        <RowSlider label="Size" value={sel.fontSize ?? 72} suffix="" min={18} max={240} step={1} onChange={(v) => onChange({ fontSize: v })} compact />
        <RowSlider label="Thickness" value={sel.weight ?? (sel.bold ? 800 : 500)} suffix="" min={100} max={900} step={100} onChange={(v) => onChange({ weight: v, bold: v >= 700 })} compact />
        <RowSlider label="Letter spacing" value={sel.letterSpacing ?? 0} suffix="px" min={-5} max={30} step={1} onChange={(v) => onChange({ letterSpacing: v })} compact />
      </div>

      {/* fill */}
      <div className="space-y-2 border-t border-line/60 pt-3">
        <div className="text-[11px] font-600 uppercase tracking-wide text-dim">Fill &amp; outline</div>
        <div className="grid grid-cols-2 gap-2">
          <Swatch label="Color" value={sel.color} fallback="#ffffff" onChange={(v) => onChange({ color: v })} />
          <Swatch label="Gradient" value={sel.gradient} fallback="#7c5cff" preview={sel.gradient ? `linear-gradient(90deg, ${sel.color || "#fff"}, ${sel.gradient})` : undefined} onChange={(v) => onChange({ gradient: v })} onClear={() => onChange({ gradient: "" })} />
          <Swatch label="Box" value={sel.bg} fallback="#101014" onChange={(v) => onChange({ bg: v })} onClear={() => onChange({ bg: "" })} clearLabel="none" />
          <Swatch label="Outline" value={sel.strokeColor} fallback="#000000" onChange={(v) => onChange({ strokeColor: v })} />
        </div>
        <RowSlider label="Outline width" value={sel.stroke ?? 0} suffix="px" min={0} max={12} step={1} onChange={(v) => onChange({ stroke: v })} compact />
      </div>

      {/* layout */}
      <div className="space-y-2.5 border-t border-line/60 pt-3">
        <div className="text-[11px] font-600 uppercase tracking-wide text-dim">Layout</div>
        <Segmented value={sel.align || "center"} onChange={(v) => onChange({ align: v as Clip["align"] })} options={[{ label: "Left", value: "left" }, { label: "Center", value: "center" }, { label: "Right", value: "right" }]} />
        <div className="grid grid-cols-2 gap-2">
          <RowSlider label="X" value={Math.round((sel.posX ?? 0.5) * 100)} suffix="%" min={0} max={100} step={1} onChange={(v) => onChange({ posX: v / 100 })} compact />
          <RowSlider label="Y" value={Math.round((sel.posY ?? 0.5) * 100)} suffix="%" min={0} max={100} step={1} onChange={(v) => onChange({ posY: v / 100 })} compact />
        </div>
        <div>
          <div className="mb-1 text-[11.5px] text-muted">Animation</div>
          <Select value={sel.anim || "none"} onChange={(v) => onChange({ anim: v as TextAnim })} options={TEXT_ANIMS.map((a) => ({ label: a.label, value: a.id }))} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-line/60 pt-3">
        <Btn size="sm" variant="subtle" icon={Copy} onClick={onDuplicate}>
          Duplicate
        </Btn>
        <Btn size="sm" variant="danger" icon={Trash2} onClick={onDelete}>
          Delete
        </Btn>
      </div>
    </div>
  );
}

/* ---------- Timeline ---------- */
type PlayheadStore = { v: number; subs: Set<() => void> };
interface TLProps {
  project: Project;
  pxPerSec: number;
  phStore: PlayheadStore;
  duration: number;
  height: number;
  headerW: number;
  onHeaderW: (w: number) => void;
  trackH: number;
  selId: string | null;
  selIds: string[];
  onToggleSelect: (id: string) => void;
  onAddSelect: (id: string) => void;
  onSelectMany: (ids: string[]) => void;
  onMoveMany: (updates: { id: string; start: number }[]) => void;
  snapping: boolean;
  ripple: boolean;
  tool: Tool;
  onSetTool: (t: Tool) => void;
  onSplitAt: (clipId: string, t: number) => void;
  onAltDuplicate: (clipId: string) => string | null;
  onAddTextAt: (t: number) => void;
  onAddMarkAt: (t: number) => void;
  loop: boolean;
  onToggleLoop: () => void;
  onToggleSnap: () => void;
  onToggleRipple: () => void;
  markers: number[];
  range: { a: number; b: number } | null;
  flashTrack: string | null;
  dropHint: DropHint | null;
  snapGuide: number | null;
  scrollRef: React.RefObject<HTMLDivElement>;
  laneWrapRef: React.RefObject<HTMLDivElement>;
  onSelect: (id: string | null) => void;
  onSeek: (t: number) => void;
  onCommit: (next: (p: Project) => Project) => void;
  onUpdateClip: (id: string, patch: Partial<Clip>) => void;
  onMoveClip: (id: string, trackId: string, start: number) => void;
  onPatchTrack: (id: string, patch: Partial<Track>) => void;
  onDeleteTrack: (id: string) => void;
  onInsertTrack: (kind: Track["kind"], nearId?: string) => void;
  onContextAction: (action: string, id: string) => void;
  onSetZoom: (fn: (z: number) => number) => void;
  onSnapGuide: (t: number | null) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onSetRange: (r: { a: number; b: number } | null) => void;
  onRemoveMarker: (t: number) => void;
  onRemoveAllMarkers: () => void;
  onDragStartClip: () => void;
  onDragEndClip: () => void;
}

// Subscribe to the playhead store and return the on-screen X (px). Only the leaf
// components below use this, so the per-frame playhead move re-renders just them
// — never the whole (memoized) TimelineView.
function usePlayheadX(store: PlayheadStore, pxPerSec: number) {
  const sub = useCallback((cb: () => void) => { store.subs.add(cb); return () => { store.subs.delete(cb); }; }, [store]);
  const v = useSyncExternalStore(sub, () => store.v, () => store.v);
  return v * pxPerSec;
}
// The downward pointer/head that rides the ruler.
function RulerPlayhead({ store, pxPerSec }: { store: PlayheadStore; pxPerSec: number }) {
  const left = usePlayheadX(store, pxPerSec);
  return (
    <div className="pointer-events-none absolute top-0 z-30 h-8" style={{ left }}>
      <div className="absolute left-0 top-0 h-full w-[1.5px] -translate-x-1/2 bg-rec" />
      <div className="absolute left-0 top-[2px] h-3 w-3 -translate-x-1/2 rounded-[3px] bg-rec shadow-[0_0_7px_oklch(0.64_0.22_22_/_0.65)]" />
      <div className="absolute left-0 top-[12px] h-2 w-2 -translate-x-1/2 rotate-45 bg-rec" />
    </div>
  );
}
// The vertical line through the lanes + the (interactive) scrub-grab strip.
function LanePlayhead({
  store,
  pxPerSec,
  lanesH,
  onDown,
  onMove,
  onUp,
}: {
  store: PlayheadStore;
  pxPerSec: number;
  lanesH: number;
  onDown: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: (e: React.PointerEvent) => void;
}) {
  const left = usePlayheadX(store, pxPerSec);
  return (
    <>
      <div className="pointer-events-none absolute top-0 z-40" style={{ left, height: lanesH }}>
        <div className="absolute left-0 top-0 h-full w-[1.5px] -translate-x-1/2 bg-rec shadow-[0_0_8px_oklch(0.64_0.22_22_/_0.55)]" />
      </div>
      <div className="absolute top-0 z-40 w-[14px] -translate-x-1/2 cursor-col-resize" style={{ left, height: lanesH }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
    </>
  );
}

const TimelineView = memo(function TimelineView(props: TLProps) {
  const { project, pxPerSec, phStore, duration, height, headerW, onHeaderW, trackH, selId, selIds, onToggleSelect, onAddSelect, onSelectMany, onMoveMany, snapping, ripple, tool, onSetTool, onSplitAt, onAltDuplicate, onAddTextAt, onAddMarkAt, loop, onToggleLoop, onToggleSnap, onToggleRipple, markers, range, flashTrack, dropHint, scrollRef, laneWrapRef, onSelect, onSeek, onCommit, onUpdateClip, onMoveClip, onPatchTrack, onDeleteTrack, onInsertTrack, onContextAction, onSetZoom, onSnapGuide, onDragOver, onDrop, onDragLeave, onDragStartClip, onDragEndClip } = props;
  // Per-track heights: a track can be taller than its neighbours. rowHOf adds the
  // 4px gutter; `tops` are cumulative offsets used for all y hit-testing.
  const heightOf = (t: Track) => t.height ?? trackH;
  const rowHOf = (t: Track) => heightOf(t) + 4;
  const tops = useMemo(() => {
    const arr: number[] = [];
    let y = 0;
    for (const t of project.tracks) {
      arr.push(y);
      y += (t.height ?? trackH) + 4;
    }
    return arr;
  }, [project.tracks, trackH]);
  // Total height of all lanes. Used to size the playhead / snap guide explicitly
  // so they always reach the LAST track (an h-full percentage chain through the
  // scroll containers didn't, so they stopped short of newly-added tracks).
  const lanesH = project.tracks.reduce((sum, t) => sum + (t.height ?? trackH) + 4, 0);
  const idxAtY = (localY: number) => {
    for (let i = project.tracks.length - 1; i >= 0; i--) if (localY >= tops[i]) return i;
    return 0;
  };
  const safeDur = isFinite(duration) ? Math.max(0, duration) : 0;
  // Group clips by track ONCE per project change. The lanes then render from
  // stable array references, so the (memoized) TrackLanes bail during playback
  // and the clip element tree is not rebuilt on every playhead frame.
  const clipsByTrack = useMemo(() => {
    const m: Record<string, Clip[]> = {};
    for (const t of project.tracks) m[t.id] = clipsOf(project, t.id);
    return m;
  }, [project]);
  // linkIds of the currently-selected clips → so a selected video also visually
  // selects its LINKED audio partner (and vice-versa).
  const selLinkIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of project.clips) if (selIds.includes(c.id) && c.linkId) s.add(c.linkId);
    return s;
  }, [project.clips, selIds]);
  // Adjacent clip junctions (same track, touching) → a between-transition badge sits
  // there. Recomputed only when clips/zoom change.
  const junctions = useMemo(() => {
    const out: { x: number; y: number; clipId: string }[] = [];
    project.tracks.forEach((t, ti) => {
      if (t.kind === "text") return;
      const tc = clipsByTrack[t.id] || EMPTY_CLIPS;
      for (let i = 1; i < tc.length; i++) {
        if (Math.abs(tc[i].start - clipEnd(tc[i - 1])) < 0.08) out.push({ x: tc[i].start * pxPerSec, y: tops[ti] + (t.height ?? trackH) / 2, clipId: tc[i].id });
      }
    });
    return out;
  }, [clipsByTrack, project.tracks, pxPerSec, tops, trackH]);
  // Track the visible lane width so the ruler/grid always fill the panel (the
  // ruler shows regular timeframes across the whole width, not just up to a clip).
  const [laneW, setLaneW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLaneW(el.clientWidth));
    ro.observe(el);
    setLaneW(el.clientWidth);
    return () => ro.disconnect();
  }, [scrollRef]);
  const contentW = Math.min(200000, Math.max(laneW || 800, (safeDur + 6) * pxPerSec));
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [trackMenu, setTrackMenu] = useState<{ x: number; y: number; trackId: string } | null>(null);
  const [transMenu, setTransMenu] = useState<{ x: number; y: number; clipId: string; dir: TransitionDir } | null>(null);
  // Stable so ClipView memo isn't broken — opens the transition picker for a clip edge.
  const onEditTransition = useCallback((clipId: string, dir: TransitionDir, x: number, y: number) => setTransMenu({ x, y, clipId, dir }), []);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const drag = useRef<
    null | {
      mode: "move" | "trim-l" | "trim-r" | "scrub" | "marquee";
      id?: string;
      clip0?: Clip;
      group?: { id: string; start0: number }[];
      minStart0?: number;
      startX: number;
      startY: number;
      additive?: boolean;
      moved?: boolean;
      captured?: boolean;
      pointerId?: number;
      began?: boolean; // a clip move/trim drag has started committing (one undo snapshot pushed)
    }
  >(null);
  const selIdsRef = useRef(selIds);
  selIdsRef.current = selIds;

  // The ruler is a FIXED top strip; it mirrors the lanes' horizontal scroll so it
  // stays pinned vertically (never hides when you scroll the track stack) while
  // still lining up with the clips.
  const rulerScrollRef = useRef<HTMLDivElement>(null);
  const syncRuler = () => {
    if (rulerScrollRef.current && scrollRef.current) rulerScrollRef.current.scrollLeft = scrollRef.current.scrollLeft;
  };
  function timeAt(clientX: number) {
    // laneWrap lives INSIDE the horizontally-scrolled content, so its rect.left
    // already includes the scroll offset — adding scrollLeft again double-counted
    // it and dropped the playhead to the right of the cursor once scrolled.
    const rect = laneWrapRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left) / pxPerSec);
  }
  function trackAtY(clientY: number): Track | null {
    const rect = laneWrapRef.current!.getBoundingClientRect();
    return project.tracks[idxAtY(clientY - rect.top)] ?? null;
  }
  // Stable across renders (deps only change when the project/selection handlers
  // do) so the memoized ClipViews don't all re-render on every playhead tick.
  const onClipDown = useCallback((e: React.PointerEvent, clip: Clip, mode: "move" | "trim-l" | "trim-r") => {
    e.stopPropagation();
    if (project.tracks.find((t) => t.id === clip.trackId)?.locked) return;
    // Alt+drag = duplicate: copy the clip in place and drag the COPY away, leaving
    // the original. Works in the Select tool on a body (move) grab.
    if (mode === "move" && e.altKey && tool === "select") {
      const dupId = onAltDuplicate(clip.id);
      if (dupId) {
        onSelect(dupId);
        try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* noop */ }
        drag.current = { mode: "move", id: dupId, clip0: { ...clip, id: dupId }, group: [{ id: dupId, start0: clip.start }], minStart0: clip.start, startX: e.clientX, startY: e.clientY, moved: false };
      }
      return;
    }
    // A sticky tool intercepts the click: Split cuts the clicked clip where you click
    // (and stays active for more cuts); other tools act on empty lane, not on a clip.
    if (tool === "split") {
      const rect = laneWrapRef.current?.getBoundingClientRect();
      if (rect) onSplitAt(clip.id, Math.max(0, (e.clientX - rect.left) / pxPerSec));
      return;
    }
    if (tool !== "select") return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    // Ctrl/Cmd-click toggles membership; Shift-click adds — neither starts a drag.
    if (mode === "move" && (e.ctrlKey || e.metaKey)) {
      onToggleSelect(clip.id);
      return;
    }
    if (mode === "move" && e.shiftKey) {
      onAddSelect(clip.id);
      return;
    }
    // Plain press: if the clip isn't already part of the selection, select just it.
    const inSel = selIdsRef.current.includes(clip.id);
    if (!inSel) onSelect(clip.id);
    // For a multi-selection move, capture every selected clip's start.
    const groupIds = inSel && selIdsRef.current.length > 1 ? selIdsRef.current : [clip.id];
    const group = project.clips.filter((c) => groupIds.includes(c.id)).map((c) => ({ id: c.id, start0: c.start }));
    const minStart0 = group.reduce((m, g) => Math.min(m, g.start0), Infinity);
    drag.current = { mode, id: clip.id, clip0: { ...clip }, group, minStart0, startX: e.clientX, startY: e.clientY, moved: false };
  }, [project, onToggleSelect, onAddSelect, onSelect, tool, onSplitAt, onAltDuplicate, pxPerSec, laneWrapRef]);

  // Stable clip-context handler (so it doesn't break ClipView memoization).
  const onClipContext = useCallback((id: string, x: number, y: number) => setMenu({ x, y, id }), []);

  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "scrub") {
      onSeek(timeAt(e.clientX));
      return;
    }
    if (d.mode === "marquee") {
      if (Math.abs(e.clientX - d.startX) > 3 || Math.abs(e.clientY - d.startY) > 3) d.moved = true;
      // Capture the pointer ONLY once a real drag starts (not on a plain press).
      // Capturing on every press leaked capture onto the lanes and could leave the
      // timeline unable to scroll; deferring it keeps clicks + the scrollbar live.
      if (d.moved && !d.captured) {
        try {
          (e.currentTarget as HTMLElement).setPointerCapture?.(d.pointerId ?? e.pointerId);
          d.captured = true;
        } catch {
          /* noop */
        }
      }
      // Work in viewport coords (rendered as a position:fixed rect) so the band
      // always tracks the cursor exactly, independent of timeline scroll. CLAMP it to
      // the lanes viewport so the rectangle can never spill out across the rest of the
      // Edit tab (into the preview / inspector) when the cursor leaves the timeline.
      const vp = scrollRef.current?.getBoundingClientRect();
      const cx = (n: number) => (vp ? clamp(n, vp.left, vp.right) : n);
      const cy = (n: number) => (vp ? clamp(n, vp.top, vp.bottom) : n);
      const x0 = cx(Math.min(d.startX, e.clientX));
      const y0 = cy(Math.min(d.startY, e.clientY));
      const x1 = cx(Math.max(d.startX, e.clientX));
      const y1 = cy(Math.max(d.startY, e.clientY));
      setMarquee({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      // map the band into lane/content space for hit-testing
      const rect = laneWrapRef.current?.getBoundingClientRect();
      if (rect) {
        const tA = (x0 - rect.left) / pxPerSec;
        const tB = (x1 - rect.left) / pxPerSec;
        const iA = idxAtY(y0 - rect.top);
        const iB = idxAtY(y1 - rect.top);
        const hits: string[] = [];
        project.tracks.forEach((t, i) => {
          if (i < iA || i > iB) return;
          for (const c of clipsOf(project, t.id)) {
            if (c.start < tB && clipEnd(c) > tA) hits.push(c.id);
          }
        });
        onSelectMany(d.additive ? Array.from(new Set([...selIdsRef.current, ...hits])) : hits);
      }
      return;
    }
    const c0 = d.clip0!;
    if (Math.abs(e.clientX - d.startX) > 2 || Math.abs(e.clientY - d.startY) > 2) d.moved = true;
    // First real movement of a clip move/trim → push ONE undo snapshot and enter
    // drag mode so the per-frame commits below don't each push their own.
    if (d.moved && !d.began) {
      d.began = true;
      onDragStartClip();
    }
    const dx = (e.clientX - d.startX) / pxPerSec;
    const snaps = snapping ? snapCandidates(project, phStore.v, d.id, markers) : [];
    const tol = 8 / pxPerSec;
    const snap = (t: number) => {
      const s = snapping ? snapTime(t, snaps, tol) : t;
      onSnapGuide(snapping && Math.abs(s - t) > 0.0001 ? s : null);
      return s;
    };
    if (d.mode === "move") {
      // Multi-selection: shift every selected clip by the same (clamped) delta.
      if (d.group && d.group.length > 1) {
        let delta = snap(c0.start + dx) - c0.start;
        if ((d.minStart0 ?? 0) + delta < 0) delta = -(d.minStart0 ?? 0);
        onMoveMany(d.group.map((g) => ({ id: g.id, start: Math.max(0, g.start0 + delta) })));
        return;
      }
      let ns = Math.max(0, snap(c0.start + dx));
      const targetTrack = trackAtY(e.clientY);
      const sameKindTrack = targetTrack && targetTrack.kind === c0.kind && !targetTrack.locked ? targetTrack : null;
      if (sameKindTrack && sameKindTrack.id !== c0.trackId) onMoveClip(c0.id, sameKindTrack.id, ns);
      else onUpdateClip(c0.id, { start: ns });
    } else if (d.mode === "trim-l") {
      if (c0.kind === "video" || c0.kind === "audio") {
        const maxIn = c0.out - 0.1;
        const newStart = snap(c0.start + dx);
        const deltaStart = newStart - c0.start;
        const newIn = clamp(c0.in + deltaStart * c0.speed, 0, maxIn);
        onUpdateClip(c0.id, { in: newIn, start: c0.start + (newIn - c0.in) / c0.speed });
      } else {
        const newStart = clamp(snap(c0.start + dx), 0, clipEnd(c0) - 0.1);
        onUpdateClip(c0.id, { start: newStart, out: c0.out - (newStart - c0.start) });
      }
    } else if (d.mode === "trim-r") {
      if (c0.kind === "video" || c0.kind === "audio") {
        const maxOut = c0.srcDuration || c0.out + 9999;
        const newEnd = snap(c0.start + clipLen(c0) + dx);
        const newLen = Math.max(0.1, newEnd - c0.start);
        onUpdateClip(c0.id, { out: clamp(c0.in + newLen * c0.speed, c0.in + 0.1, maxOut) });
      } else {
        onUpdateClip(c0.id, { out: Math.max(0.2, snap(c0.start + clipLen(c0) + dx) - c0.start) });
      }
    }
  }

  function endDrag(e?: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    onSnapGuide(null);
    setMarquee(null);
    // Always release a captured pointer so it can never get stuck on the lanes.
    if (d?.captured && e) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(d.pointerId ?? e.pointerId);
      } catch {
        /* noop */
      }
    }
    // A plain click on empty timeline (no drag): deselect + move the playhead.
    if (d && d.mode === "marquee" && !d.moved) {
      if (!d.additive) onSelect(null);
      onSeek(timeAt(d.startX));
    }
    if (d && d.mode !== "scrub" && d.mode !== "marquee" && d.moved) {
      // Ripple trim (right edge): once the clip's new length is committed, shift
      // EVERY clip that began at/after this clip's ORIGINAL end by the same delta —
      // across all tracks, so a linked A/V pair stays in sync. Extending pushes the
      // rest right; shortening pulls it left to close the gap.
      if (ripple && d.mode === "trim-r" && d.clip0) {
        const c0 = d.clip0;
        const origEnd = clipEnd(c0);
        // Still inside the drag bracket (draggingRef true), so this folds into the
        // single drag undo entry rather than pushing its own.
        onCommit((p) => {
          const cur = p.clips.find((c) => c.id === c0.id);
          if (!cur) return p;
          const delta = clipEnd(cur) - origEnd;
          if (Math.abs(delta) < 0.001) return p;
          return { ...p, clips: p.clips.map((c) => (c.id !== c0.id && c.start >= origEnd - 0.001 ? { ...c, start: Math.max(0, c.start + delta) } : c)) };
        });
      }
      // State was already updated live during the drag; just close the undo bracket
      // (the old `onCommit((p) => p)` here pushed a duplicate snapshot → a dead Ctrl+Z).
      if (d.began) onDragEndClip();
    }
  }

  // Timeline scrolling:
  //   • plain wheel      → scroll the track stack VERTICALLY (native; reaches the
  //                         last track no matter how many there are)
  //   • Shift + wheel    → scroll horizontally (up = left, down = right)
  //   • Ctrl/Cmd + wheel → zoom, anchored on the time under the cursor
  //   • trackpad deltaX  → horizontal scroll
  function onWheel(e: React.WheelEvent) {
    const el = scrollRef.current;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cox = e.clientX - rect.left; // cursor offset within the viewport
      const tUnder = (cox + el.scrollLeft) / pxPerSec; // timeline time under cursor
      const nz = clamp(pxPerSec * (e.deltaY < 0 ? 1.12 : 0.89), MIN_PPS, MAX_PPS);
      onSetZoom(() => nz);
      // After the content re-widths, keep that exact time pinned under the cursor.
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, tUnder * nz - cox);
      });
      return;
    }
    // Shift (or a trackpad's horizontal delta) → horizontal scroll.
    const wantHoriz = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (wantHoriz) {
      const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (el.scrollWidth > el.clientWidth + 1 && horiz) {
        el.scrollLeft += horiz; // deltaY up → left, down → right
        e.preventDefault();
      }
      return;
    }
    // Plain wheel → let the outer container scroll the track stack vertically.
    // (We deliberately do NOT preventDefault so native vertical scrolling runs.)
  }

  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-panel" style={{ height }}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line/70 px-2.5">
        <div className="flex items-center gap-1.5 pr-1 text-[11px] font-700 uppercase tracking-[0.14em] text-muted">
          <Film className="h-3.5 w-3.5 text-accent" strokeWidth={2.2} /> Timeline
        </div>
        {/* Sticky tools — a tool stays active until you pick Select (V). Tooltips show
            the name + shortcut. This is the quick-access toolbar pinned to the header. */}
        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-panel2/60 p-0.5">
          {([
            { id: "select" as Tool, icon: MousePointer2, label: "Select", k: "V" },
            { id: "split" as Tool, icon: Scissors, label: "Split", k: "S" },
            { id: "text" as Tool, icon: TypeIcon, label: "Text", k: "T" },
            { id: "mark" as Tool, icon: MapPin, label: "Marker", k: "M" },
          ]).map((t) => (
            <button
              key={t.id}
              title={`${t.label} (${t.k})`}
              onClick={() => onSetTool(t.id)}
              className={cx(
                "focus-ring grid h-7 w-7 place-items-center rounded-md transition-colors",
                tool === t.id ? "bg-accent text-[var(--on-accent)] shadow-[0_1px_4px_oklch(0_0_0_/_0.3)]" : "text-dim hover:bg-hover hover:text-ink"
              )}
            >
              <t.icon className="h-[15px] w-[15px]" strokeWidth={2.1} />
            </button>
          ))}
        </div>
        <div className="h-5 w-px bg-line/70" />
        <div className="flex items-center gap-0.5">
          <IconAction icon={Magnet} label="Snapping (magnet)" active={snapping} onClick={onToggleSnap} />
          <IconAction icon={MoveHorizontal} label="Ripple trim — shift later clips" active={ripple} onClick={onToggleRipple} />
          <IconAction icon={Repeat} label="Loop playback" active={loop} onClick={onToggleLoop} />
        </div>
        <span className="ml-auto hidden text-[10.5px] text-dim sm:block">{tool === "select" ? "Drag media here · drop over a clip to stack a track" : `${tool[0].toUpperCase() + tool.slice(1)} tool — click a clip · Esc or V to exit`}</span>
      </div>

      {/* fixed top strip — track-column corner + the time ruler. It scrolls
          horizontally in lock-step with the lanes but is pinned vertically, so it
          never disappears when you scroll down the track stack. */}
      <div className="flex shrink-0">
        <div className="shrink-0 border-b border-r border-line/60 bg-panel" style={{ width: headerW }} />
        <div className="w-1.5 shrink-0 border-b border-line/60" />
        <div ref={rulerScrollRef} className="relative min-w-0 flex-1 overflow-hidden" onWheel={onWheel}>
          <div className="relative" style={{ width: contentW }}>
            <Ruler duration={safeDur} contentW={contentW} pxPerSec={pxPerSec} fps={project.fps || 30} markers={markers} range={range} onScrub={onSeek} dragRef={drag} onRemoveMarker={props.onRemoveMarker} onRemoveAllMarkers={props.onRemoveAllMarkers} onSetRange={props.onSetRange} />
            {/* Playhead HEAD sits ON the ruler (not under it): a downward pointer that
                visually connects to the lane playhead line below. A self-subscribing
                leaf so its per-frame move re-renders ONLY itself, not the timeline. */}
            <RulerPlayhead store={phStore} pxPerSec={pxPerSec} />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-y-auto">
        {/* headers */}
        <div className="shrink-0 border-r border-line/70 bg-panel" style={{ width: headerW }}>
          {project.tracks.map((t) => {
            const sameKind = project.tracks.filter((x) => x.kind === t.kind).length;
            const canDelete = t.kind === "text" || sameKind > 1;
            return (
              <TrackHeader
                key={t.id}
                track={t}
                flash={t.id === flashTrack}
                rowH={rowHOf(t)}
                canDelete={canDelete}
                onResize={(d) => onPatchTrack(t.id, { height: clamp((t.height ?? trackH) + d, 32, 320) })}
                onResetH={() => onPatchTrack(t.id, { height: undefined })}
                onDelete={() => onDeleteTrack(t.id)}
                onPatch={(p) => onPatchTrack(t.id, p)}
              />
            );
          })}
          {/* clearance so the last header isn't hidden under the horizontal scrollbar */}
          <div className="shrink-0" style={{ height: 20 }} />
        </div>

        {/* drag to resize the track-name column */}
        <ResizeHandle axis="x" className="!w-1.5" onReset={() => onHeaderW(DEFAULT_LAYOUT.header)} onDelta={(d) => onHeaderW(headerW + d)} />

        {/* lanes */}
        {/* self-start: size to the lane CONTENT height, don't let the flex row
            stretch it to the viewport — that collapse clipped the lower tracks and
            put the horizontal scrollbar on top of them. Now the OUTER container
            scrolls the whole stack and the scrollbar sits below the last lane. */}
        <div ref={scrollRef} className="relative min-w-0 flex-1 self-start overflow-x-auto overflow-y-hidden" onWheel={onWheel} onScroll={syncRuler} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={onDragLeave}>
          <div className="relative" style={{ width: contentW }}>
            <div
              ref={laneWrapRef}
              // position:relative so absolutely-positioned children (the drop
              // ghost / marquee) resolve against the LANES, not the content div
              // that also contains the 28px ruler — otherwise the drop preview
              // floated a row too high and read as "not aligned with the track".
              className="relative"
              style={{ cursor: TOOL_CURSOR[tool] || undefined }}
              onContextMenu={(e) => {
                // Right-click empty lane → track menu (Insert track, rename, delete).
                // Clips stopPropagation on their own context menu, so this only fires
                // for the bare lane background.
                e.preventDefault();
                const rect = laneWrapRef.current?.getBoundingClientRect();
                const t = rect ? project.tracks[idxAtY(e.clientY - rect.top)] : null;
                if (t) setTrackMenu({ x: e.clientX, y: e.clientY, trackId: t.id });
              }}
              onPointerMove={onMove}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                // A sticky tool acts on the empty lane and stays active: Text drops a
                // title at the click time, Marker drops a marker. (Split acts on clips.)
                if (tool === "text") { onAddTextAt(timeAt(e.clientX)); return; }
                if (tool === "mark") { onAddMarkAt(timeAt(e.clientX)); return; }
                if (tool !== "select") return;
                // Background press → arm a rubber-band marquee for batch selection.
                // Capture happens on the first real move (see onMove); a no-drag
                // release deselects + seeks (see endDrag) — so a plain click still
                // moves the playhead, while a drag rubber-band-selects clips.
                const additive = e.shiftKey || e.ctrlKey || e.metaKey;
                drag.current = { mode: "marquee", startX: e.clientX, startY: e.clientY, additive, moved: false, captured: false, pointerId: e.pointerId };
              }}
            >
              {project.tracks.map((t) => (
                <TrackLane
                  key={t.id}
                  track={t}
                  clips={clipsByTrack[t.id] || EMPTY_CLIPS}
                  pxPerSec={pxPerSec}
                  trackH={heightOf(t)}
                  rowH={rowHOf(t)}
                  flash={t.id === flashTrack}
                  selId={selId}
                  selIds={selIds}
                  selLinkIds={selLinkIds}
                  toolCursor={TOOL_CURSOR[tool]}
                  onClipDown={onClipDown}
                  onContext={onClipContext}
                />
              ))}

              {/* Between-transition badges at adjacent-clip junctions — a bow-tie chip
                  straddling the seam; click to crossfade the two clips. */}
              {junctions.map((j, i) => (
                <button
                  key={i}
                  title="Add transition between clips"
                  onPointerDown={(e) => { e.stopPropagation(); onEditTransition(j.clipId, "between", e.clientX, e.clientY); }}
                  className="group/j absolute z-40 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-accent/70 bg-[var(--bg-elevated,#1a1b22)] text-accent shadow-[0_2px_8px_oklch(0_0_0_/_0.5)] transition-all hover:scale-110 hover:bg-accent hover:text-[var(--on-accent)]"
                  style={{ left: j.x, top: j.y }}
                >
                  <BowTie />
                </button>
              ))}

              {/* drop ghost — shows where the dragged clip lands + its track */}
              {dropHint && (() => {
                const gw = Math.max(14, dropHint.dur * pxPerSec);
                return (
                  <div className="pointer-events-none absolute z-40" style={{ left: dropHint.t * pxPerSec, top: dropHint.top + 2, width: gw, height: dropHint.h }}>
                    <div className="flex h-full w-full items-center gap-1.5 overflow-hidden rounded-md border-2 border-dashed border-accent bg-accent/20 px-2 shadow-[0_0_0_1px_oklch(0_0_0_/_0.3),0_6px_18px_oklch(0_0_0_/_0.35)] backdrop-blur-[1px]">
                      {dropHint.kind === "audio" ? <Music className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.2} /> : <Film className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.2} />}
                      <span className="truncate text-[11px] font-600 text-ink">{dropHint.name}</span>
                    </div>
                    {dropHint.newTrack && (
                      <span className="absolute -top-2.5 left-0 rounded bg-accent px-1.5 py-px text-[8.5px] font-800 uppercase tracking-wide text-[var(--on-accent)] shadow">+ New track</span>
                    )}
                  </div>
                );
              })()}

              {/* Dragging a VIDEO also brings its linked AUDIO → preview a second
                  ghost on the first audio track so it's clear both land. */}
              {dropHint && dropHint.kind === "video" && (() => {
                const aIdx = project.tracks.findIndex((t) => t.kind === "audio");
                if (aIdx < 0) return null;
                const gw = Math.max(14, dropHint.dur * pxPerSec);
                const aTrack = project.tracks[aIdx];
                return (
                  <div className="pointer-events-none absolute z-40" style={{ left: dropHint.t * pxPerSec, top: tops[aIdx] + 2, width: gw, height: (aTrack.height ?? trackH) }}>
                    <div className="flex h-full w-full items-center gap-1.5 overflow-hidden rounded-md border-2 border-dashed border-[oklch(0.7_0.13_285)]/70 bg-[oklch(0.55_0.13_285)]/20 px-2 backdrop-blur-[1px]">
                      <Music className="h-3.5 w-3.5 shrink-0 text-[oklch(0.78_0.13_285)]" strokeWidth={2.2} />
                      <span className="truncate text-[11px] font-600 text-ink/80">Audio</span>
                    </div>
                  </div>
                );
              })()}

              {/* marquee rectangle (viewport-fixed so it tracks the cursor exactly) */}
              {marquee && marquee.w > 2 && marquee.h > 2 && (
                <div
                  className="pointer-events-none fixed z-[55] rounded-[3px] border border-accent bg-accent/15"
                  style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
                />
              )}
            </div>

            {/* playhead line through the lanes + the scrub-grab strip — the HEAD lives
                on the ruler above. A self-subscribing leaf so its per-frame move
                re-renders only itself; the memoized timeline around it stays put. */}
            <LanePlayhead
              store={phStore}
              pxPerSec={pxPerSec}
              lanesH={lanesH}
              onDown={(e) => {
                e.stopPropagation();
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                drag.current = { mode: "scrub", startX: e.clientX, startY: e.clientY, moved: false };
                onSeek(timeAt(e.clientX));
              }}
              onMove={(e) => {
                if (drag.current?.mode === "scrub") onSeek(timeAt(e.clientX));
              }}
              onUp={(e) => {
                drag.current = null;
                try {
                  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
                } catch {
                  /* noop */
                }
              }}
            />
            {/* snap guide */}
            {props.snapGuide != null && <div className="pointer-events-none absolute top-0 z-30 w-px bg-accent/80" style={{ left: props.snapGuide * pxPerSec, height: lanesH }} />}
            {/* clearance so the last lane isn't hidden under the horizontal scrollbar */}
            <div className="pointer-events-none" style={{ height: 20 }} />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {menu && <ClipMenu menu={menu} onClose={() => setMenu(null)} onAction={(a) => { if (a === "transition") setTransMenu({ x: menu.x, y: menu.y, clipId: menu.id, dir: "out" }); else if (a === "effects") onSelect(menu.id); else onContextAction(a, menu.id); }} />}
      </AnimatePresence>
      <AnimatePresence>
        {trackMenu && (
          <TrackMenu
            menu={trackMenu}
            track={project.tracks.find((t) => t.id === trackMenu.trackId) || null}
            onClose={() => setTrackMenu(null)}
            onInsert={(kind) => { onInsertTrack(kind, trackMenu.trackId); setTrackMenu(null); }}
            onDelete={() => { onDeleteTrack(trackMenu.trackId); setTrackMenu(null); }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {transMenu && (
          <TransitionMenu
            menu={transMenu}
            current={project.clips.find((c) => c.id === transMenu.clipId)?.transition}
            onClose={() => setTransMenu(null)}
            onPick={(kind, dir) => { onUpdateClip(transMenu.clipId, { transition: kind === "none" ? { kind: "none", duration: 0.5 } : { kind, duration: project.clips.find((c) => c.id === transMenu.clipId)?.transition?.duration || 0.5, dir } }); setTransMenu(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
});

// Memoized: it doesn't depend on the playhead, so during playback (when Edit
// re-renders 60fps) it bails instead of rebuilding hundreds/thousands of tick
// elements every frame — that DOM churn was a major source of mid-playback jank.
const Ruler = memo(function Ruler({ duration, contentW, pxPerSec, fps, markers, range, onScrub, dragRef, onRemoveMarker, onRemoveAllMarkers, onSetRange }: { duration: number; contentW: number; pxPerSec: number; fps: number; markers: number[]; range: { a: number; b: number } | null; onScrub: (t: number) => void; dragRef: React.MutableRefObject<any>; onRemoveMarker: (t: number) => void; onRemoveAllMarkers: () => void; onSetRange: (r: { a: number; b: number } | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const step = pxPerSec < 16 ? 30 : pxPerSec < 30 ? 10 : pxPerSec < 70 ? 5 : pxPerSec < 140 ? 2 : 1;
  void duration;
  // FRAME MODE: once a single frame is ≥7px wide, draw a tick per FRAME with a label
  // every second (m:ss · f). Otherwise draw regular second/minute ticks.
  const frameW = pxPerSec / Math.max(1, fps);
  const frameMode = frameW >= 7;
  // Fill the whole visible width with regular timeframes, not just up to a clip.
  const ticks = Math.min(4000, Math.max(2, Math.ceil(contentW / pxPerSec / step) + 1));
  const frameCount = frameMode ? Math.min(3000, Math.ceil(contentW / frameW) + 1) : 0;
  // In frame mode, label every Nth frame (≈ every 78px) with m:ss.mmm so you read
  // exact milliseconds when zoomed past second level.
  const labelEvery = frameMode ? Math.max(1, Math.round(78 / frameW)) : 1;
  const msLabel = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.round((t - Math.floor(t)) * 1000);
    return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
  };
  const [mkMenu, setMkMenu] = useState<{ x: number; y: number; t: number } | null>(null);
  // Skim guide — a faint line + time that follows the cursor across the ruler so you
  // can see exactly where a click will seek, without moving the playhead.
  const [skim, setSkim] = useState<number | null>(null);
  return (
    <div
      ref={ref}
      className="relative h-8 cursor-text border-b border-line/70 bg-gradient-to-b from-panel2/60 to-panel2/20 select-none"
      title="Drag to scrub · Alt+drag to set an export range · zoom in for frames"
      onPointerLeave={() => setSkim(null)}
      onPointerDown={(e) => {
        const rect = ref.current!.getBoundingClientRect();
        const t = Math.max(0, (e.clientX - rect.left) / pxPerSec);
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        if (e.altKey) {
          dragRef.current = { mode: "range", startX: e.clientX, rangeA: t };
          onSetRange({ a: t, b: t });
        } else {
          onScrub(t);
          dragRef.current = { mode: "scrub", startX: e.clientX };
        }
      }}
      onPointerMove={(e) => {
        const rect = ref.current!.getBoundingClientRect();
        const t = Math.max(0, (e.clientX - rect.left) / pxPerSec);
        if (dragRef.current?.mode === "scrub") onScrub(t);
        else if (dragRef.current?.mode === "range") {
          const a = dragRef.current.rangeA as number;
          onSetRange({ a: Math.min(a, t), b: Math.max(a, t) });
        } else setSkim(t);
      }}
      onPointerUp={() => {
        if (dragRef.current?.mode === "range" && range && range.b - range.a < 0.1) onSetRange(null);
        dragRef.current = null;
      }}
    >
      {range && <div className="pointer-events-none absolute top-0 h-full bg-accent/15" style={{ left: range.a * pxPerSec, width: (range.b - range.a) * pxPerSec }} />}
      {skim != null && (
        <div className="pointer-events-none absolute top-0 z-20 h-full" style={{ left: skim * pxPerSec }}>
          <div className="absolute top-0 h-full w-px -translate-x-1/2 bg-ink/30" />
          <span className="absolute -top-0 left-1 rounded bg-black/60 px-1 font-mono text-[8.5px] text-white/80 tnum">{fmtTime(skim).replace(/\.\d+$/, "")}</span>
        </div>
      )}
      {frameMode
        ? // Per-frame ticks. A frame at each second boundary is a tall labelled tick
          // (m:ss · f); the rest are short frame ticks — true frame-by-frame ruler.
          Array.from({ length: frameCount }).map((_, f) => {
            const t = f / fps;
            const isSecond = f % fps === 0;
            const labelled = f % labelEvery === 0;
            return (
              <div key={f} className="absolute top-0" style={{ left: t * pxPerSec }}>
                <div className={cx("w-px -translate-x-1/2", isSecond ? "h-3 bg-accent/70" : labelled ? "h-2 bg-line-strong/70" : "h-1.5 bg-line-strong/45")} />
                {labelled && <span className="absolute left-1 top-2.5 font-mono text-[9.5px] font-600 tabular-nums text-muted/95 [text-shadow:0_1px_2px_oklch(0_0_0_/_0.6)]">{msLabel(t)}</span>}
              </div>
            );
          })
        : Array.from({ length: ticks }).map((_, i) => {
            const t = i * step;
            return (
              <div key={i} className="absolute top-0 h-full" style={{ left: t * pxPerSec }}>
                <div className="h-2.5 w-px bg-line-strong/80" />
                <span className="absolute left-1 top-2 font-mono text-[10px] font-600 tabular-nums text-muted/95 [text-shadow:0_1px_2px_oklch(0_0_0_/_0.6)]">{fmtTime(t).replace(/\.\d+$/, "")}</span>
              </div>
            );
          })}
      {markers.map((m, i) => (
        <button
          key={i}
          title="Double-click to remove · right-click for options"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={() => onRemoveMarker(m)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMkMenu({ x: e.clientX, y: e.clientY, t: m });
          }}
          className="absolute top-0 z-10 -ml-1.5 h-full w-3"
          style={{ left: m * pxPerSec }}
        >
          <MapPin className="h-3 w-3 text-warn" fill="currentColor" strokeWidth={1.5} />
        </button>
      ))}
      <AnimatePresence>
        {mkMenu && (
          <MarkerMenu
            menu={mkMenu}
            onClose={() => setMkMenu(null)}
            onRemove={() => {
              onRemoveMarker(mkMenu.t);
              setMkMenu(null);
            }}
            onRemoveAll={() => {
              onRemoveAllMarkers();
              setMkMenu(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
});

function MarkerMenu({ menu, onClose, onRemove, onRemoveAll }: { menu: { x: number; y: number }; onClose: () => void; onRemove: () => void; onRemoveAll: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.12 }}
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-[60] w-44 rounded-xl border border-line bg-[var(--bg-elevated,#1a1b22)] p-1 shadow-[0_10px_30px_oklch(0_0_0_/_0.5)] ring-1 ring-black/40"
      style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 110) }}
    >
      <button onClick={onRemove} className="focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-ink">
        <MapPin className="h-4 w-4 shrink-0 text-dim" strokeWidth={2} /> Remove marker
      </button>
      <button onClick={onRemoveAll} className="focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-rec-soft hover:text-rec">
        <Trash2 className="h-4 w-4 shrink-0 text-dim" strokeWidth={2} /> Remove all markers
      </button>
    </motion.div>
  );
}

// Crossfade "bow-tie" glyph — two triangles meeting at the centre (the universal
// transition symbol), drawn crisply at any size.
function BowTie() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path d="M2 3 L7 8 L2 13 Z" />
      <path d="M14 3 L9 8 L14 13 Z" />
    </svg>
  );
}

const ClipView = memo(function ClipView({ clip, track, pxPerSec, trackH, selected, primary, toolCursor, onPointerDownClip, onContext }: { clip: Clip; track: Track; pxPerSec: number; trackH: number; selected: boolean; primary?: boolean; toolCursor?: string; onPointerDownClip: (e: React.PointerEvent, c: Clip, mode: "move" | "trim-l" | "trim-r") => void; onContext: (id: string, x: number, y: number) => void }) {
  const w = Math.max(10, clipLen(clip) * pxPerSec);
  const left = clip.start * pxPerSec;
  const isText = clip.kind === "text";
  const isAudio = clip.kind === "audio" || track.kind === "audio";
  const strip = useFilmstrip(clip.kind === "video" ? clip.path : undefined);
  const wave = useWaveform(isAudio ? clip.path : undefined);
  const fadeInW = clamp((clip.fadeIn ?? 0) * pxPerSec, 0, w / 2);
  const fadeOutW = clamp((clip.fadeOut ?? 0) * pxPerSec, 0, w / 2);
  // Map a full-source strip/waveform image so the clip's [in,out] slice fills its
  // width — backgroundSize stretches the source duration, positionX shifts to `in`.
  const span = Math.max(0.001, clip.out - clip.in);
  const imgBg = (img: { url: string; dur: number } | null): React.CSSProperties | undefined => {
    if (!img) return undefined;
    const d = img.dur > 0.05 ? img.dur : span;
    return {
      backgroundImage: `url("${img.url}")`,
      backgroundRepeat: "no-repeat",
      backgroundSize: `${(w * d) / span}px 100%`,
      backgroundPositionX: `${-(clip.in / span) * w}px`,
    };
  };
  const vol = clamp(clip.volume ?? 1, 0, 2);

  return (
    <div
      onPointerDown={(e) => {
        // Edge-proximity detection: pressing near either end trims even if the
        // thin resize handle is missed by a couple px (fixes "end read as move").
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const edge = Math.min(14, r.width / 3);
        const mode = !track.locked && e.clientX - r.left <= edge ? "trim-l" : !track.locked && r.right - e.clientX <= edge ? "trim-r" : "move";
        onPointerDownClip(e, clip, mode);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContext(clip.id, e.clientX, e.clientY);
      }}
      className={cx("group absolute top-[2px] overflow-hidden rounded-md border", selected ? cx("z-20 border-accent", primary ? "ring-2 ring-accent" : "ring-1 ring-accent/80") : "z-10 border-black/30 hover:border-line-strong", track.locked && "opacity-60")}
      style={{ left, width: w, height: trackH, cursor: toolCursor || (track.locked ? "default" : "grab"), background: isText ? "linear-gradient(180deg, oklch(0.74 0.12 195 / 0.22), oklch(0.74 0.12 195 / 0.08))" : isAudio ? "linear-gradient(180deg, oklch(0.5 0.13 285 / 0.34), oklch(0.32 0.09 285 / 0.18))" : "#0c0c10" }}
    >
      {clip.transition && clip.transition.kind !== "none" && (
        (clip.transition.dir ?? "between") === "out" ? (
          <div className="absolute -right-px top-0 z-20 flex h-full w-4 items-center justify-center bg-gradient-to-l from-accent/70 to-transparent" title={`Transition out: ${clip.transition.kind}`}>
            <Combine className="h-3 w-3 text-white" strokeWidth={2.4} />
          </div>
        ) : (
          <div className="absolute -left-px top-0 z-20 flex h-full w-4 items-center justify-center bg-gradient-to-r from-accent/70 to-transparent" title={`Transition ${(clip.transition.dir ?? "between") === "in" ? "in" : "between"}: ${clip.transition.kind}`}>
            <Combine className="h-3 w-3 text-white" strokeWidth={2.4} />
          </div>
        )
      )}
      {clip.kind === "video" && (
        <div className="absolute inset-0 flex overflow-hidden">
          {/* DISCRETE frame thumbnails (not one stretched image): N tiles sized ~16:9
              to the track height, so frames keep aspect. N = clip width ÷ tile width,
              so it ADAPTS to zoom (more tiles zoomed in, fewer out) and stays sparse. */}
          {(() => {
            const cnt = strip?.count ?? 0;
            const sdur = strip && strip.dur > 0.05 ? strip.dur : span;
            if (!strip || cnt < 1) return <div className="h-full w-full bg-black/30" />;
            // FIXED-WIDTH tiles (≈16:9 to the track height) laid left→right. Zooming
            // widens the clip → MORE tiles, each sampling a new point in time, and the
            // tiles NEVER stretch. Capped for DOM safety; nearest frame is sampled.
            const tileW = Math.max(44, Math.round(trackH * (16 / 9)));
            const N = clamp(Math.floor(w / tileW) + 1, 1, 400);
            return Array.from({ length: N }).map((_, i) => {
              const src = clip.in + ((i + 0.5) / N) * (clip.out - clip.in);
              const k = clamp(Math.round((src / sdur) * (cnt - 1)), 0, cnt - 1);
              const pos = cnt > 1 ? (k / (cnt - 1)) * 100 : 0;
              return (
                <div
                  key={i}
                  className="h-full shrink-0 border-r border-black/30 [filter:saturate(0.92)_brightness(0.9)]"
                  style={{ width: tileW, backgroundImage: `url("${strip.url}")`, backgroundSize: `${cnt * 100}% 100%`, backgroundPositionX: `${pos}%`, backgroundRepeat: "no-repeat" }}
                />
              );
            });
          })()}
          {/* top sheen + bottom shade give depth without hiding the footage */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.05] via-transparent to-black/30" />
        </div>
      )}
      {isAudio && (
        <div className="absolute inset-0">
          {/* subtle inner sheen for depth */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.07] to-transparent" />
          {/* real waveform (full-source image, sliced to [in,out]) — large, centred
              and glowing so the signal reads clearly, like a pro mixer lane */}
          {wave ? (
            <div className="absolute inset-x-0 top-1/2 h-[86%] -translate-y-1/2 opacity-100 [filter:drop-shadow(0_0_4px_oklch(0.72_0.14_285_/_0.65))]" style={imgBg(wave)} />
          ) : (
            <div className="absolute inset-x-0 top-1/2 flex h-[80%] -translate-y-1/2 items-center gap-px px-1 opacity-55">
              {Array.from({ length: clamp(Math.floor(w / 4), 4, 400) }).map((_, k) => (
                <span key={k} className="flex-1 rounded-full bg-[oklch(0.76_0.14_285)]" style={{ height: `${28 + ((k * 53) % 64)}%` }} />
              ))}
            </div>
          )}
          {/* centre baseline for a clean signal reference */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
          {/* volume gain line — height encodes the clip volume (0–200%) */}
          <div className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-warn/70" style={{ top: `${(1 - vol / 2) * 100}%` }} />
          <span className="pointer-events-none absolute right-1 top-0.5 z-10 inline-flex items-center gap-0.5 rounded bg-black/45 px-1 font-mono text-[8.5px] font-700 text-warn tnum">{Math.round(vol * 100)}%</span>
        </div>
      )}
      {isText && (
        <div className="absolute inset-0 flex items-center gap-1.5 px-2">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.08] to-transparent" />
          <span className="grid h-[19px] w-[19px] shrink-0 place-items-center rounded-md bg-gradient-to-br from-[oklch(0.78_0.12_195)] to-[oklch(0.62_0.13_205)] text-[var(--on-accent)] shadow-[0_1px_3px_oklch(0_0_0_/_0.4)]">
            <TypeIcon className="h-3 w-3" strokeWidth={2.6} />
          </span>
          <span className="truncate text-[11px] font-700 text-ink drop-shadow">{clip.text || "Text"}</span>
        </div>
      )}
      {/* fade overlays */}
      {fadeInW > 1 && <div className="pointer-events-none absolute left-0 top-0 z-10 h-full" style={{ width: fadeInW, background: "linear-gradient(90deg, rgba(0,0,0,0.65), transparent)" }} />}
      {fadeOutW > 1 && <div className="pointer-events-none absolute right-0 top-0 z-10 h-full" style={{ width: fadeOutW, background: "linear-gradient(270deg, rgba(0,0,0,0.65), transparent)" }} />}

      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-1.5 py-0.5">
        <span className="truncate font-mono text-[9.5px] text-white/85 tnum drop-shadow">{!isText ? clip.name : ""}</span>
        <span className="flex items-center gap-0.5">
          {clip.reverse && <FlipHorizontal className="h-2.5 w-2.5 text-white/80" strokeWidth={2.5} />}
          {clip.speed !== 1 && (clip.kind === "video" || clip.kind === "audio") && <span className="rounded bg-accent px-1 text-[8.5px] font-700 text-[var(--on-accent)]">{clip.speed}×</span>}
        </span>
      </div>

      {!track.locked && (
        <>
          <span onPointerDown={(e) => onPointerDownClip(e, clip, "trim-l")} className="group/edge absolute left-0 top-0 z-30 flex h-full w-3 cursor-ew-resize items-center justify-center hover:bg-accent/30">
            <span className="h-1/2 w-[3px] rounded-full bg-white/0 transition-colors group-hover/edge:bg-white/80" />
          </span>
          <span onPointerDown={(e) => onPointerDownClip(e, clip, "trim-r")} className="group/edge absolute right-0 top-0 z-30 flex h-full w-3 cursor-ew-resize items-center justify-center hover:bg-accent/30">
            <span className="h-1/2 w-[3px] rounded-full bg-white/0 transition-colors group-hover/edge:bg-white/80" />
          </span>
        </>
      )}
      {/* In/out transitions live in the right-click menu (Transition…); adjacent-clip
          crossfades use the seam badge — so no per-clip edge buttons cluttering the seam. */}
    </div>
  );
});

// Stable empty array so a track with no clips never hands TrackLane a fresh
// reference (which would defeat its memoization).
const EMPTY_CLIPS: Clip[] = [];

// One timeline row. Memoized so that the heavy clip element tree is only rebuilt
// when this row's own inputs change — NOT on every playhead frame during
// playback (the playhead line is a separate, lightweight overlay).
const TrackLane = memo(function TrackLane({
  track,
  clips,
  pxPerSec,
  trackH,
  rowH,
  flash,
  selId,
  selIds,
  selLinkIds,
  toolCursor,
  onClipDown,
  onContext,
}: {
  track: Track;
  clips: Clip[];
  pxPerSec: number;
  trackH: number;
  rowH: number;
  flash: boolean;
  selId: string | null;
  selIds: string[];
  selLinkIds: Set<string>;
  toolCursor: string;
  onClipDown: (e: React.PointerEvent, c: Clip, mode: "move" | "trim-l" | "trim-r") => void;
  onContext: (id: string, x: number, y: number) => void;
}) {
  return (
    <div className={cx("relative border-b border-line/40 transition-colors", flash && "bg-accent-soft/40")} style={{ height: rowH, padding: "2px 0", cursor: toolCursor || undefined }}>
      {track.kind === "audio" && <div className="pointer-events-none absolute inset-0 bg-[var(--bg-sunken)]/30" />}
      {track.kind === "text" && <div className="pointer-events-none absolute inset-0 bg-accent-soft/10" />}
      {clips.map((c) => (
        <ClipView key={c.id} clip={c} track={track} pxPerSec={pxPerSec} trackH={trackH} selected={selIds.includes(c.id) || (!!c.linkId && selLinkIds.has(c.linkId))} primary={c.id === selId} toolCursor={toolCursor} onPointerDownClip={onClipDown} onContext={onContext} />
      ))}
    </div>
  );
});

const TrackHeader = memo(function TrackHeader({ track, flash, rowH, canDelete, onResize, onResetH, onDelete, onPatch }: { track: Track; flash: boolean; rowH: number; canDelete: boolean; onResize: (d: number) => void; onResetH: () => void; onDelete: () => void; onPatch: (p: Partial<Track>) => void }) {
  const lastY = useRef(0);
  const dragging = useRef(false);
  const compact = rowH < 52; // hide secondary controls on very short tracks
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(track.name);
  return (
    <div
      className={cx("group/th relative flex items-center gap-0.5 border-b border-line/40 px-2 transition-colors", flash && "bg-accent-soft/50")}
      style={{
        height: rowH,
        // Per-kind tint + a coloured left accent so each track type reads at a glance.
        background: flash ? undefined : track.kind === "video" ? "linear-gradient(90deg, oklch(0.6 0.13 235 / 0.14), transparent 60%)" : track.kind === "audio" ? "linear-gradient(90deg, oklch(0.62 0.14 285 / 0.16), transparent 60%)" : "linear-gradient(90deg, oklch(0.72 0.12 195 / 0.16), transparent 60%)",
        boxShadow: `inset 3px 0 0 ${track.kind === "video" ? "oklch(0.62 0.14 235)" : track.kind === "audio" ? "oklch(0.66 0.15 285)" : "oklch(0.74 0.12 195)"}`,
      }}
    >
      {track.kind === "video" ? <Film className="h-3.5 w-3.5 shrink-0 text-dim" strokeWidth={2} /> : track.kind === "text" ? <TypeIcon className="h-3.5 w-3.5 shrink-0 text-dim" strokeWidth={2} /> : <Music className="h-3.5 w-3.5 shrink-0 text-dim" strokeWidth={2} />}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { const n = draft.trim(); if (n) onPatch({ name: n }); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") { setDraft(track.name); setEditing(false); } e.stopPropagation(); }}
          className="min-w-0 flex-1 rounded border border-accent/60 bg-panel2 px-1 text-[11px] font-600 text-ink outline-none"
        />
      ) : (
        <span title="Double-click to rename" onDoubleClick={() => { setDraft(track.name); setEditing(true); }} className="min-w-0 flex-1 cursor-text truncate text-[11px] font-500 text-muted">
          {track.name}
        </span>
      )}
      {track.kind !== "text" && (
        <button onClick={() => onPatch({ muted: !track.muted })} title="Mute" className={cx("grid h-6 w-6 place-items-center rounded text-dim hover:bg-hover", track.muted && "text-rec")}>
          {track.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
      )}
      {!compact && (track.kind === "video" || track.kind === "text") && (
        <button onClick={() => onPatch({ hidden: !track.hidden })} title="Hide" className={cx("grid h-6 w-6 place-items-center rounded text-dim hover:bg-hover", track.hidden && "text-warn")}>
          {track.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
      {!compact && (
        <button onClick={() => onPatch({ locked: !track.locked })} title="Lock" className={cx("grid h-6 w-6 place-items-center rounded text-dim hover:bg-hover", track.locked && "text-accent")}>
          {track.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
        </button>
      )}
      {canDelete && (
        <button onClick={onDelete} title="Delete track" className="grid h-6 w-6 place-items-center rounded text-dim opacity-0 transition-opacity hover:bg-rec-soft hover:text-rec group-hover/th:opacity-100">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      {/* drag the bottom edge to resize JUST this track's height · double-click to reset */}
      <div
        title="Drag to resize track height · double-click to reset"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          dragging.current = true;
          lastY.current = e.clientY;
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const d = e.clientY - lastY.current;
          if (d) {
            onResize(d);
            lastY.current = e.clientY;
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
        onDoubleClick={onResetH}
        className="group absolute inset-x-0 -bottom-[3px] z-10 flex h-[7px] cursor-row-resize items-center justify-center"
      >
        <span className="h-[3px] w-8 rounded-full bg-line-strong/0 transition-colors group-hover:bg-accent" />
      </div>
    </div>
  );
});

function TransitionMenu({ menu, current, onClose, onPick }: { menu: { x: number; y: number; dir: TransitionDir }; current?: Clip["transition"]; onClose: () => void; onPick: (kind: TransitionKind, dir: TransitionDir) => void }) {
  const [dir, setDir] = useState<TransitionDir>(menu.dir);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, [onClose]);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.12 }}
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-[60] w-60 rounded-xl border border-line bg-[var(--bg-elevated,#1a1b22)] p-2 shadow-[0_10px_30px_oklch(0_0_0_/_0.5)] ring-1 ring-black/40"
      style={{ left: Math.min(menu.x - 110, window.innerWidth - 250), top: Math.min(menu.y, window.innerHeight - 280) }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-700 uppercase tracking-wider text-muted">Transition</span>
        <div className="flex gap-0.5 rounded-md bg-panel2 p-0.5">
          {TRANSITION_DIRS.map((d) => (
            <button key={d.id} onClick={() => setDir(d.id)} className={cx("rounded px-1.5 py-0.5 text-[10px] font-600 transition-colors", dir === d.id ? "bg-accent text-[var(--on-accent)]" : "text-dim hover:text-ink")}>{d.label}</button>
          ))}
        </div>
      </div>
      <div className="grid max-h-52 grid-cols-3 gap-1 overflow-auto pr-0.5">
        {TRANSITIONS.filter((t) => t.kind !== "none").map((t) => {
          const on = current && current.kind === t.kind && (current.dir ?? "between") === dir;
          return (
            <button key={t.kind} onClick={() => onPick(t.kind, dir)} className={cx("flex h-12 flex-col items-center justify-center gap-1 rounded-lg border text-[9.5px] font-500 transition-colors", on ? "border-accent/60 bg-accent-soft text-accent" : "border-line bg-panel2 text-muted hover:border-accent/40 hover:text-ink")}>
              <Combine className="h-3.5 w-3.5" strokeWidth={2} />
              {t.label}
            </button>
          );
        })}
      </div>
      <button onClick={() => onPick("none", dir)} className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] text-muted transition-colors hover:bg-rec-soft hover:text-rec">
        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} /> Remove transition
      </button>
    </motion.div>
  );
}

function TrackMenu({ menu, track, onClose, onInsert, onDelete }: { menu: { x: number; y: number }; track: Track | null; onClose: () => void; onInsert: (kind: Track["kind"]) => void; onDelete: () => void }) {
  const [sub, setSub] = useState(false);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);
  const inserts: { kind: Track["kind"]; label: string; icon: typeof Film }[] = [
    { kind: "video", label: "Media / video track", icon: Film },
    { kind: "audio", label: "Audio track", icon: Music },
    { kind: "text", label: "Text track", icon: TypeIcon },
  ];
  const sameKind = track ? 1 : 2; // for delete-guard parity with the header
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.12 }}
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-[60] w-52 rounded-xl border border-line bg-[var(--bg-elevated,#1a1b22)] p-1 shadow-[0_10px_30px_oklch(0_0_0_/_0.5)] ring-1 ring-black/40"
      style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 180) }}
    >
      <div className="relative" onMouseEnter={() => setSub(true)} onMouseLeave={() => setSub(false)}>
        <button className="focus-ring flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-ink">
          <span className="flex items-center gap-2.5"><Plus className="h-4 w-4 shrink-0 text-dim" strokeWidth={2} /> Insert track</span>
          <span className="text-dim">›</span>
        </button>
        {sub && (
          <div className="absolute left-full top-0 ml-1 w-48 rounded-xl border border-line bg-[var(--bg-elevated,#1a1b22)] p-1 shadow-[0_10px_30px_oklch(0_0_0_/_0.5)] ring-1 ring-black/40">
            {inserts.map((it) => (
              <button key={it.kind} onClick={() => onInsert(it.kind)} className="focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-ink">
                <it.icon className="h-4 w-4 shrink-0 text-dim" strokeWidth={2} /> {it.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {track && (track.kind === "text" || sameKind >= 1) && (
        <button onClick={onDelete} className="focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-rec-soft hover:text-rec">
          <Trash2 className="h-4 w-4 shrink-0 text-dim" strokeWidth={2} /> Delete this track
        </button>
      )}
    </motion.div>
  );
}

function ClipMenu({ menu, onClose, onAction }: { menu: { x: number; y: number; id: string }; onClose: () => void; onAction: (a: string) => void }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);
  const items = [
    { a: "split", label: "Split at playhead", icon: SplitSquareHorizontal },
    { a: "effects", label: "Effects…", icon: Sparkles },
    { a: "transition", label: "Transition…", icon: Combine },
    { a: "duplicate", label: "Duplicate", icon: Copy },
    { a: "unlink", label: "Unlink audio/video", icon: Unlink },
    { a: "detach", label: "Detach audio", icon: ArrowLeftRight },
    { a: "removeGaps", label: "Close gaps on track", icon: Combine },
    { a: "ripple", label: "Ripple delete", icon: Scissors },
    { a: "delete", label: "Delete", icon: Trash2 },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.12 }}
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-[60] w-48 rounded-xl border border-line bg-[var(--bg-elevated,#1a1b22)] p-1 shadow-[0_10px_30px_oklch(0_0_0_/_0.5)] ring-1 ring-black/40"
      style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }}
    >
      {items.map((it) => (
        <button
          key={it.a}
          onClick={() => {
            onAction(it.a);
            onClose();
          }}
          className={cx("focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors", it.a === "delete" ? "text-muted hover:bg-rec-soft hover:text-rec" : "text-muted hover:bg-hover hover:text-ink")}
        >
          <it.icon className="h-4 w-4 shrink-0 text-dim" strokeWidth={2} /> {it.label}
        </button>
      ))}
    </motion.div>
  );
}

/* ---------- Shortcuts ---------- */
function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows = [
    ["Space", "Play / pause"],
    ["V", "Select tool"],
    ["S", "Split tool (click clips to cut)"],
    ["T", "Text tool (click lane to add)"],
    ["M", "Marker tool (click to mark)"],
    [", / .", "Jump to prev / next marker"],
    ["I / O", "Set export in / out point"],
    ["X", "Clear export range"],
    ["Del / ⌫", "Delete clip"],
    ["Shift+Del", "Ripple delete"],
    ["Ctrl/⌘ + D", "Duplicate clip"],
    ["Ctrl/⌘ + Z", "Undo"],
    ["Ctrl/⌘ + Shift + Z", "Redo"],
    ["← / →", "Skip 5 seconds"],
    ["Shift + ← / →", "Step one frame"],
    ["Home / End", "Start / end"],
    ["Esc", "Deselect"],
    ["Ctrl + Scroll", "Zoom timeline"],
    ["Shift + Scroll", "Pan timeline"],
  ];
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="fixed inset-0 z-[55] grid place-items-center bg-black/72 p-8 backdrop-blur-md" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--shadow-pop)]">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-accent" strokeWidth={2} />
            <h2 className="text-[14px] font-700 text-ink">Keyboard shortcuts</h2>
          </div>
          <button onClick={onClose} className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-ink">
            <Plus className="h-4 w-4 rotate-45" strokeWidth={2} />
          </button>
        </header>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 p-4">
          {rows.map(([k, label]) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] text-muted">{label}</span>
              <kbd className="rounded border border-line bg-panel2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink">{k}</kbd>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---------- Export ---------- */
type Fmt = "mp4" | "mkv" | "webm" | "mov";
function ExportModal({ project, range, onClose }: { project: Project; range: { a: number; b: number } | null; onClose: () => void }) {
  const settings = useSettings();
  const [format, setFormat] = useState<Fmt>("mp4");
  const [codec, setCodec] = useState<"h264" | "hevc" | "av1">("h264");
  const [resolution, setResolution] = useState("source");
  const [quality, setQuality] = useState(72);
  const [audioKbps, setAudioKbps] = useState(192);
  const [name, setName] = useState("ahg-edit");
  const [useRange, setUseRange] = useState(!!range);
  const [folder, setFolder] = useState(settings.outputFolder || "");
  const [mltBusy, setMltBusy] = useState(false);

  // Resolve the effective default output folder if none is configured yet.
  useEffect(() => {
    if (!folder) studio?.recordingsDir().then((d) => d && setFolder(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isDefaultFolder = !!folder && folder === settings.outputFolder;

  async function pickFolder() {
    const d = await studio?.pickFolder();
    if (d) setFolder(d);
  }

  function run() {
    if (!studio) return;
    const spec = {
      tracks: project.tracks,
      clips: project.clips,
      fps: project.fps,
      width: project.width,
      height: project.height,
      bg: project.bg,
      duration: projectDuration(project),
      range: useRange && range ? range : null,
      format,
      codec,
      quality,
      resolution,
      audioKbps,
      outputName: name,
      outDir: folder || undefined,
    };
    // Hand the render to the global export job: it shows a premium progress modal
    // that can MINIMIZE to a background PiP (and stack with the optimize PiP).
    runExportJob(spec, name);
    onClose();
  }

  // Save the timeline as an MLT project (.mlt) — opens in Shotcut / renders via melt.
  async function saveMlt() {
    if (!studio) return;
    setMltBusy(true);
    const r = await studio.exportMlt({ tracks: project.tracks, clips: project.clips, fps: project.fps, width: project.width, height: project.height, outputName: name });
    setMltBusy(false);
    if (r.ok && r.output) {
      notify({ title: "Project saved", desc: "Editable .mlt project written.", tone: "success", action: { label: "Open", run: () => studio?.reveal(r.output!) } });
      onClose();
    } else notify({ title: "Project export failed", desc: r.error ?? "", tone: "error" });
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="fixed inset-0 z-[55] grid place-items-center bg-black/72 p-8 backdrop-blur-md" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--shadow-pop)]">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-accent" strokeWidth={2} />
            <h2 className="text-[14px] font-700 text-ink">Export timeline</h2>
          </div>
          <button onClick={onClose} className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-ink">
            <Plus className="h-4 w-4 rotate-45" strokeWidth={2} />
          </button>
        </header>
        <div className="max-h-[60vh] overflow-auto px-4">
          {
            <>
              <Field label="File name" stacked>
                <input value={name} onChange={(e) => setName(e.target.value)} className="focus-ring h-9 w-full rounded-lg border border-line bg-panel2 px-3 text-[13px] text-ink" />
              </Field>
              {/* output folder + make-default */}
              <Field label="Save to" stacked hint="Where the exported file is written.">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-panel2 px-2.5">
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-dim" strokeWidth={2} />
                      <span className="truncate font-mono text-[11.5px] text-muted" title={folder}>{folder || "Default folder"}</span>
                    </div>
                    <Btn size="sm" variant="subtle" onClick={pickFolder}>Change…</Btn>
                  </div>
                  <button
                    onClick={() => setSettings({ outputFolder: folder })}
                    disabled={!folder || isDefaultFolder}
                    className="focus-ring inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-600 text-accent transition-colors hover:bg-accent-soft disabled:cursor-default disabled:text-dim disabled:hover:bg-transparent"
                  >
                    {isDefaultFolder ? <><Check className="h-3 w-3" strokeWidth={2.6} /> This is your default</> : "Make this the default folder"}
                  </button>
                </div>
              </Field>
              <Field label="Format">
                <Segmented value={format} onChange={(v) => setFormat(v as Fmt)} options={[{ label: "MP4", value: "mp4" }, { label: "MKV", value: "mkv" }, { label: "MOV", value: "mov" }, { label: "WebM", value: "webm" }]} />
              </Field>
              <Field label="Codec">
                <div className="w-44">
                  <Select value={codec} onChange={(v) => setCodec(v as "h264" | "hevc" | "av1")} options={[{ label: "H.264", value: "h264" }, { label: "HEVC", value: "hevc" }, { label: "AV1", value: "av1" }]} />
                </div>
              </Field>
              <Field label="Resolution">
                <div className="w-44">
                  <Select value={resolution} onChange={setResolution} options={[{ label: "Source", value: "source" }, { label: "2160p", value: "2160" }, { label: "1440p", value: "1440" }, { label: "1080p", value: "1080" }, { label: "720p", value: "720" }]} />
                </div>
              </Field>
              {range && (
                <Field label="Range only" hint="Export just the selected region.">
                  <Toggle checked={useRange} onChange={setUseRange} label="Export range only" />
                </Field>
              )}
              <Field label="Quality" stacked hint="Higher = better & larger.">
                <div className="flex items-center gap-3">
                  <Slider value={quality} min={20} max={100} onChange={setQuality} />
                  <span className="w-9 text-right font-mono text-[13px] text-ink tnum">{quality}</span>
                </div>
              </Field>
              <Field label="Audio bitrate">
                <div className="w-32">
                  <Select value={String(audioKbps)} onChange={(v) => setAudioKbps(Number(v))} options={[{ label: "320 kbps", value: "320" }, { label: "256 kbps", value: "256" }, { label: "192 kbps", value: "192" }, { label: "128 kbps", value: "128" }]} />
                </div>
              </Field>
            </>
          }
        </div>
        <footer className="border-t border-line px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-dim">{project.clips.length} clips → {format.toUpperCase()}</span>
            <div className="flex items-center gap-2">
              <Btn variant="subtle" disabled={mltBusy} onClick={saveMlt} title="Save an editable Shotcut / MLT project file (.mlt)">
                {mltBusy ? "Saving…" : "Save .mlt"}
              </Btn>
              <Btn variant="primary" icon={Sparkles} onClick={run}>
                Render & export
              </Btn>
            </div>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  );
}
