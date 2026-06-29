const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  session,
  dialog,
  shell,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn: _spawn } = require("child_process");

// Every child process we ever spawn is tracked here and auto-removed when it
// ends, so `before-quit` can guarantee NO ffmpeg/ffprobe survives the app —
// previously hung or in-flight jobs were left orphaned after exit. All spawn
// sites use this wrapper (it shadows the imported `spawn`).
const childProcs = new Set();
function spawn(...args) {
  const p = _spawn(...args);
  childProcs.add(p);
  const drop = () => childProcs.delete(p);
  p.once("close", drop);
  p.once("exit", drop);
  p.once("error", drop);
  return p;
}
function killAllChildren() {
  for (const p of childProcs) {
    try {
      p.kill("SIGKILL");
    } catch {}
  }
  childProcs.clear();
}

// Bounded concurrency gate. A project with many distinct sources fired a
// filmstrip + waveform (+ library thumb) PER source all at once — 2N+
// simultaneous ffmpeg decodes saturated the CPU and made the whole app lag.
// All light preview-image jobs now run through one gate (a few at a time).
function makeGate(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, res, rej } = queue.shift();
    Promise.resolve().then(fn).then(res, rej).finally(() => {
      active--;
      pump();
    });
  };
  return (fn) =>
    new Promise((res, rej) => {
      queue.push({ fn, res, rej });
      pump();
    });
}
const previewGate = makeGate(3);

// On-disk caches (thumbs/filmstrips/waveforms/proxies) are keyed by file+mtime
// and were never pruned — proxies especially (full 720p re-encodes) accumulated
// GBs across sessions. Prune each dir to a size cap on startup, evicting the
// least-recently-used files first.
function pruneCacheDir(dir, maxBytes) {
  try {
    if (!fs.existsSync(dir)) return;
    let files = fs.readdirSync(dir).map((name) => {
      const fp = path.join(dir, name);
      try {
        const st = fs.statSync(fp);
        return st.isFile() ? { fp, size: st.size, atime: st.atimeMs } : null;
      } catch {
        return null;
      }
    });
    files = files.filter(Boolean);
    let total = files.reduce((n, f) => n + f.size, 0);
    if (total <= maxBytes) return;
    files.sort((a, b) => a.atime - b.atime); // oldest-accessed first
    for (const f of files) {
      if (total <= maxBytes) break;
      try {
        fs.unlinkSync(f.fp);
        total -= f.size;
      } catch {}
    }
  } catch {}
}
function pruneCaches() {
  const ud = app.getPath("userData");
  pruneCacheDir(path.join(ud, "thumbs"), 80 * 1024 * 1024);
  pruneCacheDir(path.join(ud, "filmstrips"), 120 * 1024 * 1024);
  pruneCacheDir(path.join(ud, "waveforms"), 60 * 1024 * 1024);
  pruneCacheDir(path.join(ud, "proxies"), 1024 * 1024 * 1024);
}

// Spawn ffmpeg, resolve when it closes, and SIGKILL it if it hangs past
// `timeoutMs` — a hung decode used to pin the process and its awaiting handler
// forever (no orphan, no permanently-stuck Promise).
function ffmpegOnce(args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const fin = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    let p;
    try {
      p = spawn(ffmpegPath, args);
    } catch {
      return fin();
    }
    timer = setTimeout(() => {
      try {
        p.kill("SIGKILL");
      } catch {}
      fin();
    }, timeoutMs);
    p.on("close", fin);
    p.on("error", fin);
  });
}

// Active long-running ffmpeg jobs (so they can be cancelled from the UI).
let activeCompress = null;
let activeExport = null;
let cancelCompressReq = false;
let cancelExportReq = false;

const isDev = !app.isPackaged && process.env.AHG_DEV === "1";
const ICON_ICO = path.join(__dirname, "..", "build", "icon.ico");
const ICON_PNG = path.join(__dirname, "..", "build", "icon.png");
const APP_ICON = fs.existsSync(ICON_ICO) ? ICON_ICO : ICON_PNG;

/* ---- bundled ffmpeg / ffprobe (asar-unpacked in production) ---- */
function unpack(p) {
  return p ? p.replace("app.asar", "app.asar.unpacked") : p;
}
let ffmpegPath = "";
let ffprobePath = "";
try {
  ffmpegPath = unpack(require("ffmpeg-static"));
} catch {}
try {
  ffprobePath = unpack(require("ffprobe-static").path);
} catch {}

/* ---- hardware-accelerated encoders (NVENC / QSV / AMF / VideoToolbox) ----
   Detected by attempting a tiny throwaway encode per candidate — listing
   `-encoders` only proves ffmpeg was COMPILED with the encoder, not that the GPU
   is actually present and usable. The result is cached for the session. This is
   the single biggest Optimize speedup (often 3-10x vs CPU x264/x265). */
let hwEncoderCache = null;
let hwEncoderProbe = null;
const HW_CANDIDATES = {
  h264: ["h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox"],
  hevc: ["hevc_nvenc", "hevc_qsv", "hevc_amf", "hevc_videotoolbox"],
  av1: ["av1_nvenc", "av1_qsv", "av1_amf"],
};
const HW_VENDOR = { nvenc: "nvidia", qsv: "intel", amf: "amd", videotoolbox: "apple" };

function probeEncoder(enc) {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(false);
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    let p;
    try {
      p = spawn(ffmpegPath, [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=black:s=320x240:r=10:d=0.2",
        "-an", "-c:v", enc, "-f", "null", "-",
      ]);
    } catch {
      return done(false);
    }
    const kill = setTimeout(() => {
      try { p.kill("SIGKILL"); } catch {}
      done(false);
    }, 6000);
    p.on("error", () => { clearTimeout(kill); done(false); });
    p.on("close", (code) => { clearTimeout(kill); done(code === 0); });
  });
}

async function detectHwEncoders() {
  if (hwEncoderCache) return hwEncoderCache;
  if (hwEncoderProbe) return hwEncoderProbe;
  hwEncoderProbe = (async () => {
    const result = { h264: null, hevc: null, av1: null, vendor: null };
    for (const codec of Object.keys(HW_CANDIDATES)) {
      for (const enc of HW_CANDIDATES[codec]) {
        // eslint-disable-next-line no-await-in-loop
        if (await probeEncoder(enc)) {
          result[codec] = enc;
          if (!result.vendor) {
            const k = Object.keys(HW_VENDOR).find((v) => enc.includes(v));
            result.vendor = k ? HW_VENDOR[k] : null;
          }
          break;
        }
      }
    }
    hwEncoderCache = result;
    return result;
  })();
  return hwEncoderProbe;
}

// Build the encoder-specific quality args for a hardware encoder, mapping our CRF
// (~10 best .. 33 worst) onto each vendor's quantizer scale + a speed preset.
function hwQualityArgs(enc, crf, presetName) {
  const cq = Math.max(1, Math.min(51, crf));
  if (enc.includes("nvenc")) {
    const p = presetName === "fast" ? "p2" : presetName === "max" ? "p7" : "p4";
    return ["-rc", "vbr", "-cq", String(cq), "-b:v", "0", "-preset", p, "-tune", "hq"];
  }
  if (enc.includes("qsv")) {
    const p = presetName === "fast" ? "veryfast" : presetName === "max" ? "veryslow" : "medium";
    return ["-global_quality", String(cq), "-preset", p];
  }
  if (enc.includes("amf")) {
    const q = presetName === "fast" ? "speed" : presetName === "max" ? "quality" : "balanced";
    return ["-rc", "cqp", "-qp_i", String(cq), "-qp_p", String(cq), "-qp_b", String(cq), "-quality", q];
  }
  if (enc.includes("videotoolbox")) {
    // VideoToolbox has no CRF; map CRF→a 1..100 quality (higher = better).
    const q = Math.round(100 - ((cq - 10) / 41) * 70);
    return ["-q:v", String(Math.max(20, Math.min(100, q)))];
  }
  return ["-crf", String(crf)];
}

// After a few GPU context losses Chromium permanently BLOCKS 3D APIs (canvas /
// WebGL / accelerated video) for the page — that's the "preview goes blank and
// stays blank forever" bug. Disabling domain blocking lets the context rebuild.
try {
  app.disableDomainBlockingFor3DAPIs();
} catch {}

// Opt-in remote debugging so the renderer can be inspected/driven over CDP
// (profiling preview frame timing, heap, etc.). Launch with AHG_DEBUG=1.
if (process.env.AHG_DEBUG) {
  try {
    app.commandLine.appendSwitch("remote-debugging-port", "9222");
    app.commandLine.appendSwitch("remote-allow-origins", "*");
  } catch {}
}

/* ---- recordings folder ---- */
function recordingsDir() {
  const dir = path.join(app.getPath("videos"), "AHG Studio");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* ---- settings store ---- */
function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json");
}
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf-8"));
  } catch {
    return {};
  }
}

// Output folder: user-chosen if set, else Videos/AHG Studio.
function outDir() {
  const custom = readSettings().outputFolder;
  if (custom) {
    try {
      fs.mkdirSync(custom, { recursive: true });
      return custom;
    } catch {}
  }
  return recordingsDir();
}
// Screenshots can have their own folder; falls back to the videos folder.
function shotDir() {
  const custom = readSettings().screenshotFolder;
  if (custom) {
    try {
      fs.mkdirSync(custom, { recursive: true });
      return custom;
    } catch {}
  }
  return outDir();
}

let win = null;
let tray = null;
let isQuitting = false;
let allowClose = false; // set once the renderer confirms the close-guard modal

function createTray() {
  if (tray) return;
  try {
    const img = nativeImage.createFromPath(APP_ICON);
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
    tray.setToolTip("AHG Studio");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open AHG Studio", click: () => showWindow() },
        { type: "separator" },
        {
          label: "Quit",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ])
    );
    tray.on("click", () => showWindow());
  } catch {}
}

function showWindow() {
  if (!win) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    frame: false,
    backgroundColor: "#15151c",
    show: false,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Default (true): a hidden/occluded window throttles its timers & rAF so a
      // backgrounded editor stops burning CPU/GPU. (Was temporarily false for
      // CDP testing — that kept the compositor/clock loops running full-speed in
      // the background, a real source of "lag in the background".)
      backgroundThrottling: true,
    },
  });

  // Auto-grant screen + system audio capture with no OS picker.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => {
          if (!sources || !sources.length) return callback({});
          callback({ video: sources[0], audio: "loopback" });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false }
  );

  if (isDev) {
    win.loadURL("http://localhost:5180");
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  const s = readSettings();
  const startMin = !!s.startMinimized || process.argv.includes("--minimized");
  createTray();

  win.once("ready-to-show", () => {
    if (startMin) {
      if (s.minimizeToTray === false) win.minimize();
      // else: stay hidden in tray
    } else {
      win.show();
    }
  });

  // Close guard — if the user (or Task Manager "End task") closes the window
  // while busy, ask the renderer first so we can stop/save recordings etc.
  win.on("close", (e) => {
    if (allowClose || isQuitting) return;
    e.preventDefault();
    try {
      if (!win.isVisible()) win.show();
      win.focus();
      win.webContents.send("app:closeRequest");
    } catch {
      allowClose = true;
      win.close();
    }
  });

  win.on("maximize", () => win.webContents.send("window:state", true));
  win.on("unmaximize", () => win.webContents.send("window:state", false));
  // Minimize stays a normal minimize (visible in the taskbar) — no tray-hide.
  win.on("closed", () => (win = null));

  // Crash recovery — if the renderer (GPU/heavy media) dies, reload instead of
  // leaving a blank/dead window. Avoids the "app randomly crashes" dead-end.
  // Guarded so a renderer that dies on load can't get stuck in a reload loop.
  win.webContents.on("render-process-gone", (_e, details) => {
    if (details.reason === "clean-exit" || isQuitting) return;
    const now = Date.now();
    if (now - lastReload < 5000) return; // already just reloaded — let it settle
    lastReload = now;
    try {
      win.reload();
    } catch {}
  });
  // Do NOT force-crash the renderer when it's briefly unresponsive. A heavy page
  // switch (mounting the editor, decoding video, building a big timeline) can
  // block the main thread for a moment — the old `forcefullyCrashRenderer()` here
  // turned that transient jank into a real, state-losing crash ("switching pages
  // crashes the app"). Let Chromium recover on its own instead.
  win.webContents.on("unresponsive", () => {
    console.warn("[main] renderer briefly unresponsive — waiting for recovery");
  });
  win.webContents.on("responsive", () => {
    console.warn("[main] renderer responsive again");
  });
}

// GPU process crash — the renderer survives but every canvas/video stops
// painting (the "preview goes blank and stays blank" bug). Reload to rebuild
// the GPU-backed contexts. Guarded with the same throttle as render-process.
// Registered ONCE at module scope: these are app-level events, so registering
// them inside createWindow() added a new (leaked) listener on every window
// rebuild, each firing its own reload.
let lastReload = 0;
function onGpuGone(reason) {
  console.warn("[main] GPU process gone:", reason);
  if (reason === "clean-exit" || isQuitting || !win) return;
  const now = Date.now();
  if (now - lastReload < 5000) return;
  lastReload = now;
  try {
    win.webContents.reload();
  } catch {}
}
app.on("gpu-process-crashed", (_e, killed) => onGpuGone(killed ? "killed" : "crashed"));
app.on("child-process-gone", (_e, details) => {
  if (details && details.type === "GPU") onGpuGone(details.reason);
});

// Keep the main process alive on stray errors (e.g. a failed download stream)
// rather than hard-crashing the whole app.
process.on("uncaughtException", (e) => console.error("[main] uncaughtException:", e && e.message ? e.message : e));
process.on("unhandledRejection", (e) => console.error("[main] unhandledRejection:", e));

app.whenReady().then(() => {
  createWindow();
  // Defer cache pruning so it never competes with window startup.
  setTimeout(pruneCaches, 8000);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  // Guarantee no ffmpeg/ffprobe survives the app (orphaned encoders pinned CPU
  // and held file handles after exit).
  killAllChildren();
});

/* ---------------- IPC: window controls ---------------- */
ipcMain.on("window:minimize", () => win?.minimize());
ipcMain.on("window:maximize", () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
ipcMain.on("window:close", () => {
  // Route through the guarded close (win.on("close") asks the renderer first).
  if (win) win.close();
  else app.quit();
});
// Renderer's decision after the close-guard modal.
ipcMain.on("app:confirmClose", () => {
  allowClose = true;
  isQuitting = true;
  if (win) win.close();
  else app.quit();
});
ipcMain.on("app:cancelClose", () => {
  /* user kept working — nothing to do */
});
ipcMain.handle("window:isMaximized", () => !!win?.isMaximized());

/* ---------------- IPC: startup / OS integration ---------------- */
ipcMain.on("startup:apply", (_e, { startWithWindows, startMinimized }) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!startWithWindows,
      args: startMinimized ? ["--minimized"] : [],
    });
  } catch {}
});

/* ---------------- IPC: global hotkeys ---------------- */
function registerHotkeys(map) {
  globalShortcut.unregisterAll();
  if (!map) return;
  for (const action of Object.keys(map)) {
    const accel = map[action];
    if (!accel) continue;
    try {
      globalShortcut.register(accel, () => {
        if (action === "showApp") showWindow();
        else win?.webContents.send("hotkey:trigger", action);
      });
    } catch {}
  }
}
ipcMain.on("hotkeys:register", (_e, map) => registerHotkeys(map));

/* ---------------- IPC: settings ---------------- */
ipcMain.handle("settings:get", () => readSettings());
ipcMain.handle("settings:set", (_e, patch) => {
  const next = { ...readSettings(), ...patch };
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  return next;
});

/* ---------------- IPC: save a recording ---------------- */
ipcMain.handle("rec:save", async (_e, { buffer, ext, durationSec }) => {
  const dir = outDir();
  const stamp = new Date()
    .toISOString()
    .replace(/[:T]/g, "-")
    .replace(/\..+/, "");
  const file = path.join(dir, `Recording ${stamp}.${ext || "webm"}`);
  fs.writeFileSync(file, Buffer.from(buffer));
  // MediaRecorder WebM lacks a duration header, so persist the known length alongside it.
  if (durationSec) {
    try {
      fs.writeFileSync(file + ".meta.json", JSON.stringify({ durationSec }));
    } catch {}
  }
  return { path: file, size: fs.statSync(file).size };
});

/* ---------------- IPC: list recordings ---------------- */
function probeDuration(file) {
  return new Promise((resolve) => {
    if (!ffprobePath) return resolve(0);
    const p = spawn(ffprobePath, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    let out = "";
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(kill);
      resolve(v);
    };
    // A hung ffprobe would otherwise block a slot in the bounded pool forever,
    // stalling thumbnail/metadata loading (felt as "lag" when browsing media).
    const kill = setTimeout(() => {
      try { p.kill("SIGKILL"); } catch {}
      done(0);
    }, 8000);
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => done(Math.round(parseFloat(out) || 0)));
    p.on("error", () => done(0));
  });
}

// Run async tasks with a bounded concurrency so a big folder can't spawn
// hundreds of ffprobe processes at once (the old code probed serially → very slow).
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

ipcMain.handle("rec:list", async () => {
  // Scan the video folder and (if different) the screenshot folder, deduped, so
  // recordings show together even when the user splits videos/screenshots apart.
  const dirs = [...new Set([outDir(), shotDir()])];
  const seen = new Set();
  const files = [];
  for (const dir of dirs) {
    let names = [];
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!/\.(webm|mp4|mkv|mov)$/i.test(f)) continue;
      const full = path.join(dir, f);
      if (seen.has(full)) continue;
      seen.add(full);
      try {
        const st = await fs.promises.stat(full);
        files.push({ path: full, name: f, sizeMb: st.size / (1024 * 1024), mtime: st.mtimeMs });
      } catch {}
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);

  // Resolve durations concurrently; cache each probe to a sidecar so the Library
  // only ever pays the ffprobe cost once per file.
  await pool(files, 4, async (f) => {
    let dur = 0;
    try {
      dur = JSON.parse(await fs.promises.readFile(f.path + ".meta.json", "utf-8")).durationSec || 0;
    } catch {}
    if (!dur) {
      dur = await probeDuration(f.path);
      if (dur) {
        try {
          await fs.promises.writeFile(f.path + ".meta.json", JSON.stringify({ durationSec: dur }));
        } catch {}
      }
    }
    f.durationSec = dur;
    f.optimized = /-optimized\./i.test(f.name);
    f.codec = /\.mp4$/i.test(f.name) ? "H.264" : "VP9";
  });
  return files;
});

/* ---------------- IPC: pick a file to optimize ---------------- */
ipcMain.handle("file:pick", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Choose a video to optimize",
    properties: ["openFile"],
    filters: [{ name: "Video", extensions: ["webm", "mp4", "mkv", "mov", "avi"] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { path: p, name: path.basename(p), sizeMb: fs.statSync(p).size / (1024 * 1024) };
});

/* ---------------- IPC: pick an image for a source ---------------- */
ipcMain.handle("file:pickImage", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Choose an image",
    properties: ["openFile"],
    filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { path: p, name: path.basename(p) };
});

/* ---------------- IPC: reveal / open ---------------- */
ipcMain.on("file:reveal", (_e, p) => p && shell.showItemInFolder(p));
ipcMain.on("file:open", (_e, p) => p && shell.openPath(p));
ipcMain.on("external:open", (_e, url) => url && shell.openExternal(url));

/* ---------------- IPC: capturable sources (screens + windows) ---------------- */
ipcMain.handle("sources:list", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 384, height: 216 },
    fetchWindowIcons: true,
  });
  return sources
    .filter((s) => s.name && s.name !== "AHG Studio")
    .map((s) => ({
      id: s.id,
      name: s.name,
      type: s.id.startsWith("screen") ? "screen" : "window",
      thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : "",
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : "",
    }));
});

/* ---------------- IPC: live performance metrics ---------------- */
ipcMain.handle("metrics:get", () => {
  try {
    const metrics = app.getAppMetrics();
    let cpu = 0;
    let memKb = 0;
    for (const p of metrics) {
      cpu += p.cpu ? p.cpu.percentCPUUsage : 0;
      memKb += p.memory ? p.memory.workingSetSize : 0;
    }
    return { cpu: Math.min(100, Math.round(cpu)), memMb: Math.round(memKb / 1024) };
  } catch {
    return { cpu: 0, memMb: 0 };
  }
});

/* ---------------- IPC: delete a recording ---------------- */
ipcMain.handle("rec:delete", (_e, p) => {
  try {
    fs.unlinkSync(p);
    try {
      fs.unlinkSync(p + ".meta.json");
    } catch {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

/* ---------------- IPC: pick output folder ---------------- */
ipcMain.handle("dialog:pickFolder", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

ipcMain.handle("rec:dir", () => outDir());
ipcMain.on("dir:open", () => shell.openPath(outDir()));

/* ---------------- IPC: rename a recording ---------------- */
function sanitizeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 120) || "Recording";
}
ipcMain.handle("rec:rename", (_e, { oldPath, newName }) => {
  try {
    if (!fs.existsSync(oldPath)) return { ok: false, error: "File not found." };
    const dir = path.dirname(oldPath);
    const ext = path.extname(oldPath);
    const target = path.join(dir, sanitizeName(newName) + ext);
    if (target !== oldPath) {
      if (fs.existsSync(target)) return { ok: false, error: "A file with that name already exists." };
      fs.renameSync(oldPath, target);
      try {
        if (fs.existsSync(oldPath + ".meta.json")) fs.renameSync(oldPath + ".meta.json", target + ".meta.json");
      } catch {}
    }
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

/* ---------------- IPC: remux a recording to another container (no re-encode) ---------------- */
ipcMain.handle("rec:remux", async (_e, { input, container }) => {
  try {
    if (!ffmpegPath || !fs.existsSync(input)) return { ok: false };
    const out = input.replace(/\.[^.]+$/, "") + "." + container;
    if (out === input) return { ok: true, path: input, size: fs.statSync(input).size };
    await new Promise((res) => {
      const p = spawn(ffmpegPath, ["-y", "-i", input, "-c", "copy", out]);
      p.on("close", res);
      p.on("error", res);
    });
    if (fs.existsSync(out)) {
      try {
        fs.unlinkSync(input);
        if (fs.existsSync(input + ".meta.json")) fs.renameSync(input + ".meta.json", out + ".meta.json");
      } catch {}
      return { ok: true, path: out, size: fs.statSync(out).size };
    }
    return { ok: false };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

/* ---------------- IPC: fix a replay clip (re-encode → smooth CFR, seekable, HQ) ---------------- */
// Instant-replay output is captured as variable-frame-rate WebM, which plays back
// choppy. Re-encode to a constant frame rate H.264 file: regenerate timestamps,
// force CFR at the capture fps, high quality, faststart for instant seeking.
ipcMain.handle("rec:fixReplay", async (_e, payload) => {
  const input = typeof payload === "string" ? payload : payload?.input;
  const fps = (typeof payload === "object" && payload?.fps) || 60;
  try {
    if (!ffmpegPath || !input || !fs.existsSync(input)) return { ok: false };
    const out = input.replace(/\.[^.]+$/, "") + "-replay.mp4";
    const gop = String(Math.max(2, Math.round(fps)) * 2);
    await new Promise((res) => {
      const p = spawn(ffmpegPath, [
        "-y", "-fflags", "+genpts", "-i", input,
        "-vf", `fps=${Math.round(fps)},format=yuv420p`,
        "-vsync", "cfr",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-g", gop, "-bf", "2",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", out,
      ]);
      p.on("close", res);
      p.on("error", res);
    });
    if (fs.existsSync(out)) {
      try {
        fs.unlinkSync(input);
        if (fs.existsSync(input + ".meta.json")) fs.renameSync(input + ".meta.json", out + ".meta.json");
      } catch {}
      return { ok: true, path: out, size: fs.statSync(out).size };
    }
    return { ok: false };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

/* ---------------- IPC: detect silence (for AI auto-cut) ---------------- */
ipcMain.handle("edit:silence", async (_e, { input, noiseDb, minSilence }) => {
  if (!ffmpegPath || !fs.existsSync(input)) return { ok: false, ranges: [] };
  const nd = noiseDb ?? -30;
  const md = minSilence ?? 1;
  // Band-pass to the human-voice range before detecting silence, so background
  // music from the system/output is largely ignored and cuts track the mic/voice.
  const af = `highpass=f=180,lowpass=f=3600,silencedetect=noise=${nd}dB:d=${md}`;
  return await new Promise((resolve) => {
    let err = "";
    const p = spawn(ffmpegPath, ["-i", input, "-af", af, "-f", "null", "-"]);
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => {
      const ranges = [];
      const re = /silence_start: ([\d.]+)|silence_end: ([\d.]+)/g;
      let m;
      let start = null;
      while ((m = re.exec(err))) {
        if (m[1] !== undefined) start = parseFloat(m[1]);
        else if (m[2] !== undefined && start != null) {
          ranges.push({ start, end: parseFloat(m[2]) });
          start = null;
        }
      }
      resolve({ ok: true, ranges });
    });
    p.on("error", () => resolve({ ok: false, ranges: [] }));
  });
});

/* ---------------- IPC: export a multi-track timeline ---------------- */
// Map our transition kinds to ffmpeg xfade names.
const XFADE_MAP = {
  none: "fade",
  crossfade: "fade",
  fadeblack: "fadeblack",
  fadewhite: "fadewhite",
  dissolve: "dissolve",
  slideleft: "slideleft",
  slideright: "slideright",
  slideup: "slideup",
  slidedown: "slidedown",
  smoothleft: "smoothleft",
  smoothright: "smoothright",
  wipeleft: "wipeleft",
  wiperight: "wiperight",
  wipeup: "wipeup",
  wipedown: "wipedown",
  circleopen: "circleopen",
  circleclose: "circleclose",
  radial: "radial",
  pixelize: "pixelize",
  blur: "fadegrays",
};

function winFont(family, bold) {
  const dir = path.join(process.env.WINDIR || "C:\\Windows", "Fonts");
  const map = {
    Inter: bold ? "segoeuib.ttf" : "segoeui.ttf",
    "JetBrains Mono": bold ? "consolab.ttf" : "consola.ttf",
    Georgia: bold ? "georgiab.ttf" : "georgia.ttf",
    Impact: "impact.ttf",
    "Courier New": bold ? "courbd.ttf" : "cour.ttf",
    "Arial Black": "ariblk.ttf",
  };
  const candidates = [map[family], bold ? "arialbd.ttf" : "arial.ttf", "segoeui.ttf", "arial.ttf"];
  for (const c of candidates) {
    if (!c) continue;
    const full = path.join(dir, c);
    if (fs.existsSync(full)) return full;
  }
  return path.join(dir, "arial.ttf");
}
// Escape a filesystem path for use inside an ffmpeg filtergraph option value.
const escFilterPath = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
const hex = (c) => (c && /^#?[0-9a-fA-F]{6}$/.test(c) ? "0x" + c.replace("#", "") : "white");

ipcMain.handle("edit:exportTimeline", async (_e, spec) => {
  try {
    if (!ffmpegPath) return { ok: false, error: "FFmpeg not available." };
    const { tracks, clips, fps, width, height, duration, format, codec, quality, resolution, audioKbps, outputName } = spec;
    if (!clips || !clips.length) return { ok: false, error: "Timeline is empty." };

    const fmt = format || "mp4";
    let W = width || 1920;
    let H = height || 1080;
    if (resolution && resolution !== "source") {
      H = Number(resolution);
      W = Math.round((H * (width || 1920)) / (height || 1080) / 2) * 2;
    }
    const FPS = fps || 30;
    const dur = Math.max(0.1, duration || 0);
    const clampSpeed = (n) => Math.min(2, Math.max(0.5, n || 1));
    const num = (n) => (typeof n === "number" && isFinite(n) ? n : 0);
    // CSS blend-mode id -> FFmpeg blend all_mode (mirrors BLEND_MODES in timeline.ts).
    const BLEND_FF = { normal: "normal", screen: "screen", multiply: "multiply", overlay: "overlay", lighten: "lighten", darken: "darken", difference: "difference", exclusion: "exclusion", "color-dodge": "dodge", "color-burn": "burn", "hard-light": "hardlight", "soft-light": "softlight" };
    const blendFf = (m) => BLEND_FF[m] || "normal";
    // Build an ffmpeg `overlay` x/y expression from position keyframes (piecewise
    // linear in timeline time `t`). `key` is "x"|"y", `sizePx` is W|H, `start` is the
    // clip's timeline start. Clamps to the first/last keyframe outside the range.
    const kfExpr = (kfs, start, sizePx, key) => {
      const s = kfs.map((k) => ({ t: start + k.t, v: (key === "x" ? k.x : k.y) * sizePx })).sort((a, b) => a.t - b.t);
      let expr = s[s.length - 1].v.toFixed(2); // after the last keyframe → hold
      for (let i = s.length - 2; i >= 0; i--) {
        const a = s[i], b = s[i + 1];
        const dt = Math.max(0.001, b.t - a.t);
        const seg = `(${a.v.toFixed(2)}+(${(b.v - a.v).toFixed(2)})*(t-${a.t.toFixed(4)})/${dt.toFixed(4)})`;
        expr = `if(lt(t,${b.t.toFixed(4)}),${seg},${expr})`;
      }
      return `if(lt(t,${s[0].t.toFixed(4)}),${s[0].v.toFixed(2)},${expr})`;
    };

    const trackById = {};
    for (const t of tracks) trackById[t.id] = t;
    const lenOf = (c) =>
      c.kind === "video" || c.kind === "audio" ? Math.max(0.05, (c.out - c.in) / clampSpeed(c.speed)) : Math.max(0.05, c.out - c.in);

    // One input per media clip (avoids split filters for reused files).
    const media = clips.filter((c) => (c.kind === "video" || c.kind === "audio") && c.path && fs.existsSync(c.path));
    const args = ["-y"];
    const idxOf = new Map(); // clip id → ffmpeg input ordinal (one -i per media clip)
    let ord = 0;
    for (const c of media) {
      idxOf.set(c.id, ord++);
      args.push("-i", c.path);
    }

    const videoTracks = tracks.filter((t) => t.kind === "video" && !t.hidden);
    const mainTrack = videoTracks[videoTracks.length - 1]; // bottom-most
    const overlayTracks = videoTracks.slice(0, -1); // above the spine
    const sortByStart = (arr) => [...arr].sort((a, b) => a.start - b.start);

    const bgColor = hex(spec.bg) === "white" ? "0x000000" : hex(spec.bg);

    // Default PiP box (matches DEFAULT_PIP in src/lib/timeline.ts).
    const DEFAULT_PIP = { x: 0.7, y: 0.7, w: 0.26, h: 0.26 };
    // per-clip color/reverse + blur fragments (reverse handled separately upstream)
    const vColor = (c) => {
      const parts = [];
      if (c.reverse) parts.push("reverse");
      // geometry: mirror / flip / rotate (rotate with expand so corners aren't clipped)
      if (c.flipH) parts.push("hflip");
      if (c.flipV) parts.push("vflip");
      // rotate WITHOUT expanding the frame (matches the CSS rotate in preview);
      // exposed corners are filled with the canvas background colour.
      if (c.rotate) parts.push(`rotate=${((c.rotate * Math.PI) / 180).toFixed(5)}`);
      const b = c.brightness || 0;
      const ct = c.contrast == null ? 1 : c.contrast;
      const sa = c.saturate == null ? 1 : c.saturate;
      if (b !== 0 || ct !== 1 || sa !== 1) parts.push(`eq=brightness=${b.toFixed(3)}:contrast=${ct.toFixed(3)}:saturation=${sa.toFixed(3)}`);
      if (c.hue) parts.push(`hue=h=${c.hue.toFixed(2)}`);
      // Levels — tonal black/white points + gamma (matches a basic curves control).
      if (c.levels && (c.levels.black || c.levels.white != null || c.levels.gamma != null)) {
        const bl = num(c.levels.black);
        const wh = c.levels.white == null ? 1 : num(c.levels.white) || 1;
        const gm = c.levels.gamma == null ? 1 : Math.max(0.1, num(c.levels.gamma) || 1);
        parts.push(`curves=all='${bl.toFixed(3)}/0 ${wh.toFixed(3)}/1'`);
        if (gm !== 1) parts.push(`eq=gamma=${gm.toFixed(3)}`);
      }
      if (c.blur && c.blur > 0) parts.push(`gblur=sigma=${(c.blur * 20).toFixed(2)}`);
      // Sharpen — unsharp mask (0..1 → luma amount up to ~1.5).
      if (c.sharpen && c.sharpen > 0) parts.push(`unsharp=5:5:${(c.sharpen * 1.5).toFixed(3)}:5:5:0`);
      // Vignette — edge darkening (0..1 → lens angle; PI/5..~PI/2.2).
      if (c.vignette && c.vignette > 0) parts.push(`vignette=angle=${(Math.PI / 5 + c.vignette * (Math.PI / 2.2 - Math.PI / 5)).toFixed(4)}`);
      return parts.length ? "," + parts.join(",") : "";
    };
    // Effective fades = explicit fadeIn/fadeOut merged with an "in"/"out"
    // transition (those bake as a fade so they don't xfade with the neighbor).
    const effFades = (c, len) => {
      let fi = c.fadeIn || 0;
      let fo = c.fadeOut || 0;
      const tr = c.transition;
      if (tr && tr.kind !== "none" && tr.dir && tr.dir !== "between") {
        const d = Math.min(tr.duration || 0.5, len);
        if (tr.dir === "in") fi = Math.max(fi, d);
        if (tr.dir === "out") fo = Math.max(fo, d);
      }
      return { fi: Math.min(fi, len), fo: Math.min(fo, len) };
    };
    const isXfade = (c) => {
      const tr = c.transition;
      return !!(tr && tr.kind !== "none" && (tr.dir === undefined || tr.dir === "between"));
    };
    const vFade = (c, len) => {
      let s = "";
      const { fi, fo } = effFades(c, len);
      if (fi > 0.02) s += `,fade=t=in:st=0:d=${fi.toFixed(3)}`;
      if (fo > 0.02) s += `,fade=t=out:st=${(len - fo).toFixed(3)}:d=${fo.toFixed(3)}`;
      return s;
    };
    const aFade = (c, len) => {
      let s = "";
      const { fi, fo } = effFades(c, len);
      if (fi > 0.02) s += `,afade=t=in:st=0:d=${fi.toFixed(3)}`;
      if (fo > 0.02) s += `,afade=t=out:st=${(len - fo).toFixed(3)}:d=${fo.toFixed(3)}`;
      return s;
    };

    let fc = []; // filter_complex pieces
    let vlabel;

    // ---- main video spine (with transitions) ----
    const spineClips = mainTrack ? sortByStart(clips.filter((c) => c.trackId === mainTrack.id && c.kind === "video" && idxOf.has(c.id))) : [];
    if (spineClips.length) {
      spineClips.forEach((c, i) => {
        const sp = clampSpeed(c.speed);
        const rev = c.reverse ? ",reverse" : "";
        const eq = vColor({ ...c, reverse: false }); // reverse handled separately (before setpts)
        // Punch-in zoom = centre-crop the source before it's scaled to its box.
        const z = c.zoom || 1;
        const zoomCrop = z > 1.001 ? `,crop=iw/${z.toFixed(3)}:ih/${z.toFixed(3)}` : "";
        // Frame box (defaults to the full canvas) — lets a base-track clip be
        // resized/repositioned in the preview and have it reflected on export.
        const fr = c.frame && typeof c.frame.w === "number" ? c.frame : { x: 0, y: 0, w: 1, h: 1 };
        const fw = Math.max(2, Math.round((W * Math.min(1, Math.max(0.04, fr.w))) / 2) * 2);
        const fh = Math.max(2, Math.round((H * Math.min(1, Math.max(0.04, fr.h))) / 2) * 2);
        const fx = Math.round(W * Math.min(1, Math.max(0, fr.x)));
        const fy = Math.round(H * Math.min(1, Math.max(0, fr.y)));
        fc.push(
          `[${idxOf.get(c.id)}:v]trim=start=${c.in}:end=${c.out}${rev},setpts=(PTS-STARTPTS)/${sp}${zoomCrop},` +
            `scale=${fw}:${fh}:force_original_aspect_ratio=decrease,pad=${W}:${H}:${fx}+(${fw}-iw)/2:${fy}+(${fh}-ih)/2:color=${bgColor},setsar=1,fps=${FPS},format=yuv420p${eq}${vFade(c, lenOf(c))}[mv${i}]`
        );
      });
      let acc = "mv0";
      let cum = lenOf(spineClips[0]);
      for (let i = 1; i < spineClips.length; i++) {
        const c = spineClips[i];
        const li = lenOf(c);
        const tr = c.transition;
        const d = isXfade(c) ? Math.min(tr.duration || 0.5, lenOf(spineClips[i - 1]) - 0.05, li - 0.05) : 0;
        if (d > 0.05) {
          const offset = Math.max(0, cum - d);
          fc.push(`[${acc}][mv${i}]xfade=transition=${XFADE_MAP[tr.kind] || "fade"}:duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}[xf${i}]`);
          acc = `xf${i}`;
          cum = cum + li - d;
        } else {
          fc.push(`[${acc}][mv${i}]concat=n=2:v=1:a=0[cc${i}]`);
          acc = `cc${i}`;
          cum = cum + li;
        }
      }
      vlabel = acc;
    } else {
      fc.push(`color=c=${bgColor}:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(3)}[bg]`);
      vlabel = "bg";
    }

    // ---- overlay (PiP) video tracks ----
    let ovN = 0;
    for (const t of overlayTracks) {
      for (const c of sortByStart(clips.filter((x) => x.trackId === t.id && x.kind === "video" && idxOf.has(x.id)))) {
        const sp = clampSpeed(c.speed);
        const start = c.start;
        const end = clipEndSpec(c, lenOf);
        const op = typeof c.opacity === "number" ? c.opacity : 1;
        // Overlay video: scale to the clip's normalized frame box and overlay at
        // its position. Defaults to FULL frame (matches the preview) — a clip is
        // only a corner PiP once the user resizes it (which sets c.frame).
        const fr = c.frame && typeof c.frame.w === "number" ? c.frame : { x: 0, y: 0, w: 1, h: 1 };
        const ow = Math.max(2, Math.round((W * Math.min(1, Math.max(0.04, fr.w))) / 2) * 2);
        const oh = Math.max(2, Math.round((H * Math.min(1, Math.max(0.04, fr.h))) / 2) * 2);
        const ox = Math.round(W * Math.min(1, Math.max(0, fr.x)));
        const oy = Math.round(H * Math.min(1, Math.max(0, fr.y)));
        const eq = vColor({ ...c, reverse: false });
        const rev = c.reverse ? ",reverse" : "";
        const blendMode = blendFf(c.blend);
        if (blendMode && blendMode !== "normal") {
          // Blend-mode compositing. The base overlay path can't express blend math,
          // so build it explicitly: drop the clip onto a full-duration canvas, blend
          // the whole frame with the base, then re-overlay only the clip's box+window
          // so areas outside the clip stay untouched. Timing is preserved by the same
          // between() gate used in the normal path.
          fc.push(
            `[${idxOf.get(c.id)}:v]trim=start=${c.in}:end=${c.out}${rev},setpts=(PTS-STARTPTS)/${sp}+${start}/TB,` +
              `scale=${ow}:${oh}:force_original_aspect_ratio=increase,crop=${ow}:${oh}${eq},format=yuv420p[pipr${ovN}]`
          );
          fc.push(`color=black:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(3)},format=yuv420p[cv${ovN}]`);
          fc.push(`[cv${ovN}][pipr${ovN}]overlay=${ox}:${oy}:enable='between(t,${start},${end})'[pf${ovN}]`);
          fc.push(`[${vlabel}]split[bg${ovN}][fg${ovN}]`);
          fc.push(`[fg${ovN}][pf${ovN}]blend=all_mode=${blendMode}:all_opacity=${op}[bl${ovN}]`);
          fc.push(`[bl${ovN}]crop=${ow}:${oh}:${ox}:${oy}[bc${ovN}]`);
          fc.push(`[bg${ovN}][bc${ovN}]overlay=${ox}:${oy}:enable='between(t,${start},${end})'[ov${ovN}]`);
        } else {
          fc.push(
            `[${idxOf.get(c.id)}:v]trim=start=${c.in}:end=${c.out}${rev},setpts=(PTS-STARTPTS)/${sp}+${start}/TB,` +
              `scale=${ow}:${oh}:force_original_aspect_ratio=increase,crop=${ow}:${oh}${eq},format=yuva420p,colorchannelmixer=aa=${op}[pip${ovN}]`
          );
          // Position keyframes (motion) → time-varying overlay x/y; else static.
          const animated = Array.isArray(c.kf) && c.kf.length >= 2;
          const xPos = animated ? `'${kfExpr(c.kf, start, W, "x")}'` : ox;
          const yPos = animated ? `'${kfExpr(c.kf, start, H, "y")}'` : oy;
          const evalMode = animated ? ":eval=frame" : "";
          fc.push(`[${vlabel}][pip${ovN}]overlay=${xPos}:${yPos}${evalMode}:enable='between(t,${start},${end})'[ov${ovN}]`);
        }
        vlabel = `ov${ovN}`;
        ovN++;
      }
    }

    // ---- text overlays (drawtext) ----
    const tmpDir = path.join(app.getPath("userData"), "edittmp");
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFiles = [];
    let txN = 0;
    for (const c of clips.filter((x) => x.kind === "text")) {
      const tt = trackById[c.trackId];
      if (tt && tt.hidden) continue; // text track toggled off
      const start = c.start;
      const end = clipEndSpec(c, lenOf);
      const tf = path.join(tmpDir, `t_${txN}_${Date.now()}.txt`);
      fs.writeFileSync(tf, String(c.text || ""), "utf8");
      tmpFiles.push(tf);
      const isBold = typeof c.weight === "number" ? c.weight >= 700 : !!c.bold;
      const ff = escFilterPath(winFont(c.fontFamily || "Inter", isBold));
      const fs2 = Math.round(((c.fontSize || 72) / 1080) * H); // scale font to output height
      const px = typeof c.posX === "number" ? c.posX : 0.5;
      const py = typeof c.posY === "number" ? c.posY : 0.5;
      const box = c.bg && !c.gradient ? `:box=1:boxcolor=${hex(c.bg)}@0.85:boxborderw=${Math.round(fs2 * 0.3)}` : "";
      // Text outline (gradient fill isn't expressible in drawtext → solid color).
      const bw = c.stroke && c.stroke > 0 ? Math.max(1, Math.round((c.stroke / 1080) * H)) : 0;
      const border = bw ? `:borderw=${bw}:bordercolor=${c.strokeColor ? hex(c.strokeColor) : "black"}` : "";
      let alpha = "1";
      if (c.anim === "fade") alpha = `if(lt(t,${start}+0.4),(t-${start})/0.4,if(gt(t,${end}-0.4),(${end}-t)/0.4,1))`;
      fc.push(
        `[${vlabel}]drawtext=fontfile='${ff}':textfile='${escFilterPath(tf)}':fontcolor=${hex(c.color)}:fontsize=${fs2}` +
          `${box}${border}:x=(w-text_w)*${px}:y=(h-text_h)*${py}:shadowcolor=black@0.5:shadowx=2:shadowy=2:alpha='${alpha}':enable='between(t,${start},${end})'[tx${txN}]`
      );
      vlabel = `tx${txN}`;
      txN++;
    }

    // ---- audio ----
    const audioLabels = [];
    let aN = 0;
    for (const c of media) {
      const t = trackById[c.trackId];
      if (!t || t.muted) continue;
      if (c.kind === "video" && t.kind === "audio") continue;
      // A linked audio clip is a waveform/volume proxy — its sound comes from the
      // linked VIDEO clip, so skip it here to avoid doubled audio.
      if (c.kind === "audio" && c.linkId) continue;
      const vol = typeof c.volume === "number" ? c.volume : 1;
      if (vol <= 0) continue;
      const sp = clampSpeed(c.speed);
      const delayMs = Math.round(c.start * 1000);
      let chain = `[${idxOf.get(c.id)}:a]atrim=start=${c.in}:end=${c.out},asetpts=PTS-STARTPTS`;
      // Noise suppression — cut sub-bass rumble + spectral denoise (export-side).
      if (c.denoise) chain += `,highpass=f=80,afftdn=nf=-25`;
      // 3-band parametric EQ (gain in dB per band; 0 = bypass).
      const eqLow = num(c.eqLow), eqMid = num(c.eqMid), eqHigh = num(c.eqHigh);
      if (eqLow) chain += `,equalizer=f=100:t=q:w=1.0:g=${eqLow.toFixed(2)}`;
      if (eqMid) chain += `,equalizer=f=1000:t=q:w=1.0:g=${eqMid.toFixed(2)}`;
      if (eqHigh) chain += `,equalizer=f=8000:t=q:w=1.0:g=${eqHigh.toFixed(2)}`;
      // Compressor — tame dynamics (voice/music glue).
      if (c.compress) chain += `,acompressor=threshold=-18dB:ratio=3:attack=20:release=250:makeup=2`;
      if (c.audioNormalize) chain += `,loudnorm=I=-16:TP=-1.5:LRA=11`;
      if (c.reverse) chain += `,areverse`;
      if (sp !== 1) chain += `,atempo=${sp}`;
      if (vol !== 1) chain += `,volume=${vol}`;
      // Extra gain trim in dB (independent of the 0..1 linear volume).
      const gainDb = num(c.gainDb);
      if (gainDb) chain += `,volume=${gainDb.toFixed(2)}dB`;
      // Stereo balance / pan: -1 = hard left, +1 = hard right.
      const pan = Math.max(-1, Math.min(1, num(c.pan)));
      if (pan) {
        const lg = pan <= 0 ? 1 : (1 - pan);
        const rg = pan >= 0 ? 1 : (1 + pan);
        chain += `,pan=stereo|c0=${lg.toFixed(3)}*c0|c1=${rg.toFixed(3)}*c1`;
      }
      chain += aFade(c, lenOf(c));
      chain += `,adelay=${delayMs}|${delayMs}[a${aN}]`;
      fc.push(chain);
      audioLabels.push(`a${aN}`);
      aN++;
    }
    let alabel = null;
    if (audioLabels.length === 1) alabel = audioLabels[0];
    else if (audioLabels.length > 1) {
      fc.push(`${audioLabels.map((l) => `[${l}]`).join("")}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0[aout]`);
      alabel = "aout";
    }

    // ---- export only a selected range ----
    let outDur = dur;
    const range = spec.range;
    if (range && typeof range.a === "number" && range.b > range.a) {
      fc.push(`[${vlabel}]trim=start=${range.a.toFixed(3)}:end=${range.b.toFixed(3)},setpts=PTS-STARTPTS[vr]`);
      vlabel = "vr";
      if (alabel) {
        fc.push(`[${alabel}]atrim=start=${range.a.toFixed(3)}:end=${range.b.toFixed(3)},asetpts=PTS-STARTPTS[ar]`);
        alabel = "ar";
      }
      outDur = range.b - range.a;
    }

    // Honor a per-export output folder from the renderer if it exists & is writable;
    // otherwise fall back to the configured default output folder.
    let dir = outDir();
    if (spec.outDir && typeof spec.outDir === "string") {
      try {
        if (fs.existsSync(spec.outDir) && fs.statSync(spec.outDir).isDirectory()) dir = spec.outDir;
      } catch {}
    }
    const output = path.join(dir, sanitizeName(outputName || "ahg-edit") + "." + fmt);
    const crf = Math.round(33 - (Math.max(20, Math.min(100, quality || 72)) / 100) * 23);
    const lib = fmt === "webm" ? "libvpx-vp9" : codec === "hevc" ? "libx265" : codec === "av1" ? "libsvtav1" : "libx264";

    const full = ["-y", ...args.slice(1), "-filter_complex", fc.join(";"), "-map", `[${vlabel}]`];
    if (alabel) full.push("-map", `[${alabel}]`);
    full.push("-c:v", lib);
    if (fmt === "webm") full.push("-b:v", "0", "-crf", String(crf), "-row-mt", "1");
    else {
      full.push("-crf", String(crf), "-preset", "medium", "-pix_fmt", "yuv420p");
      if (codec === "hevc") full.push("-tag:v", "hvc1");
    }
    if (alabel) {
      if (fmt === "webm") full.push("-c:a", "libopus", "-b:a", `${audioKbps || 192}k`);
      else full.push("-c:a", "aac", "-b:a", `${audioKbps || 192}k`);
    }
    if (fmt === "mp4" || fmt === "mov") full.push("-movflags", "+faststart");
    full.push("-t", outDur.toFixed(3), output);

    return await new Promise((resolve) => {
      const p = spawn(ffmpegPath, ["-progress", "pipe:1", "-nostats", ...full]);
      activeExport = p;
      cancelExportReq = false;
      let errBuf = "";
      p.stdout.on("data", (c) => {
        const m = String(c).match(/out_time_ms=(\d+)/g);
        if (m && m.length) {
          const t = parseInt(m[m.length - 1].split("=")[1], 10) / 1e6;
          win?.webContents.send("edit:progress", outDur ? Math.min(0.99, t / outDur) : 0);
        }
      });
      p.stderr.on("data", (d) => {
        errBuf += d;
        if (errBuf.length > 6000) errBuf = errBuf.slice(-6000);
      });
      p.on("close", (code) => {
        activeExport = null;
        tmpFiles.forEach((f) => {
          try {
            fs.unlinkSync(f);
          } catch {}
        });
        if (cancelExportReq) {
          cancelExportReq = false;
          try {
            if (fs.existsSync(output)) fs.unlinkSync(output);
          } catch {}
          resolve({ ok: false, cancelled: true });
          return;
        }
        if (code === 0 && fs.existsSync(output)) {
          win?.webContents.send("edit:progress", 1);
          resolve({ ok: true, output, size: fs.statSync(output).size });
        } else {
          const tail = errBuf.split("\n").filter(Boolean).slice(-4).join(" ");
          resolve({ ok: false, error: `Export failed (code ${code}). ${tail}` });
        }
      });
      p.on("error", (e) => {
        activeExport = null;
        resolve({ ok: false, error: e.message });
      });
    });
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
function clipEndSpec(c, lenOf) {
  return c.start + lenOf(c);
}

/* ---------------- IPC: thumbnail from a (semi-random) frame ---------------- */
ipcMain.handle("rec:thumb", async (_e, file) => {
  try {
    if (!ffmpegPath || !file || !fs.existsSync(file)) return "";
    let dur = 0;
    try {
      dur = JSON.parse(fs.readFileSync(file + ".meta.json", "utf-8")).durationSec || 0;
    } catch {}
    if (!dur) dur = await probeDuration(file);
    const ts = dur > 2 ? (dur * 0.15 + Math.random() * dur * 0.6).toFixed(2) : "0.3";
    const thumbsDir = path.join(app.getPath("userData"), "thumbs");
    fs.mkdirSync(thumbsDir, { recursive: true });
    const key = crypto.createHash("md5").update(file + fs.statSync(file).mtimeMs).digest("hex");
    const out = path.join(thumbsDir, key + ".jpg");
    if (!fs.existsSync(out)) {
      await previewGate(() =>
        ffmpegOnce(["-y", "-ss", String(ts), "-i", file, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "4", out], 20000)
      );
    }
    if (!fs.existsSync(out)) return "";
    return "file:///" + out.replace(/\\/g, "/");
  } catch {
    return "";
  }
});

/* ---------------- IPC: export the timeline as an MLT XML project ----------------
   Writes a .mlt file (the MLT framework's native project format) that opens in
   Shotcut or renders with `melt project.mlt -consumer avformat:out.mp4`. This is a
   STRUCTURAL export — tracks, clip positions, and source in/out points, plus basic
   video compositing + audio mixing. Per-clip effects/transitions/keyframes are not
   translated (MLT expresses them very differently); the user gets an editable
   project skeleton in Shotcut, not a 1:1 render of the AHG effect graph. */
ipcMain.handle("edit:exportMlt", async (_e, spec) => {
  try {
    const { tracks, clips, fps, width, height, outputName } = spec;
    if (!clips || !clips.length) return { ok: false, error: "Timeline is empty." };
    const FPS = fps || 30;
    const W = width || 1920;
    const H = height || 1080;
    const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const res = (p) => xmlEsc(String(p).replace(/\\/g, "/")); // MLT wants forward slashes
    const f = (sec) => Math.max(0, Math.round((sec || 0) * FPS)); // seconds → frame index
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const g = gcd(W, H) || 1;

    const lines = [];
    lines.push(`<?xml version="1.0" encoding="utf-8"?>`);
    lines.push(`<mlt LC_NUMERIC="C" version="7.0.0" producer="main">`);
    lines.push(`  <profile description="AHG ${W}x${H} ${FPS}fps" width="${W}" height="${H}" progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="${W / g}" display_aspect_den="${H / g}" frame_rate_num="${FPS}" frame_rate_den="1" colorspace="709"/>`);

    // One producer per media clip (keeps each clip's in/out independent).
    const prodId = new Map();
    let pn = 0;
    for (const c of clips) {
      if ((c.kind === "video" || c.kind === "audio") && c.path) {
        const pid = `producer${pn++}`;
        prodId.set(c.id, pid);
        const inF = f(c.in);
        const outF = Math.max(inF, f(c.out) - 1);
        lines.push(`  <producer id="${pid}" in="${inF}" out="${outF}">`);
        lines.push(`    <property name="resource">${res(c.path)}</property>`);
        lines.push(`    <property name="mlt_service">avformat</property>`);
        lines.push(`  </producer>`);
      }
    }
    // Background (black) so the bottom track always has something to composite over.
    const totalF = clips.reduce((m, c) => Math.max(m, f(c.start) + (f(c.out) - f(c.in))), 1);
    lines.push(`  <producer id="black" in="0" out="${Math.max(1, totalF - 1)}">`);
    lines.push(`    <property name="resource">0</property>`);
    lines.push(`    <property name="mlt_service">color</property>`);
    lines.push(`    <property name="length">${totalF}</property>`);
    lines.push(`  </producer>`);

    // One playlist per track. Order matters: MLT track 0 is the bottom layer, so we
    // emit base video first, overlays above, then audio — mirroring AHG's z-order.
    const videoTracks = tracks.filter((t) => t.kind === "video");
    const orderedVideo = videoTracks.length ? [videoTracks[videoTracks.length - 1], ...videoTracks.slice(0, -1).reverse()] : [];
    const audioTracksL = tracks.filter((t) => t.kind === "audio");
    const ordered = [...orderedVideo, ...audioTracksL];

    const playlistIds = [];
    ordered.forEach((t, ti) => {
      const plid = `playlist${ti}`;
      playlistIds.push({ id: plid, kind: t.kind });
      lines.push(`  <playlist id="${plid}">`);
      const tc = clips.filter((c) => c.trackId === t.id && (c.kind === "video" || c.kind === "audio") && c.path).sort((a, b) => a.start - b.start);
      let cursor = 0;
      for (const c of tc) {
        const startF = f(c.start);
        if (startF > cursor) {
          lines.push(`    <blank length="${startF - cursor}"/>`);
          cursor = startF;
        }
        const inF = f(c.in);
        const outF = Math.max(inF, f(c.out) - 1);
        lines.push(`    <entry producer="${prodId.get(c.id)}" in="${inF}" out="${outF}"/>`);
        cursor += outF - inF + 1;
      }
      lines.push(`  </playlist>`);
    });

    // Tractor: stack background + every playlist, composite video, mix audio.
    lines.push(`  <tractor id="tractor0" in="0" out="${Math.max(1, totalF - 1)}">`);
    lines.push(`    <track producer="black"/>`);
    for (const pl of playlistIds) lines.push(`    <track producer="${pl.id}"${pl.kind === "audio" ? ' hide="video"' : ""}/>`);
    // Video compositing: each video track (index ≥2, since 0=black,1=base) over the base.
    playlistIds.forEach((pl, i) => {
      const trackIndex = i + 1; // +1 for the black background track
      if (pl.kind === "video" && trackIndex >= 2) {
        lines.push(`    <transition>`);
        lines.push(`      <property name="a_track">1</property>`);
        lines.push(`      <property name="b_track">${trackIndex}</property>`);
        lines.push(`      <property name="mlt_service">qtblend</property>`);
        lines.push(`    </transition>`);
      }
      if (pl.kind === "audio") {
        lines.push(`    <transition>`);
        lines.push(`      <property name="a_track">0</property>`);
        lines.push(`      <property name="b_track">${trackIndex}</property>`);
        lines.push(`      <property name="mlt_service">mix</property>`);
        lines.push(`      <property name="sum">1</property>`);
        lines.push(`    </transition>`);
      }
    });
    lines.push(`  </tractor>`);
    lines.push(`</mlt>`);

    const out = path.join(outDir(), sanitizeName(outputName || "ahg-project") + ".mlt");
    fs.writeFileSync(out, lines.join("\n"), "utf8");
    return { ok: true, output: out, size: fs.statSync(out).size };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* --------- IPC: timeline filmstrip (one tiled strip per source, cached) ---------
   Generated in the MAIN process with ffmpeg so the renderer never decodes video
   frames on its main thread (that was the editor lag + missing-thumbnail cause).
   The renderer shows this single image as a CSS background, slicing [in,out]. */
ipcMain.handle("edit:filmstrip", async (_e, file) => {
  try {
    if (!ffmpegPath || !file || !fs.existsSync(file)) return null;
    let dur = 0;
    try {
      dur = JSON.parse(fs.readFileSync(file + ".meta.json", "utf-8")).durationSec || 0;
    } catch {}
    if (!dur) dur = await probeDuration(file);
    if (!dur || dur < 0.1) dur = 0.1;
    const count = Math.max(8, Math.min(360, Math.round(dur * 3))); // dense enough that zooming reveals new distinct frames
    const dir = path.join(app.getPath("userData"), "filmstrips");
    fs.mkdirSync(dir, { recursive: true });
    const key = crypto.createHash("md5").update(file + fs.statSync(file).mtimeMs + ":fs144:" + count).digest("hex");
    const out = path.join(dir, key + ".jpg");
    if (!fs.existsSync(out)) {
      const fps = count / dur;
      await previewGate(() =>
        ffmpegOnce(["-y", "-i", file, "-frames:v", "1", "-vf", `fps=${fps.toFixed(6)},scale=144:-2,tile=${count}x1`, "-q:v", "4", out], 60000)
      );
    }
    if (!fs.existsSync(out)) return null;
    return { url: "file:///" + out.replace(/\\/g, "/"), dur, count };
  } catch {
    return null;
  }
});

/* --------- IPC: audio waveform image (one per source, cached) --------- */
ipcMain.handle("edit:waveform", async (_e, file) => {
  try {
    if (!ffmpegPath || !file || !fs.existsSync(file)) return null;
    let dur = 0;
    try {
      dur = JSON.parse(fs.readFileSync(file + ".meta.json", "utf-8")).durationSec || 0;
    } catch {}
    if (!dur) dur = await probeDuration(file);
    const dir = path.join(app.getPath("userData"), "waveforms");
    fs.mkdirSync(dir, { recursive: true });
    const key = crypto.createHash("md5").update(file + fs.statSync(file).mtimeMs + ":wv2").digest("hex");
    const out = path.join(dir, key + ".png");
    if (!fs.existsSync(out)) {
      await previewGate(() =>
        ffmpegOnce(["-y", "-i", file, "-filter_complex", "showwavespic=s=1400x120:colors=#a78bfa", "-frames:v", "1", out], 60000)
      );
    }
    if (!fs.existsSync(out)) return null;
    return { url: "file:///" + out.replace(/\\/g, "/"), dur: dur || 0 };
  } catch {
    return null;
  }
});

/* ---------------- IPC: editing proxy (VFR→CFR, downscaled) ----------------
   The #1 cause of preview stutter + the playhead failing to track is VARIABLE
   FRAME RATE source footage (screen recordings, phone/YouTube rips): an HTML
   <video>'s currentTime↔frame mapping is unreliable on VFR, so the slaved
   preview desyncs. This builds a lightweight CONSTANT-FRAME-RATE, 720p H.264
   proxy (fast to decode, faststart) that the editor plays for smooth scrubbing,
   while the ORIGINAL is always used for the final export. Cached by source mtime
   so a given file is only ever converted once. */
const activeProxies = new Map(); // input → child process (so we can cancel)
ipcMain.handle("media:proxy", async (_e, input) => {
  try {
    if (!ffmpegPath || !input || !fs.existsSync(input)) return { ok: false };
    const dir = path.join(app.getPath("userData"), "proxies");
    fs.mkdirSync(dir, { recursive: true });
    const key = crypto.createHash("md5").update(input + fs.statSync(input).mtimeMs).digest("hex");
    const out = path.join(dir, key + ".mp4");
    const toUrl = () => ({ ok: true, path: out, url: "file:///" + out.replace(/\\/g, "/") });
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return toUrl();
    if (activeProxies.has(out)) return { ok: false, pending: true };
    const tmp = out + ".part";
    const args = [
      "-y",
      "-fflags", "+genpts", // rebuild timestamps for VFR sources
      "-i", input,
      "-vf", "scale=-2:720:flags=fast_bilinear", // 720p editing proxy
      "-vsync", "cfr", "-r", "30", // FORCE constant 30fps — kills VFR desync
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-g", "60", "-keyint_min", "60", // dense keyframes → snappy scrubbing/seeking
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
      "-movflags", "+faststart",
      tmp,
    ];
    const okCode = await new Promise((resolve) => {
      const p = spawn(ffmpegPath, args);
      activeProxies.set(out, p);
      let settled = false;
      const fin = (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(kill);
        activeProxies.delete(out);
        resolve(v);
      };
      const kill = setTimeout(() => {
        try { p.kill("SIGKILL"); } catch {}
        fin(false);
      }, 10 * 60 * 1000);
      p.stderr.on("data", () => {});
      p.on("close", (code) => fin(code === 0));
      p.on("error", () => fin(false));
    });
    if (!okCode) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      return { ok: false };
    }
    try { fs.renameSync(tmp, out); } catch {}
    return fs.existsSync(out) ? toUrl() : { ok: false };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
});

/* ---------------- IPC: save a screenshot ---------------- */
ipcMain.handle("shot:save", (_e, { buffer }) => {
  try {
    const dir = shotDir();
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\..+/, "");
    const file = path.join(dir, `Screenshot ${stamp}.png`);
    fs.writeFileSync(file, Buffer.from(buffer));
    return { path: file };
  } catch (e) {
    return { path: "", error: String(e) };
  }
});

/* ---------------- IPC: compress with ffmpeg ---------------- */
ipcMain.handle("compress:run", async (_e, opts) => {
  if (!ffmpegPath) return { ok: false, error: "FFmpeg not available." };
  const { input, codec, quality, scale, preset, format, outputName, fps, mute, audioKbps, stripMeta } = opts;
  if (!input || !fs.existsSync(input)) return { ok: false, error: "Input file not found." };

  const dir = path.dirname(input);
  const base = path.basename(input).replace(/\.[^.]+$/, "");
  const fmt = format || "mp4";
  const name = outputName ? sanitizeName(outputName) : `${base}-optimized`;
  const output = path.join(dir, `${name}.${fmt}`);
  const q = Math.max(20, Math.min(100, quality || 70));
  const crf = Math.round(33 - (q / 100) * 23);
  const presetMap = { fast: "veryfast", balanced: "medium", max: "slow" };
  const scaleFilter = scale === "1080" ? "scale=-2:1080" : scale === "720" ? "scale=-2:720" : "";
  const aKbps = Math.max(32, Math.min(320, audioKbps || 160));
  const fpsCap = fps && fps > 0 ? Math.round(fps) : 0; // 0 = keep source rate

  const total = await probeDuration(input);

  // Resolve a hardware encoder for this codec when enabled + available. Only for
  // mp4/mov/mkv (webm stays on CPU vp9, gif has no codec). If HW fails at runtime
  // we transparently retry on CPU below, so quality/compat is never sacrificed.
  let hwEnc = null;
  if (opts.hwAccel !== false && fmt !== "gif" && fmt !== "webm") {
    try {
      hwEnc = (await detectHwEncoders())[codec] || null;
    } catch {
      hwEnc = null;
    }
  }

  const buildArgs = (useHw) => {
    const a = ["-y", "-i", input];
    if (fmt === "gif") {
      const fps = 15;
      const vf = `fps=${fps},${scale === "same" ? "scale=640:-1" : scaleFilter}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
      a.push("-vf", vf, "-loop", "0", output);
      return a;
    }
    if (scaleFilter) a.push("-vf", scaleFilter);
    if (fpsCap) a.push("-r", String(fpsCap));
    if (stripMeta) a.push("-map_metadata", "-1");
    if (fmt === "webm") {
      a.push("-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf), "-row-mt", "1");
      if (mute) a.push("-an");
      else a.push("-c:a", "libopus", "-b:a", `${aKbps}k`);
      a.push(output);
      return a;
    }
    if (useHw && hwEnc) {
      a.push("-c:v", hwEnc, ...hwQualityArgs(hwEnc, crf, preset));
    } else {
      const lib = codec === "av1" ? "libsvtav1" : codec === "hevc" ? "libx265" : "libx264";
      a.push("-c:v", lib, "-crf", String(crf), "-preset", presetMap[preset] || "medium");
    }
    if (codec === "hevc") a.push("-tag:v", "hvc1");
    // yuv420p keeps output playable everywhere (10-bit / 4:4:4 sources otherwise
    // produce files some players + the in-app preview can't decode).
    a.push("-pix_fmt", "yuv420p");
    if (mute) a.push("-an");
    else a.push("-c:a", "aac", "-b:a", `${aKbps}k`);
    if (fmt === "mp4" || fmt === "mov") a.push("-movflags", "+faststart");
    a.push(output);
    return a;
  };

  const runOnce = (useHw) =>
    new Promise((resolve) => {
      const p = spawn(ffmpegPath, ["-progress", "pipe:1", "-nostats", ...buildArgs(useHw)]);
      activeCompress = p;
      cancelCompressReq = false;
      let outTime = 0;
      const onProgress = (chunk) => {
        const m = String(chunk).match(/out_time_ms=(\d+)/g);
        if (m && m.length) {
          outTime = parseInt(m[m.length - 1].split("=")[1], 10) / 1_000_000;
          const pct = total ? Math.min(0.99, outTime / total) : 0;
          win?.webContents.send("compress:progress", pct);
        }
      };
      p.stdout.on("data", onProgress);
      p.stderr.on("data", () => {});
      p.on("close", (code) => {
        activeCompress = null;
        if (cancelCompressReq) {
          cancelCompressReq = false;
          try {
            if (fs.existsSync(output)) fs.unlinkSync(output);
          } catch {}
          resolve({ ok: false, cancelled: true });
          return;
        }
        if (code === 0 && fs.existsSync(output)) {
          win?.webContents.send("compress:progress", 1);
          resolve({ ok: true, output, size: fs.statSync(output).size, encoder: useHw && hwEnc ? hwEnc : "cpu" });
        } else {
          resolve({ ok: false, error: `FFmpeg exited with code ${code}` });
        }
      });
      p.on("error", (err) => {
        activeCompress = null;
        resolve({ ok: false, error: err.message });
      });
    });

  let r = await runOnce(!!hwEnc);
  // Hardware encode failed (and the user didn't cancel) → fall back to CPU so an
  // optimize never just "fails" because of a flaky GPU encoder.
  if (!r.ok && !r.cancelled && hwEnc) {
    try {
      if (fs.existsSync(output)) fs.unlinkSync(output);
    } catch {}
    win?.webContents.send("compress:progress", 0);
    r = await runOnce(false);
  }
  return r;
});

// Cancel handlers — kill the active ffmpeg job; the close handler resolves cancelled.
ipcMain.handle("compress:cancel", () => {
  if (activeCompress) {
    cancelCompressReq = true;
    try {
      activeCompress.kill("SIGKILL");
    } catch {}
  }
  return true;
});
// Report which hardware encoders are usable (cached). Lets the Optimize UI show
// "GPU: NVENC" and lets the user opt out of hardware acceleration.
ipcMain.handle("compress:hwEncoders", async () => {
  try {
    return await detectHwEncoders();
  } catch {
    return { h264: null, hevc: null, av1: null, vendor: null };
  }
});
ipcMain.handle("edit:cancelExport", () => {
  if (activeExport) {
    cancelExportReq = true;
    try {
      activeExport.kill("SIGKILL");
    } catch {}
  }
  return true;
});

