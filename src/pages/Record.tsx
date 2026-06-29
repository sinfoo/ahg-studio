import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  Check,
  Layers as LayersIcon,
  Mic,
  MicOff,
  MonitorPlay,
  Pause,
  Plus,
  Scissors,
  Sparkles,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AddSourceModal } from "../components/AddSourceModal";
import { LayersPanel } from "../components/LayersPanel";
import { PreviewStage } from "../components/PreviewStage";
import { Btn, Dock, EdgeResizers, IconBtn, ResizeHandle, Select, Slider, Toggle } from "../components/ui";
import { useCaptureCtx } from "../hooks/CaptureContext";
import { type FileRef } from "../lib/bridge";
import { clamp, cx } from "../lib/format";
import { runOptimize, useOptimize } from "../store/optimize";
import { getSettings, setSettings, useSettings } from "../store/settings";
import type { SourceType } from "../hooks/useCapture";

const FPS_OPTS = [30, 60, 120, 144] as const;

export function Record({ onOptimizeLast, active = true }: { onOptimizeLast: (ref: FileRef) => void; active?: boolean }) {
  const settings = useSettings();
  const cap = useCaptureCtx();
  const opt = useOptimize();
  const [layout, setLayout] = useState(() => {
    const def = { rightW: 306, bottomH: 244, capW: 300, ctrlW: 300 };
    try {
      return { ...def, ...JSON.parse(localStorage.getItem("ahg.rec.layout.v1") || "{}") };
    } catch {
      return def;
    }
  });
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem("ahg.rec.layout.v1", JSON.stringify(layout));
      } catch {
        /* noop */
      }
    }, 250);
    return () => clearTimeout(id);
  }, [layout]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<SourceType | undefined>(undefined);
  const [devs, setDevs] = useState<MediaDeviceInfo[]>([]);
  const monitorRef = useRef<HTMLAudioElement | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const refresh = () => navigator.mediaDevices?.enumerateDevices().then(setDevs).catch(() => {});
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
  }, [settings.micEnabled]);

  const inputs = devs.filter((d) => d.kind === "audioinput");
  const deviceOpts = (list: MediaDeviceInfo[], fallback: string) =>
    [{ label: fallback, value: "" }, ...list.map((d, i) => ({ label: d.label || `Device ${i + 1}`, value: d.deviceId }))];

  function openAdd(type?: SourceType) {
    setAddType(type);
    setAddOpen(true);
  }

  // Live monitoring: route the mixed audio to the chosen output device.
  useEffect(() => {
    const el = monitorRef.current;
    if (!el) return;
    if (!settings.monitorEnabled) {
      el.srcObject = null;
      return;
    }
    const stream = cap.getMonitorStream();
    el.srcObject = stream;
    if (stream) {
      el.volume = clamp(settings.monitorVolume, 0, 1);
      const sink = (el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
      if (sink && settings.monitorDeviceId) sink.call(el, settings.monitorDeviceId).catch(() => {});
      el.play().catch(() => {});
    }
  }, [settings.monitorEnabled, settings.monitorDeviceId, settings.monitorVolume, cap.audioVersion, cap.getMonitorStream]);

  // Apply the monitor output volume live to the hidden <audio> element. The
  // element's .volume is clamped to 0..1 by the platform, so the slider is 0..100%.
  useEffect(() => {
    const el = monitorRef.current;
    if (el) el.volume = clamp(settings.monitorVolume, 0, 1);
  }, [settings.monitorVolume]);

  function handleStartStop() {
    if (cap.recording) {
      cap.stop();
      return;
    }
    const c = settings.countdownSec;
    if (c > 0) {
      let n = c;
      setCountdown(n);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = setInterval(() => {
        n -= 1;
        if (n <= 0) {
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
          setCountdown(null);
          cap.start();
        } else setCountdown(n);
      }, 1000);
    } else cap.start();
  }

  // Clear a running countdown interval on unmount so it can't fire (and call
  // cap.start) after the page is gone.
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, []);

  function optimizeLast() {
    const last = cap.last.current;
    if (!last?.path) {
      onOptimizeLast(last ?? { name: "Last recording" });
      return;
    }
    const s = getSettings();
    runOptimize({ input: last.path, codec: s.codec, quality: s.quality, scale: s.scale, preset: s.preset, format: s.optFormat }, last.name);
  }

  return (
    <div className="flex h-full flex-col p-3">
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1">
          <PreviewStage cap={cap} />
          {countdown !== null && (
            <div className="absolute inset-0 z-10 grid place-items-center rounded-lg bg-black/55 backdrop-blur-sm">
              <span className="font-mono text-[88px] font-700 text-white tnum drop-shadow-[0_0_30px_var(--accent)]">{countdown}</span>
            </div>
          )}
          {/* Invisible border detectors on the preview — drag the right edge to
              size the mixer/performance column, the bottom edge to size the
              sources/controls row, like pro editors. */}
          <EdgeResizers
            right={{ value: layout.rightW, min: 250, max: 460, snap: [306], onChange: (v) => setLayout((l: typeof layout) => ({ ...l, rightW: v })), onReset: () => setLayout((l: typeof layout) => ({ ...l, rightW: 306 })) }}
            bottom={{ value: layout.bottomH, min: 170, max: 460, snap: [244], onChange: (v) => setLayout((l: typeof layout) => ({ ...l, bottomH: v })), onReset: () => setLayout((l: typeof layout) => ({ ...l, bottomH: 244 })) }}
          />
        </div>

        <ResizeHandle axis="x" onReset={() => setLayout((l: typeof layout) => ({ ...l, rightW: 306 }))} onDelta={(dx) => setLayout((l: typeof layout) => ({ ...l, rightW: clamp(l.rightW - dx, 250, 460) }))} />

        <div style={{ width: layout.rightW }} className="flex min-h-0 shrink-0 flex-col gap-3">
          <Dock title="Audio Mixer" icon={Volume2} className="min-h-0 flex-1">
            <div className="space-y-2">
              {/* Channel strips you mix — each carries its own volume under its meter */}
              <MixChannel name="System Audio" device={settings.systemAudio ? "Desktop loopback" : "Off"} icon={Volume2} levelsRef={cap.levelsRef} channel="desktop" live={active} muted={!settings.systemAudio} onMute={() => setSettings({ systemAudio: !settings.systemAudio })} volume={settings.desktopVolume} onVolume={(v) => setSettings({ desktopVolume: v })} />
              <MixChannel name="Microphone" device={settings.micEnabled ? "Live input" : "Off"} icon={Mic} levelsRef={cap.levelsRef} channel="mic" live={active} muted={!settings.micEnabled} onMute={() => setSettings({ micEnabled: !settings.micEnabled })} volume={settings.micVolume} onVolume={(v) => setSettings({ micVolume: v })} />
              {settings.micEnabled && (
                <Select value={settings.micDeviceId} onChange={(v) => setSettings({ micDeviceId: v })} options={deviceOpts(inputs, "System default mic")} />
              )}
            </div>
          </Dock>

          <Dock title="Performance" icon={MonitorPlay} className="shrink-0">
            <div className="space-y-2.5">
              <PerfRow label="CPU" value={`${cap.stats.cpu}%`} pct={cap.stats.cpu / 100} />
              <PerfRow label="Memory" value={`${cap.stats.memMb} MB`} pct={cap.stats.memMb / 1200} />
              <PerfRow label="Capture FPS" value={`${cap.stats.fps || settings.fps} / ${settings.fps}`} pct={(cap.stats.fps || settings.fps) / settings.fps} tone="good" />
              <PerfRow label="Bitrate" value={cap.recording ? `${cap.stats.bitrate} Mb/s` : "—"} pct={cap.stats.bitrate / 30} />
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[12px] text-muted">Canvas</span>
                <span className="font-mono text-[12px] font-500 text-ink tnum">{cap.CW}×{cap.CH}</span>
              </div>
            </div>
          </Dock>
        </div>
      </div>

      <ResizeHandle axis="y" onReset={() => setLayout((l: typeof layout) => ({ ...l, bottomH: 244 }))} onDelta={(dy) => setLayout((l: typeof layout) => ({ ...l, bottomH: clamp(l.bottomH - dy, 170, 460) }))} />

      <div style={{ height: layout.bottomH }} className="flex shrink-0">
        <div className="min-w-0 flex-1">
          <Dock title="Sources & Layers" icon={LayersIcon} action={<IconBtn icon={Plus} label="Add source" onClick={() => openAdd()} />} className="h-full" bodyClass="p-2.5">
            <LayersPanel cap={cap} onAddSource={openAdd} />
          </Dock>
        </div>

        <ResizeHandle axis="x" onReset={() => setLayout((l: typeof layout) => ({ ...l, capW: 300 }))} onDelta={(dx) => setLayout((l: typeof layout) => ({ ...l, capW: clamp(l.capW - dx, 220, 520) }))} />

        <div style={{ width: layout.capW }} className="min-w-0 shrink-0">
          <Dock title="Capture" icon={Sparkles} className="h-full" bodyClass="p-3 overflow-auto">
          <div className="space-y-3">
            <div>
              <SectionLabel>Frame rate</SectionLabel>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                {FPS_OPTS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setSettings({ fps: f })}
                    className={cx("focus-ring flex flex-col items-center rounded-lg border py-1.5 transition-colors", settings.fps === f ? "border-transparent bg-accent text-[var(--on-accent)]" : "border-line bg-panel2 text-muted hover:bg-hover hover:text-ink")}
                  >
                    <span className="font-mono text-[13px] font-700 tnum">{f}</span>
                    <span className="text-[8.5px] font-600 uppercase tracking-wide opacity-70">fps</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-line/60 pt-3">
              <SectionLabel>Audio sources</SectionLabel>
              <div className="mt-1.5 space-y-1.5">
                <ToggleRow icon={Volume2} label="System audio" checked={settings.systemAudio} onChange={(v) => setSettings({ systemAudio: v })} />
                <ToggleRow icon={Mic} label="Microphone" checked={settings.micEnabled} onChange={(v) => setSettings({ micEnabled: v })} />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-line bg-panel2 px-2.5 py-2">
              <span className="text-[11px] font-600 uppercase tracking-wide text-dim">Canvas</span>
              <span className="font-mono text-[12px] font-600 text-ink tnum">{cap.CW}×{cap.CH}</span>
            </div>

            <Btn variant="subtle" icon={Plus} full onClick={() => openAdd()}>
              Add source
            </Btn>
          </div>
          </Dock>
        </div>

        <ResizeHandle axis="x" onReset={() => setLayout((l: typeof layout) => ({ ...l, ctrlW: 300 }))} onDelta={(dx) => setLayout((l: typeof layout) => ({ ...l, ctrlW: clamp(l.ctrlW - dx, 220, 520) }))} />

        <div style={{ width: layout.ctrlW }} className="min-w-0 shrink-0">
          <Dock title="Controls" className="h-full">
            <div className="flex h-full flex-col">
            <RecordButton recording={cap.recording} disabled={(!cap.previewing && !cap.recording) || countdown !== null} countdown={countdown} onClick={handleStartStop} />

            {/* live status — always reserves a line so the layout never jumps */}
            <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-line/70 bg-panel2 px-2.5 py-1.5">
              <span className={cx("h-2 w-2 shrink-0 rounded-full", cap.error ? "bg-rec" : cap.recording ? "bg-rec rec-dot" : cap.previewing ? "bg-good" : "bg-dim")} />
              <span className="truncate text-[12px] text-muted">{cap.error ?? cap.status ?? (cap.recording ? "Recording" : cap.previewing ? "Ready to record" : "No sources")}</span>
            </div>

            <div className="mt-3">
              <SectionLabel>Quick actions</SectionLabel>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                <Btn variant="subtle" icon={Pause} disabled={!cap.recording} onClick={cap.pause}>
                  {cap.paused ? "Resume" : "Pause"}
                </Btn>
                <Btn variant="subtle" icon={Camera} disabled={!cap.previewing} onClick={cap.screenshot}>
                  Shot
                </Btn>
                {settings.replayEnabled ? (
                  <Btn variant="subtle" icon={Sparkles} disabled={!cap.replayActive} onClick={cap.saveReplay}>
                    Replay
                  </Btn>
                ) : (
                  <Btn variant="subtle" icon={Scissors} disabled={!cap.recording}>
                    Split
                  </Btn>
                )}
              </div>
            </div>

            <div className="mt-auto pt-3">
              <OptimizeLastButton opt={opt} onOptimize={optimizeLast} />
            </div>
            </div>
          </Dock>
        </div>
      </div>

      <AnimatePresence>{addOpen && <AddSourceModal initialType={addType} onClose={() => setAddOpen(false)} onAdd={(spec) => cap.addSource(spec)} />}</AnimatePresence>
      {/* hidden element used to monitor the live mix on the chosen output device */}
      <audio ref={monitorRef} className="hidden" />
    </div>
  );
}

function dbLabel(level: number) {
  if (level <= 0.001) return "-∞";
  return `${Math.max(-60, 20 * Math.log10(level)).toFixed(0)}`;
}

function MixChannel({ name, device, icon: Icon, levelsRef, channel, live = true, muted, onMute, volume, onVolume, volMax = 1.5 }: { name: string; device: string; icon: typeof Volume2; levelsRef: React.MutableRefObject<{ desktop: number; mic: number }>; channel: "desktop" | "mic"; live?: boolean; muted: boolean; onMute: () => void; volume?: number; onVolume?: (v: number) => void; volMax?: number }) {
  const barRef = useRef<HTMLDivElement>(null);
  const dbRef = useRef<HTMLSpanElement>(null);
  // Read the shared levels ref in our OWN rAF and paint the bar/dB via direct DOM
  // — the meter never triggers a React re-render of the Record page. The loop is
  // gated on `live` so it stops entirely when the Record tab isn't visible.
  useEffect(() => {
    if (muted || !live) {
      if (barRef.current) barRef.current.style.width = "0%";
      if (dbRef.current) dbRef.current.textContent = muted ? "muted" : "-∞ dB";
      return;
    }
    let raf = 0;
    let lastPct = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = levelsRef.current[channel] || 0;
      const pct = Math.round(clamp(v * 100, 0, 100));
      if (pct !== lastPct) {
        lastPct = pct;
        if (barRef.current) barRef.current.style.width = `${pct}%`;
        if (dbRef.current) {
          dbRef.current.textContent = `${dbLabel(v)} dB`;
          dbRef.current.style.color = v > 0.9 ? "var(--rec)" : v > 0.6 ? "var(--warn)" : "var(--muted)";
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [muted, live, channel, levelsRef]);
  return (
    <div className={cx("rounded-lg border px-2.5 py-2 transition-colors", muted ? "border-line/50 bg-panel2/40" : "border-line bg-panel2")}>
      <div className="flex items-center gap-2">
        <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors", muted ? "bg-sunken text-dim" : "bg-accent-soft text-accent")}>
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-600 text-ink">{name}</div>
          <div className="truncate text-[10.5px] text-dim">{device}</div>
        </div>
        <span ref={dbRef} className="shrink-0 font-mono text-[11px] tnum" style={{ color: muted ? "var(--dim)" : "var(--muted)" }}>{muted ? "muted" : "-∞ dB"}</span>
        <button onClick={onMute} aria-label="Toggle mute" className={cx("focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors hover:bg-hover", muted ? "text-rec" : "text-dim hover:text-ink")}>
          {muted ? <MicOff className="h-4 w-4" strokeWidth={2} /> : <Volume2 className="h-4 w-4" strokeWidth={2} />}
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
        <div ref={barRef} className="h-full rounded-full" style={{ width: "0%", background: "linear-gradient(to right, var(--good), var(--warn) 72%, var(--rec))", transition: "width 60ms linear" }} />
      </div>
      {/* volume — sits right under this channel's dB meter */}
      {onVolume && (
        <div className="mt-2 flex items-center gap-2">
          <Slider value={volume ?? 1} min={0} max={volMax} step={0.01} onChange={onVolume} />
          <span className="w-9 shrink-0 text-right font-mono text-[10.5px] font-500 text-muted tnum">{Math.round((volume ?? 1) * 100)}%</span>
        </div>
      )}
    </div>
  );
}

function PerfRow({ label, value, pct, tone = "accent" }: { label: string; value: string; pct: number; tone?: "accent" | "good" | "warn" }) {
  const color = tone === "good" ? "var(--good)" : tone === "warn" ? "var(--warn)" : "var(--accent)";
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted">{label}</span>
        <span className="font-mono text-[12px] font-500 text-ink tnum">{value}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-sunken">
        <div className="h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${clamp(pct * 100, 0, 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function RecordButton({ recording, disabled, countdown, onClick }: { recording: boolean; disabled: boolean; countdown: number | null; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.975 }}
      animate={{ backgroundColor: recording ? "var(--rec)" : "var(--accent)" }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="focus-ring relative flex h-11 w-full items-center justify-center gap-2.5 overflow-hidden rounded-lg text-[14px] font-600 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ color: recording ? "#fff" : "var(--on-accent)" }}
    >
      <motion.span aria-hidden className="block h-3 w-3" animate={{ borderRadius: recording ? 3 : 999 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} style={{ background: recording ? "#fff" : "var(--on-accent)" }} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={recording ? "stop" : countdown !== null ? "cd" : "start"} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }} transition={{ duration: 0.16 }}>
          {recording ? "Stop Recording" : countdown !== null ? `Starting in ${countdown}…` : "Start Recording"}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

function OptimizeLastButton({ opt, onOptimize }: { opt: ReturnType<typeof useOptimize>; onOptimize: () => void }) {
  const running = opt.running;
  const done = opt.done && !!opt.output;
  return (
    <button
      onClick={() => (done ? window.studio?.reveal(opt.output!) : running ? undefined : onOptimize())}
      disabled={running}
      className={cx("focus-ring relative flex h-10 w-full items-center justify-center gap-2 overflow-hidden rounded-lg text-[13px] font-600 transition-colors", done ? "bg-good text-[var(--on-accent)]" : "bg-accent-soft text-accent hover:brightness-110")}
    >
      {running && <span className="absolute inset-y-0 left-0 bg-accent/25 transition-[width] duration-200 ease-out" style={{ width: `${Math.max(6, opt.progress * 100)}%` }} />}
      <span className="relative z-10 flex items-center gap-2">
        {done ? (
          <>
            <Check className="h-4 w-4" strokeWidth={2.4} /> Done · Open location
          </>
        ) : running ? (
          <>
            <Sparkles className="h-4 w-4 animate-pulse" strokeWidth={2.2} /> Optimizing {Math.round(opt.progress * 100)}%
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" strokeWidth={2.2} /> Optimize last clip
          </>
        )}
      </span>
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-[10px] font-700 uppercase tracking-[0.14em] text-dim">{children}</div>;
}

function ToggleRow({ icon: Icon, label, checked, onChange }: { icon: typeof Volume2; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={cx("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors", checked ? "border-line bg-panel2" : "border-line/50 bg-panel2/40")}>
      <Icon className={cx("h-4 w-4 shrink-0", checked ? "text-accent" : "text-dim")} strokeWidth={2} />
      <span className="flex-1 text-[13px] font-500 text-ink">{label}</span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
