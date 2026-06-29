import { Check, ChevronDown, Copy, Minus, Monitor, Palette, Plus, Settings, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import logo from "../assets/logo-256.png";
import { studio } from "../lib/bridge";
import { cx } from "../lib/format";
import { createProfile, deleteProfile, setSettings, switchProfile, THEMES, useProfiles, useSettings } from "../store/settings";
import { IconBtn } from "./ui";

export function TitleBar({ onNavigateSettings }: { onNavigateSettings: () => void }) {
  const { theme } = useSettings();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => studio?.window.onState(setMaximized), []);

  function cycleTheme() {
    const idx = THEMES.findIndex((t) => t.id === theme);
    setSettings({ theme: THEMES[(idx + 1) % THEMES.length].id });
  }

  return (
    <header className="drag relative flex h-11 shrink-0 items-center justify-between border-b border-line pl-2.5 pr-1.5">
      {/* premium surface: base with a faint accent wash + top hairline highlight */}
      <div
        className="pointer-events-none absolute inset-0 -z-0 border-b border-line"
        style={{ background: "linear-gradient(180deg, oklch(0.2 0.014 256), var(--bg-base))", boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.03)" }}
      />
      <div className="relative flex items-center gap-2.5">
        <span className="grid h-[26px] w-[26px] place-items-center rounded-lg border border-[oklch(0.74_0.12_195_/_0.28)] bg-[oklch(0.74_0.12_195_/_0.1)] shadow-[0_2px_10px_oklch(0.6_0.12_200_/_0.2)]">
          <img src={logo} alt="AHG Studio" className="h-[18px] w-[18px]" style={{ filter: "drop-shadow(0 0 6px oklch(0.74 0.13 195 / 0.5))" }} />
        </span>
        <span className="text-[13.5px] font-700 tracking-tight text-ink">AHG Studio</span>
        <span className="hidden items-center rounded-full border border-line/70 bg-panel/60 px-2 py-0.5 text-[9.5px] font-600 uppercase tracking-[0.18em] text-dim sm:inline-flex">
          Studio
        </span>

        <ProfileMenu />
      </div>

      <div className="no-drag relative flex items-center gap-0.5">
        <IconBtn icon={Settings} label="Settings" onClick={onNavigateSettings} />
        <IconBtn icon={Palette} label="Cycle theme" onClick={cycleTheme} />
        <div className="mx-1.5 h-4 w-px bg-line" />
        {/* window controls grouped on a subtle inset rail */}
        <div className="flex items-center gap-0.5 rounded-lg bg-panel/40 p-0.5">
          <button aria-label="Minimize" title="Minimize" onClick={() => studio?.window.minimize()} className="focus-ring grid h-7 w-8 place-items-center rounded-md text-dim transition-colors hover:bg-hover hover:text-ink">
            <Minus className="h-4 w-4" strokeWidth={2} />
          </button>
          <button aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"} onClick={() => studio?.window.maximize()} className="focus-ring grid h-7 w-8 place-items-center rounded-md text-dim transition-colors hover:bg-hover hover:text-ink">
            {maximized ? <Copy className="h-[15px] w-[15px]" strokeWidth={2} /> : <Square className="h-[14px] w-[14px]" strokeWidth={2} />}
          </button>
          <button aria-label="Close" title="Close" onClick={() => studio?.window.close()} className="focus-ring grid h-7 w-8 place-items-center rounded-md text-dim transition-colors hover:bg-rec hover:text-white">
            <X className="h-[17px] w-[17px]" strokeWidth={2} />
          </button>
        </div>
      </div>
    </header>
  );
}

function ProfileMenu() {
  const { names, active } = useProfiles();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open]);

  return (
    <div ref={ref} className="no-drag relative ml-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-[12px] font-500 text-muted transition-colors hover:bg-hover hover:text-ink"
      >
        <Monitor className="h-3.5 w-3.5 text-dim" strokeWidth={2} />
        Profile: {active}
        <ChevronDown className="h-3.5 w-3.5 text-dim" strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-56 rounded-lg border border-line bg-panel/95 p-1 shadow-[var(--shadow-pop)] backdrop-blur">
          <div className="px-2 py-1 text-[10px] font-600 uppercase tracking-wider text-dim">Profiles</div>
          {names.map((n) => (
            <div key={n} className="group flex items-center">
              <button
                onClick={() => {
                  switchProfile(n);
                  setOpen(false);
                }}
                className={cx(
                  "focus-ring flex flex-1 items-center justify-between rounded-md px-2 py-1.5 text-[12.5px] transition-colors",
                  n === active ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-ink"
                )}
              >
                <span className="truncate">{n}</span>
                {n === active && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
              </button>
              {names.length > 1 && (
                <button
                  onClick={() => deleteProfile(n)}
                  aria-label={`Delete ${n}`}
                  className="focus-ring ml-0.5 grid h-7 w-7 place-items-center rounded-md text-dim opacity-0 transition hover:text-rec group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}
            </div>
          ))}
          <div className="mt-1 border-t border-line/60 pt-1">
            {adding ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createProfile(name);
                  setName("");
                  setAdding(false);
                  setOpen(false);
                }}
                className="flex items-center gap-1 px-1"
              >
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Profile name"
                  className="focus-ring h-7 min-w-0 flex-1 rounded-md border border-line bg-panel2 px-2 text-[12px] text-ink"
                />
                <button type="submit" className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-[var(--on-accent)]">
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              </form>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-ink"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.2} /> New profile
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
