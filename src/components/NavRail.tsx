import { Clapperboard, LibraryBig, Settings, Video, Wand2, type LucideIcon } from "lucide-react";
import type { Page } from "../App";
import { cx } from "../lib/format";
import logo from "../assets/logo-256.png";

const MAIN: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: "record", label: "Record", icon: Video },
  { id: "library", label: "Library", icon: LibraryBig },
  { id: "edit", label: "Edit", icon: Clapperboard },
  { id: "optimize", label: "Optimize", icon: Wand2 },
];

export function NavRail({ current, onNavigate }: { current: Page; onNavigate: (p: Page) => void }) {
  return (
    <nav className="relative flex w-[78px] shrink-0 flex-col items-stretch border-r border-line bg-base px-2.5 py-3">
      {/* faint vertical brand wash so the rail reads as its own premium surface */}
      <div
        className="pointer-events-none absolute inset-0 -z-0 opacity-60"
        style={{ background: "linear-gradient(180deg, color-mix(in oklch, var(--accent) 6%, transparent), transparent 22%, transparent 78%, color-mix(in oklch, var(--accent) 5%, transparent))" }}
      />

      {/* brand mark — glow tracks the theme accent */}
      <div className="relative mb-3 flex flex-col items-center gap-1.5">
        <span className="grid h-10 w-10 place-items-center rounded-2xl border border-[color-mix(in_oklch,var(--accent)_28%,transparent)] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] shadow-[0_4px_18px_color-mix(in_oklch,var(--accent)_22%,transparent)]">
          <img src={logo} alt="AHG" className="h-7 w-7" style={{ filter: "drop-shadow(0 0 8px color-mix(in oklch, var(--accent) 55%, transparent))" }} />
        </span>
        <span className="text-[9px] font-700 uppercase tracking-[0.22em] text-dim">AHG</span>
      </div>

      <div className="relative h-px w-full bg-line/70" />

      {/* primary destinations */}
      <div className="relative mt-3 flex flex-col gap-1.5">
        {MAIN.map((item) => (
          <NavButton key={item.id} item={item} on={current === item.id} onNavigate={onNavigate} />
        ))}
      </div>

      {/* settings pinned to the bottom */}
      <div className="relative mt-auto flex flex-col gap-1.5 pt-3">
        <div className="mb-1 h-px w-full bg-line/70" />
        <NavButton item={{ id: "settings", label: "Settings", icon: Settings }} on={current === "settings"} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}

function NavButton({ item, on, onNavigate }: { item: { id: Page; label: string; icon: LucideIcon }; on: boolean; onNavigate: (p: Page) => void }) {
  const { id, label, icon: Icon } = item;
  return (
    <button
      onClick={() => onNavigate(id)}
      className={cx(
        "focus-ring group relative flex h-[60px] flex-col items-center justify-center gap-1 rounded-2xl transition-colors duration-150 ease-out",
        on ? "text-accent" : "text-dim hover:bg-hover hover:text-ink"
      )}
    >
      {/* Static CSS indicators (no framer layoutId) — the shared-layout projection
          mis-placed the glow bar below the icon (it doesn't account for the
          -translate transform). As children of the button they center on it exactly. */}
      {on && <span className="absolute inset-0 -z-0 rounded-2xl border border-[color-mix(in_oklch,var(--accent)_26%,transparent)] bg-accent-soft shadow-[inset_0_1px_0_oklch(1_0_0_/_0.04),0_4px_16px_color-mix(in_oklch,var(--accent)_22%,transparent)] animate-[fadein_.16s_ease]" />}
      {on && <span className="absolute left-[-10px] top-1/2 h-7 w-[3.5px] -translate-y-1/2 rounded-full bg-accent shadow-[0_0_12px_var(--accent)]" />}
      <Icon className="relative z-10 h-[20px] w-[20px] transition-transform duration-150 group-hover:scale-105 group-active:scale-90" strokeWidth={2} />
      <span className="relative z-10 text-[10px] font-600 tracking-wide">{label}</span>
    </button>
  );
}
