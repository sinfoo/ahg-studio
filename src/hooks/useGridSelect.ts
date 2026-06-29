import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Mods = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

/**
 * Windows-style selection for a grid/list of items identified by `data-sel-id`.
 * Provides Ctrl/Cmd-toggle, Shift-range, and rubber-band marquee selection.
 * Spread `bind` onto the scroll/grid container and give each item a
 * `data-sel-id={id}`; call `clickSelect(id, e)` from an item's click handler.
 */
export function useGridSelect(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const lastRef = useRef<string | null>(null);
  const dragRef = useRef<null | {
    ox: number;
    oy: number;
    base: Set<string>;
    moved: boolean;
    cr: DOMRect | null;
    items: { id: string; rect: DOMRect }[];
  }>(null);
  const rafRef = useRef<number | null>(null);
  const idsKey = ids.join("|");

  // Drop ids that no longer exist.
  useEffect(() => {
    setSelected((prev) => {
      const n = new Set([...prev].filter((id) => ids.includes(id)));
      return n.size === prev.size ? prev : n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const clickSelect = (id: string, e: Mods) => {
    if (e.ctrlKey || e.metaKey) {
      setSelected((p) => {
        const n = new Set(p);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      });
      lastRef.current = id;
    } else if (e.shiftKey && lastRef.current) {
      const a = ids.indexOf(lastRef.current);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        setSelected((p) => {
          const n = new Set(p);
          for (let i = lo; i <= hi; i++) n.add(ids[i]);
          return n;
        });
      }
    } else {
      setSelected(new Set([id]));
      lastRef.current = id;
    }
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-sel-id]")) return; // item handles its own click
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!additive) setSelected(new Set());
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    // Cache the container rect and every item's rect ONCE at drag start — they
    // don't move during a marquee drag, so re-querying + measuring on every
    // pointermove was pure layout thrash.
    const el = containerRef.current;
    const cr = el?.getBoundingClientRect() ?? null;
    const items = el
      ? Array.from(el.querySelectorAll<HTMLElement>("[data-sel-id]"))
          .map((node) => ({ id: node.dataset.selId, rect: node.getBoundingClientRect() }))
          .filter((it): it is { id: string; rect: DOMRect } => !!it.id)
      : [];
    dragRef.current = { ox: e.clientX, oy: e.clientY, base: additive ? new Set(selected) : new Set(), moved: false, cr, items };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    d.moved = true;
    const clientX = e.clientX;
    const clientY = e.clientY;
    // Coalesce state updates to one per frame — pointermove fires far faster than
    // we can usefully re-render, so we throttle setMarquee/setSelected via rAF.
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      // Clamp the band to the container so it never spills out across the rest of
      // the page when the cursor leaves the grid (matches the timeline marquee).
      const cr = d.cr;
      const cx = (n: number) => (cr ? Math.max(cr.left, Math.min(cr.right, n)) : n);
      const cy = (n: number) => (cr ? Math.max(cr.top, Math.min(cr.bottom, n)) : n);
      const x0 = cx(Math.min(d.ox, clientX));
      const y0 = cy(Math.min(d.oy, clientY));
      const x1 = cx(Math.max(d.ox, clientX));
      const y1 = cy(Math.max(d.oy, clientY));
      setMarquee({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      const hits = new Set<string>(d.base);
      for (const { id, rect: r } of d.items) {
        if (r.left < x1 && r.right > x0 && r.top < y1 && r.bottom > y0) hits.add(id);
      }
      setSelected(hits);
    });
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (dragRef.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        /* noop */
      }
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    dragRef.current = null;
    setMarquee(null);
  };

  // Cancel any pending marquee frame on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const setContainer = (el: HTMLElement | null) => {
    containerRef.current = el;
  };

  return {
    selected,
    setSelected,
    marquee,
    clickSelect,
    clear: () => setSelected(new Set()),
    bind: { ref: setContainer, onPointerDown, onPointerMove, onPointerUp },
  };
}
