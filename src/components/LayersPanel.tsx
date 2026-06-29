import { AnimatePresence, motion, Reorder, useDragControls } from "framer-motion";
import {
  AppWindow,
  ArrowDownToLine,
  ArrowUpToLine,
  Camera,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Film,
  GripVertical,
  Image as ImageIcon,
  Lock,
  Monitor,
  Pencil,
  Plus,
  Trash2,
  Type as TypeIcon,
  Unlock,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cx } from "../lib/format";
import type { Source, SourceType, useCapture } from "../hooks/useCapture";

type Cap = ReturnType<typeof useCapture>;

const ICON: Record<SourceType, typeof Monitor> = {
  display: Monitor,
  window: AppWindow,
  camera: Camera,
  image: ImageIcon,
  video: Film,
  text: TypeIcon,
};

const ADD_ITEMS: { type: SourceType; label: string; icon: typeof Monitor }[] = [
  { type: "display", label: "Display", icon: Monitor },
  { type: "window", label: "Window", icon: AppWindow },
  { type: "camera", label: "Webcam", icon: Camera },
  { type: "image", label: "Image", icon: ImageIcon },
  { type: "video", label: "Video", icon: Film },
  { type: "text", label: "Text", icon: TypeIcon },
];

interface MenuState {
  x: number;
  y: number;
  sourceId?: string;
}

export function LayersPanel({ cap, onAddSource }: { cap: Cap; onAddSource: (type?: SourceType) => void }) {
  const ordered = useMemo(() => [...cap.sources].sort((a, b) => b.z - a.z), [cap.sources]); // front first
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Stable identity so ContextMenu's window-listener effect doesn't resubscribe
  // on every parent render.
  const closeMenu = useCallback(() => setMenu(null), []);

  function openMenu(e: React.MouseEvent, sourceId?: string) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, sourceId });
  }

  return (
    <div
      className="relative h-full"
      onContextMenu={(e) => openMenu(e)}
    >
      <Reorder.Group
        axis="y"
        values={ordered}
        onReorder={(next: Source[]) => cap.reorderList(next.map((s) => s.id))}
        className="space-y-1"
        data-keep-selection
      >
        {ordered.map((s) => (
          <Row
            key={s.id}
            cap={cap}
            s={s}
            editing={editingId === s.id}
            onEdit={() => setEditingId(s.id)}
            onEditDone={() => setEditingId(null)}
            onContextMenu={(e) => openMenu(e, s.id)}
          />
        ))}
      </Reorder.Group>

      {ordered.length === 0 && (
        <button
          onClick={() => onAddSource()}
          onContextMenu={(e) => openMenu(e)}
          className="focus-ring flex h-full min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong/70 text-dim transition-colors hover:border-accent hover:text-muted"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent">
            <Plus className="h-4.5 w-4.5" strokeWidth={2} />
          </span>
          <span className="text-[12px]">Add a source — or right-click here</span>
        </button>
      )}

      <AnimatePresence>
        {menu && (
          <ContextMenu
            menu={menu}
            cap={cap}
            onClose={closeMenu}
            onAddSource={onAddSource}
            onRename={(id) => setEditingId(id)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({
  cap,
  s,
  editing,
  onEdit,
  onEditDone,
  onContextMenu,
}: {
  cap: Cap;
  s: Source;
  editing: boolean;
  onEdit: () => void;
  onEditDone: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const Icon = ICON[s.type];
  const on = s.id === cap.selectedId;
  const [name, setName] = useState(s.name);
  const controls = useDragControls();

  useEffect(() => {
    if (editing) setName(s.name);
  }, [editing, s.name]);

  function commit() {
    cap.renameSource(s.id, name.trim() || s.name);
    onEditDone();
  }

  return (
    <Reorder.Item
      value={s}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.025, boxShadow: "var(--shadow-pop)", cursor: "grabbing" }}
      transition={{ type: "spring", stiffness: 600, damping: 40 }}
      onClick={() => cap.select(s.id)}
      onContextMenu={onContextMenu}
      // Grab the row from ANYWHERE empty inside it (middle, name, icon) — not just
      // the grip. We start the drag unless the press landed on an interactive
      // control (button / input), so clicking the eye / lock / rename still works.
      onPointerDown={(e: React.PointerEvent) => {
        if (s.locked || e.button !== 0) return;
        if ((e.target as HTMLElement).closest("button,input")) return;
        controls.start(e);
      }}
      className={cx(
        "group flex items-center gap-1.5 rounded-lg border px-1.5 py-1.5 transition-colors",
        on ? "border-accent/40 bg-accent-soft" : "border-transparent hover:bg-hover",
        s.locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"
      )}
      style={{ position: "relative", touchAction: "none" }}
    >
      <button
        aria-label="Drag to reorder"
        onPointerDown={(e) => {
          e.stopPropagation();
          if (!s.locked) controls.start(e);
        }}
        className={cx(
          "grid h-6 w-4 shrink-0 cursor-grab touch-none place-items-center text-dim/60 transition-colors hover:text-muted active:cursor-grabbing",
          s.locked && "pointer-events-none opacity-30"
        )}
      >
        <GripVertical className="h-4 w-4" strokeWidth={2} />
      </button>
      <Icon className={cx("h-4 w-4 shrink-0", on ? "text-accent" : "text-dim")} strokeWidth={2} />
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") onEditDone();
          }}
          onClick={(e) => e.stopPropagation()}
          className="focus-ring h-6 min-w-0 flex-1 rounded border border-line bg-panel2 px-1.5 text-[12.5px] text-ink"
        />
      ) : (
        <span
          onDoubleClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className={cx("min-w-0 flex-1 truncate text-[12.5px]", on ? "text-ink" : s.visible ? "text-muted" : "text-dim line-through")}
        >
          {s.name}
        </span>
      )}
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
        <MiniBtn title="Bring forward" onClick={() => cap.reorder(s.id, 1)}>
          <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
        </MiniBtn>
        <MiniBtn title="Send back" onClick={() => cap.reorder(s.id, -1)}>
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
        </MiniBtn>
        <MiniBtn title={s.locked ? "Unlock" : "Lock"} onClick={() => cap.setLocked(s.id, !s.locked)} active={s.locked}>
          {s.locked ? <Lock className="h-3.5 w-3.5" strokeWidth={2} /> : <Unlock className="h-3.5 w-3.5" strokeWidth={2} />}
        </MiniBtn>
        <MiniBtn title="Delete" danger onClick={() => cap.removeSource(s.id)}>
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        </MiniBtn>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          cap.setVisible(s.id, !s.visible);
        }}
        aria-label="Toggle visibility"
        className={cx("focus-ring grid h-6 w-6 shrink-0 place-items-center rounded", s.visible ? "text-muted hover:text-ink" : "text-dim")}
      >
        {s.visible ? <Eye className="h-4 w-4" strokeWidth={2} /> : <EyeOff className="h-4 w-4" strokeWidth={2} />}
      </button>
    </Reorder.Item>
  );
}

function MiniBtn({ children, title, onClick, active, danger }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cx("focus-ring grid h-6 w-6 place-items-center rounded text-dim transition-colors hover:bg-panel2", active && "text-accent", danger ? "hover:text-rec" : "hover:text-ink")}
    >
      {children}
    </button>
  );
}

function ContextMenu({
  menu,
  cap,
  onClose,
  onAddSource,
  onRename,
}: {
  menu: MenuState;
  cap: Cap;
  onClose: () => void;
  onAddSource: (type?: SourceType) => void;
  onRename: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  const src = menu.sourceId ? cap.sources.find((s) => s.id === menu.sourceId) : null;

  // keep the menu fully on-screen
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let { x, y } = menu;
    if (x + r.width > window.innerWidth - 8) x = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight - 8) y = window.innerHeight - r.height - 8;
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [menu]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[60] w-52 origin-top-left rounded-xl border border-line bg-panel/96 p-1 shadow-[var(--shadow-pop)] backdrop-blur"
      style={{ left: pos.x, top: pos.y }}
    >
      {src ? (
        <>
          <MenuLabel>{src.name}</MenuLabel>
          <MenuItem icon={Pencil} onClick={run(() => onRename(src.id))}>Rename</MenuItem>
          <MenuItem icon={Copy} onClick={run(() => cap.duplicateSource(src.id))}>Duplicate</MenuItem>
          <MenuItem icon={src.visible ? EyeOff : Eye} onClick={run(() => cap.setVisible(src.id, !src.visible))}>
            {src.visible ? "Hide" : "Show"}
          </MenuItem>
          <MenuItem icon={src.locked ? Unlock : Lock} onClick={run(() => cap.setLocked(src.id, !src.locked))}>
            {src.locked ? "Unlock" : "Lock"}
          </MenuItem>
          <MenuDivider />
          <MenuItem icon={ArrowUpToLine} onClick={run(() => cap.moveToEdge(src.id, "front"))}>Bring to front</MenuItem>
          <MenuItem icon={ArrowDownToLine} onClick={run(() => cap.moveToEdge(src.id, "back"))}>Send to back</MenuItem>
          <MenuDivider />
          <MenuItem icon={Trash2} danger onClick={run(() => cap.removeSource(src.id))}>Delete</MenuItem>
        </>
      ) : (
        <>
          <MenuLabel>Add source</MenuLabel>
          {ADD_ITEMS.map((it) => (
            <MenuItem key={it.type} icon={it.icon} onClick={run(() => onAddSource(it.type))}>
              {it.label}
            </MenuItem>
          ))}
        </>
      )}
    </motion.div>
  );
}

function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="truncate px-2.5 py-1.5 text-[10px] font-600 uppercase tracking-wider text-dim">{children}</div>;
}
function MenuDivider() {
  return <div className="my-1 h-px bg-line/70" />;
}
function MenuItem({ children, icon: Icon, onClick, danger }: { children: React.ReactNode; icon: typeof Monitor; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors",
        danger ? "text-muted hover:bg-rec-soft hover:text-rec" : "text-muted hover:bg-hover hover:text-ink"
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-dim" strokeWidth={2} />
      {children}
    </button>
  );
}
