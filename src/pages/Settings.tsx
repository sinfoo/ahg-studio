import {
  Bug,
  Cpu,
  FolderOpen,
  Info,
  Keyboard,
  Lightbulb,
  Monitor,
  MonitorPlay,
  Mail,
  Music,
  Palette,
  Power,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import logo from "../assets/logo-256.png";
import { Btn, Field, Segmented, Select, Slider, Tag, Toggle } from "../components/ui";
import { studio } from "../lib/bridge";
import { cx } from "../lib/format";
import { setSettings, THEMES, useSettings, type Hotkeys as HK } from "../store/settings";

type Section =
  | "appearance"
  | "general"
  | "capture"
  | "replay"
  | "output"
  | "encoder"
  | "audio"
  | "hotkeys"
  | "about";

const SECTIONS: { id: Section; label: string; icon: LucideIcon; keywords: string }[] = [
  { id: "appearance", label: "Appearance", icon: Palette, keywords: "theme dark light midnight blue graphite aurora motion library view color" },
  { id: "general", label: "General", icon: Power, keywords: "startup windows boot tray minimize countdown autostart" },
  { id: "capture", label: "Capture", icon: MonitorPlay, keywords: "resolution fps frame rate bitrate format mp4 webm mkv system audio microphone cursor quality" },
  { id: "replay", label: "Instant Replay", icon: Timer, keywords: "instant replay buffer shadowplay nvidia hotkey seconds minutes" },
  { id: "output", label: "Output", icon: FolderOpen, keywords: "folder save location auto optimize directory path" },
  { id: "encoder", label: "Encoder", icon: Cpu, keywords: "codec h264 hevc av1 quality crf preset format gif mov resolution" },
  { id: "audio", label: "Audio", icon: Music, keywords: "microphone device output speakers sample rate channels stereo mono input" },
  { id: "hotkeys", label: "Hotkeys", icon: Keyboard, keywords: "shortcuts keys start stop pause screenshot replay global" },
  { id: "about", label: "About", icon: Info, keywords: "version safwen developer discord contact founder" },
];

function useDevices(kind: "audioinput" | "audiooutput") {
  const [list, setList] = useState<{ label: string; value: string }[]>([{ label: "System default", value: "" }]);
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devs) => {
        const items = devs
          .filter((d) => d.kind === kind)
          .map((d, i) => ({ label: d.label || `${kind === "audioinput" ? "Input" : "Output"} ${i + 1}`, value: d.deviceId }));
        setList([{ label: "System default", value: "" }, ...items]);
      })
      .catch(() => {});
  }, [kind]);
  return list;
}

export function Settings() {
  const [section, setSection] = useState<Section>("appearance");
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return SECTIONS;
    return SECTIONS.filter((s) => (s.label + " " + s.keywords).toLowerCase().includes(query));
  }, [q]);

  return (
    <div className="flex h-full">
      <aside className="flex w-[214px] shrink-0 flex-col border-r border-line bg-base p-3">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search settings"
            className="focus-ring h-8 w-full rounded-lg border border-line bg-panel pl-8 pr-2 text-[12.5px] text-ink placeholder:text-dim"
          />
        </div>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-auto">
          {filtered.map(({ id, label, icon: Icon }) => {
            const on = id === section;
            return (
              <motion.button
                key={id}
                onClick={() => setSection(id)}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className={cx(
                  "focus-ring relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
                  on ? "font-500 text-accent" : "text-muted hover:bg-hover hover:text-ink"
                )}
              >
                {on && <span className="absolute inset-0 -z-0 rounded-lg bg-accent-soft animate-[fadein_.16s_ease]" />}
                <Icon className="relative z-10 h-4 w-4" strokeWidth={2} />
                <span className="relative z-10">{label}</span>
              </motion.button>
            );
          })}
          {filtered.length === 0 && <p className="px-2.5 py-3 text-[12px] text-dim">No settings match.</p>}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[660px] px-7 py-7">
          {section === "appearance" && <Appearance />}
          {section === "general" && <General />}
          {section === "capture" && <Capture />}
          {section === "replay" && <Replay />}
          {section === "output" && <Output />}
          {section === "encoder" && <Encoder />}
          {section === "audio" && <Audio />}
          {section === "hotkeys" && <HotkeysSection />}
          {section === "about" && <About />}
        </div>
      </div>
    </div>
  );
}

function Head({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-2">
      <h2 className="text-[17px] font-700 tracking-tight text-ink">{title}</h2>
      <p className="mt-0.5 text-[13px] text-muted">{desc}</p>
    </div>
  );
}

function Appearance() {
  const s = useSettings();
  return (
    <>
      <Head title="Appearance" desc="Make it yours. Changes apply instantly." />
      <Field label="Theme" stacked hint="Pick a palette. Dark for dim rooms, light for bright offices.">
        <div className="grid grid-cols-5 gap-2">
          {THEMES.map((t) => {
            const on = s.theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSettings({ theme: t.id })}
                className={cx(
                  "focus-ring group rounded-xl border p-1.5 transition-colors",
                  on ? "border-accent ring-1 ring-accent" : "border-line hover:border-line-strong"
                )}
              >
                <span className="block h-10 w-full rounded-lg" style={{ background: t.swatch }} />
                <span className={cx("mt-1 block truncate text-center text-[10px]", on ? "text-accent" : "text-muted")}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Reduced motion" hint="Calms animations and freezes the live meters.">
        <Toggle checked={s.reducedMotion} onChange={(v) => setSettings({ reducedMotion: v })} label="Reduced motion" />
      </Field>
      <Field label="Default library view" hint="How recordings are shown in the Library.">
        <Segmented
          value={s.libraryView}
          onChange={(v) => setSettings({ libraryView: v })}
          options={[
            { label: "Grid", value: "grid" },
            { label: "List", value: "list" },
          ]}
        />
      </Field>
    </>
  );
}

function General() {
  const s = useSettings();
  return (
    <>
      <Head title="General" desc="How AHG Studio behaves on your system." />
      <Field label="Start with Windows" hint="Launch automatically when you sign in.">
        <Toggle
          checked={s.startWithWindows}
          onChange={(v) => setSettings({ startWithWindows: v, ...(v ? {} : { startMinimized: false }) })}
          label="Start with Windows"
        />
      </Field>
      <Field
        label="Start minimized"
        hint={s.startWithWindows ? "Open quietly in the background / tray on auto-launch." : "Enable “Start with Windows” first."}
      >
        <Toggle
          checked={s.startMinimized && s.startWithWindows}
          onChange={(v) => setSettings({ startMinimized: v })}
          label="Start minimized"
          disabled={!s.startWithWindows}
        />
      </Field>
      <Field label="Minimize to tray" hint="Keep running in the system tray when minimized.">
        <Toggle checked={s.minimizeToTray} onChange={(v) => setSettings({ minimizeToTray: v })} label="Minimize to tray" />
      </Field>
      <Field label="Countdown before recording" stacked hint="A 3 or 5 second countdown so you can get ready.">
        <Segmented
          value={s.countdownSec}
          onChange={(v) => setSettings({ countdownSec: v })}
          options={[
            { label: "Off", value: 0 },
            { label: "3s", value: 3 },
            { label: "5s", value: 5 },
          ]}
        />
      </Field>
    </>
  );
}

function Capture() {
  const s = useSettings();
  return (
    <>
      <Head title="Capture" desc="Resolution, frame rate, recording format and audio." />
      <Field label="Resolution">
        <div className="w-52">
          <Select
            value={s.resolution}
            onChange={(v) => setSettings({ resolution: v })}
            options={[
              { label: "Native (full screen)", value: "native" },
              { label: "2160p (4K)", value: "2160" },
              { label: "1440p (2K)", value: "1440" },
              { label: "1080p", value: "1080" },
              { label: "720p", value: "720" },
            ]}
          />
        </div>
      </Field>
      <Field label="Frame rate" stacked hint="Higher is smoother. 120–144 suits fast gameplay (needs a strong GPU).">
        <Segmented
          value={s.fps}
          onChange={(v) => setSettings({ fps: v })}
          options={[30, 60, 120, 144].map((f) => ({ label: String(f), value: f as 30 | 60 | 120 | 144 }))}
        />
      </Field>
      <Field label="Recording format" stacked hint="MP4 uses hardware encoding (smoother, smaller). MKV is crash-safe. WebM is universal.">
        <Segmented
          value={s.recordFormat}
          onChange={(v) => setSettings({ recordFormat: v })}
          options={[
            { label: "MP4", value: "mp4" },
            { label: "MKV", value: "mkv" },
            { label: "WebM", value: "webm" },
          ]}
        />
      </Field>
      <Field
        label="Bitrate"
        stacked
        hint={`Higher is sharper and larger. ≈ ${Math.round((s.recordBitrateMbps * 60) / 8)} MB per minute at this setting.`}
      >
        <div className="flex items-center gap-3">
          <Slider value={s.recordBitrateMbps} min={4} max={120} step={2} onChange={(v) => setSettings({ recordBitrateMbps: v })} />
          <span className="w-28 text-right font-mono text-[13px] font-500 text-ink tnum">
            {s.recordBitrateMbps} Mb/s
            <span className="ml-1 text-dim">· {Math.round((s.recordBitrateMbps * 60) / 8)} MB/min</span>
          </span>
        </div>
      </Field>
      <Field label="System audio" hint="Record desktop / game sound.">
        <Toggle checked={s.systemAudio} onChange={(v) => setSettings({ systemAudio: v })} label="System audio" />
      </Field>
      <Field label="Microphone" hint="Mix your voice into the recording.">
        <Toggle checked={s.micEnabled} onChange={(v) => setSettings({ micEnabled: v })} label="Microphone" />
      </Field>
      <Field label="Capture cursor" hint="Show the mouse pointer in recordings.">
        <Toggle checked={s.showCursor} onChange={(v) => setSettings({ showCursor: v })} label="Capture cursor" />
      </Field>
    </>
  );
}

function Replay() {
  const s = useSettings();
  return (
    <>
      <Head title="Instant Replay" desc="Always-on buffer like NVIDIA ShadowPlay. Save the last moments with a hotkey." />
      <Field label="Enable instant replay" hint="Continuously buffers your screen while previewing, no file written until you save.">
        <Toggle checked={s.replayEnabled} onChange={(v) => setSettings({ replayEnabled: v })} label="Instant replay" />
      </Field>
      <Field label="Replay length" stacked hint="How much is kept in the buffer (up to 10 minutes).">
        <Segmented
          value={s.replaySeconds}
          onChange={(v) => setSettings({ replaySeconds: v })}
          options={[15, 30, 60, 120, 180, 300, 600].map((n) => ({ label: n < 60 ? `${n}s` : `${n / 60}m`, value: n }))}
        />
      </Field>
      <Field label="Save replay hotkey" hint="Press this anytime to save the buffered clip.">
        <HotkeyInput value={s.hotkeys.saveReplay} onChange={(a) => setSettings({ hotkeys: { ...s.hotkeys, saveReplay: a } })} />
      </Field>
    </>
  );
}

function Output() {
  const s = useSettings();
  const [folder, setFolder] = useState("");
  useEffect(() => {
    studio?.recordingsDir().then(setFolder);
  }, [s.outputFolder]);
  return (
    <>
      <Head title="Output" desc="Choose separate folders for videos and screenshots. The Library shows everything together." />
      <Field label="Video folder" hint={s.outputFolder || folder || "Videos/AHG Studio"} stacked>
        <div className="flex gap-2">
          <Btn
            variant="subtle"
            icon={FolderOpen}
            onClick={async () => {
              const p = await studio?.pickFolder();
              if (p) setSettings({ outputFolder: p });
            }}
          >
            Change folder
          </Btn>
          <Btn variant="ghost" onClick={() => studio?.openRecordingsDir()}>
            Open
          </Btn>
          {s.outputFolder && (
            <Btn variant="ghost" onClick={() => setSettings({ outputFolder: "" })}>
              Reset
            </Btn>
          )}
        </div>
      </Field>
      <Field label="Screenshot folder" hint={s.screenshotFolder || "Same as video folder"} stacked>
        <div className="flex gap-2">
          <Btn
            variant="subtle"
            icon={FolderOpen}
            onClick={async () => {
              const p = await studio?.pickFolder();
              if (p) setSettings({ screenshotFolder: p });
            }}
          >
            Change folder
          </Btn>
          {s.screenshotFolder && (
            <Btn variant="ghost" onClick={() => setSettings({ screenshotFolder: "" })}>
              Reset
            </Btn>
          )}
        </div>
      </Field>
      <Field label="Optimize after recording" hint="Auto-compress each clip the moment you stop.">
        <Toggle checked={s.autoOptimize} onChange={(v) => setSettings({ autoOptimize: v })} label="Optimize after recording" />
      </Field>
    </>
  );
}

function Encoder() {
  const s = useSettings();
  return (
    <>
      <Head title="Encoder" desc="Defaults used by Optimize and auto-optimize." />
      <Field label="Codec">
        <div className="w-52">
          <Select
            value={s.codec}
            onChange={(v) => setSettings({ codec: v })}
            options={[
              { label: "H.264 — most compatible", value: "h264" },
              { label: "HEVC (H.265) — smaller", value: "hevc" },
              { label: "AV1 — smallest", value: "av1" },
            ]}
          />
        </div>
      </Field>
      <Field label="Default format">
        <div className="w-40">
          <Select
            value={s.optFormat}
            onChange={(v) => setSettings({ optFormat: v })}
            options={[
              { label: "MP4", value: "mp4" },
              { label: "MKV", value: "mkv" },
              { label: "MOV", value: "mov" },
              { label: "WebM", value: "webm" },
              { label: "GIF", value: "gif" },
            ]}
          />
        </div>
      </Field>
      <Field label="Quality" stacked hint="Higher keeps more detail. 60+ is visually lossless.">
        <div className="flex items-center gap-3">
          <Slider value={s.quality} min={20} max={100} onChange={(v) => setSettings({ quality: v })} />
          <span className="w-9 text-right font-mono text-[13px] font-500 text-ink tnum">{s.quality}</span>
        </div>
      </Field>
      <Field label="Speed" stacked hint="Slower presets compress harder at the same quality.">
        <Segmented
          value={s.preset}
          onChange={(v) => setSettings({ preset: v })}
          options={[
            { label: "Fast", value: "fast" },
            { label: "Balanced", value: "balanced" },
            { label: "Max", value: "max" },
          ]}
        />
      </Field>
      <Field label="Output resolution">
        <div className="w-44">
          <Select
            value={s.scale}
            onChange={(v) => setSettings({ scale: v })}
            options={[
              { label: "Same as source", value: "same" },
              { label: "1080p", value: "1080" },
              { label: "720p", value: "720" },
            ]}
          />
        </div>
      </Field>
    </>
  );
}

function Audio() {
  const s = useSettings();
  const mics = useDevices("audioinput");
  const outs = useDevices("audiooutput");
  return (
    <>
      <Head title="Audio" desc="Devices and audio quality." />
      <Field label="Microphone device">
        <div className="w-60">
          <Select value={s.micDeviceId} onChange={(v) => setSettings({ micDeviceId: v })} options={mics} />
        </div>
      </Field>
      <Field label="Output device" hint="Speakers used for monitoring playback.">
        <div className="w-60">
          <Select value={s.monitorDeviceId} onChange={(v) => setSettings({ monitorDeviceId: v })} options={outs} />
        </div>
      </Field>
      <Field label="Sample rate">
        <div className="w-40">
          <Select
            value={String(s.sampleRate)}
            onChange={(v) => setSettings({ sampleRate: Number(v) as 48 | 44 })}
            options={[
              { label: "48 kHz", value: "48" },
              { label: "44.1 kHz", value: "44" },
            ]}
          />
        </div>
      </Field>
      <Field label="Channels">
        <div className="w-40">
          <Select
            value={s.channels}
            onChange={(v) => setSettings({ channels: v })}
            options={[
              { label: "Stereo", value: "stereo" },
              { label: "Mono", value: "mono" },
            ]}
          />
        </div>
      </Field>
    </>
  );
}

const HK_ROWS: { key: keyof HK; label: string; hint: string }[] = [
  { key: "startStop", label: "Start / stop recording", hint: "Toggle recording from anywhere." },
  { key: "pauseResume", label: "Pause / resume", hint: "Pause without ending the recording." },
  { key: "saveReplay", label: "Save instant replay", hint: "Save the last buffered moments." },
  { key: "screenshot", label: "Screenshot", hint: "Capture the current frame as PNG." },
  { key: "muteMic", label: "Mute / unmute microphone", hint: "Toggle the mic in the recording." },
  { key: "muteDesktop", label: "Mute / unmute system audio", hint: "Toggle desktop sound." },
  { key: "toggleReplay", label: "Toggle instant replay", hint: "Turn the replay buffer on/off." },
  { key: "optimizeLast", label: "Optimize last clip", hint: "Compress the latest recording." },
  { key: "nextSource", label: "Next source", hint: "Switch preview to the next source." },
  { key: "prevSource", label: "Previous source", hint: "Switch preview to the previous source." },
  { key: "toggleCursor", label: "Toggle cursor capture", hint: "Show/hide the mouse pointer." },
  { key: "cycleTheme", label: "Cycle theme", hint: "Switch to the next theme." },
  { key: "openFolder", label: "Open recordings folder", hint: "Reveal your recordings." },
  { key: "showApp", label: "Show AHG Studio", hint: "Bring the window to the front." },
];

function HotkeysSection() {
  const s = useSettings();
  return (
    <>
      <Head title="Hotkeys" desc="Global shortcuts that work even while a game is focused. Click a shortcut and press your keys." />
      {HK_ROWS.map((r) => (
        <Field key={r.key} label={r.label} hint={r.hint}>
          <HotkeyInput value={s.hotkeys[r.key]} onChange={(a) => setSettings({ hotkeys: { ...s.hotkeys, [r.key]: a } })} />
        </Field>
      ))}
    </>
  );
}

function prettyAccel(a: string) {
  return a.replace("CommandOrControl", "Ctrl").split("+").join(" + ");
}
const KEYMAP: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  " ": "Space",
  Escape: "Esc",
};
type KeyLike = { key: string; code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };
function accelFromEvent(e: KeyLike): string | null {
  if (["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "Dead"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  // Derive the base key from e.code so it's layout-independent (Alt/Shift can
  // change e.key into accented chars on some layouts).
  let key = "";
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad[0-9]$/.test(e.code)) key = "num" + e.code.slice(6);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else key = KEYMAP[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (!key) return null;
  parts.push(key);
  return parts.join("+");
}

function HotkeyInput({ value, onChange }: { value: string; onChange: (a: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  // Capture via a window-level listener (capture phase) while recording — this
  // works for Alt/Shift/Super + F-keys even though those can steal focus from
  // the button, which is why the old button-focus capture failed for them.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        onChange("");
        setCapturing(false);
        return;
      }
      const a = accelFromEvent(e);
      if (a) {
        onChange(a);
        setCapturing(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, onChange]);
  return (
    <button
      onClick={() => setCapturing((c) => !c)}
      className={cx(
        "focus-ring h-9 min-w-[170px] rounded-lg border px-3 font-mono text-[12px] font-600 transition-colors",
        capturing ? "border-accent bg-accent-soft text-accent" : "border-line bg-panel2 text-ink hover:bg-hover"
      )}
    >
      {capturing ? "Press keys… (Esc cancel)" : value ? prettyAccel(value) : "Unset"}
    </button>
  );
}

function About() {
  const open = (url: string) => studio?.openExternal(url);
  return (
    <div className="py-2">
      <div className="flex items-center gap-4">
        <img src={logo} alt="AHG" className="h-20 w-20 rounded-2xl shadow-[var(--shadow-pop)]" />
        <div>
          <h2 className="text-[22px] font-700 tracking-tight text-ink">AHG Studio</h2>
          <p className="text-[12px] font-500 uppercase tracking-[0.28em] text-dim">Screen &amp; Optimize</p>
          <div className="mt-2 flex items-center gap-2">
            <Tag mono>v0.1.0</Tag>
            <Tag tone="good" mono>
              <Monitor className="h-3 w-3" /> Up to date
            </Tag>
          </div>
        </div>
      </div>

      <p className="mt-5 max-w-lg text-[13.5px] leading-relaxed text-muted">
        Record your screen at high frame rates with system audio, then shrink the result with bundled
        FFmpeg, no visible quality loss. Capture to compressed, in one premium tool.
      </p>

      <div className="mt-6 rounded-xl border border-line bg-panel p-5">
        <div className="text-[11px] font-600 uppercase tracking-wider text-dim">Made by</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-[18px] font-700 text-ink">Safwen</span>
          <span className="text-[13px] text-muted">· 20 y/o passionate developer</span>
        </div>
        <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-muted">
          Builder of the AHG suite. I craft fast, premium desktop tools for gamers and creators, and I
          care about software that feels as good as it looks. AHG Studio is part of that mission.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant="subtle" icon={Mail} onClick={() => open("mailto:sinfobibeni96@gmail.com")}>
            Contact
          </Btn>
          <Btn variant="ghost" icon={Bug} onClick={() => open("mailto:sinfobibeni96@gmail.com?subject=AHG%20Studio%20bug%20report%20(v0.1.0)&body=What%20happened%3A%0A%0ASteps%20to%20reproduce%3A%0A%0A")}>
            Report a bug
          </Btn>
          <Btn variant="ghost" icon={Lightbulb} onClick={() => open("mailto:sinfobibeni96@gmail.com?subject=AHG%20Studio%20feature%20request&body=I'd%20love%20to%20see%3A%0A%0A")}>
            Request a feature
          </Btn>
          <Btn variant="ghost" icon={FolderOpen} onClick={() => studio?.openRecordingsDir()}>
            Open recordings
          </Btn>
        </div>
      </div>

      <p className="mt-5 text-[11.5px] text-dim">
        Built with Electron, React &amp; FFmpeg. © {new Date().getFullYear()} AHG.
      </p>
    </div>
  );
}
