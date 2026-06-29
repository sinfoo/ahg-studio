const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("studio", {
  isElectron: true,

  // Electron 32+ removed File.path — resolve a dropped File's real path here.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return (file && file.path) || "";
    }
  },

  // close guard
  onCloseRequest: (cb) => {
    const fn = () => cb();
    ipcRenderer.on("app:closeRequest", fn);
    return () => ipcRenderer.removeListener("app:closeRequest", fn);
  },
  confirmClose: () => ipcRenderer.send("app:confirmClose"),
  cancelClose: () => ipcRenderer.send("app:cancelClose"),

  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
    onState: (cb) => {
      const fn = (_e, v) => cb(v);
      ipcRenderer.on("window:state", fn);
      return () => ipcRenderer.removeListener("window:state", fn);
    },
  },

  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch) => ipcRenderer.invoke("settings:set", patch),
  },

  saveRecording: (buffer, ext, durationSec) =>
    ipcRenderer.invoke("rec:save", { buffer, ext, durationSec }),
  listRecordings: () => ipcRenderer.invoke("rec:list"),
  deleteRecording: (p) => ipcRenderer.invoke("rec:delete", p),
  recordingsDir: () => ipcRenderer.invoke("rec:dir"),
  openRecordingsDir: () => ipcRenderer.send("dir:open"),
  pickFile: () => ipcRenderer.invoke("file:pick"),
  pickImage: () => ipcRenderer.invoke("file:pickImage"),
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),
  reveal: (p) => ipcRenderer.send("file:reveal", p),
  openFile: (p) => ipcRenderer.send("file:open", p),
  openExternal: (url) => ipcRenderer.send("external:open", url),

  listSources: () => ipcRenderer.invoke("sources:list"),
  getMetrics: () => ipcRenderer.invoke("metrics:get"),

  applyStartup: (opts) => ipcRenderer.send("startup:apply", opts),
  renameRecording: (oldPath, newName) => ipcRenderer.invoke("rec:rename", { oldPath, newName }),
  remux: (input, container) => ipcRenderer.invoke("rec:remux", { input, container }),
  fixReplay: (p, fps) => ipcRenderer.invoke("rec:fixReplay", { input: p, fps }),
  generateThumb: (p) => ipcRenderer.invoke("rec:thumb", p),
  saveScreenshot: (buffer) => ipcRenderer.invoke("shot:save", { buffer }),

  registerHotkeys: (map) => ipcRenderer.send("hotkeys:register", map),
  onHotkey: (cb) => {
    const fn = (_e, action) => cb(action);
    ipcRenderer.on("hotkey:trigger", fn);
    return () => ipcRenderer.removeListener("hotkey:trigger", fn);
  },

  compress: (opts) => ipcRenderer.invoke("compress:run", opts),
  cancelCompress: () => ipcRenderer.invoke("compress:cancel"),
  detectHwEncoders: () => ipcRenderer.invoke("compress:hwEncoders"),
  makeProxy: (input) => ipcRenderer.invoke("media:proxy", input),
  cancelExport: () => ipcRenderer.invoke("edit:cancelExport"),
  onCompressProgress: (cb) => {
    const fn = (_e, v) => cb(v);
    ipcRenderer.on("compress:progress", fn);
    return () => ipcRenderer.removeListener("compress:progress", fn);
  },

  detectSilence: (input, noiseDb, minSilence) => ipcRenderer.invoke("edit:silence", { input, noiseDb, minSilence }),
  filmstrip: (p) => ipcRenderer.invoke("edit:filmstrip", p),
  waveform: (p) => ipcRenderer.invoke("edit:waveform", p),

  editExport: (input, segments, opts) => ipcRenderer.invoke("edit:export", { input, segments, opts }),
  exportTimeline: (spec) => ipcRenderer.invoke("edit:exportTimeline", spec),
  exportMlt: (spec) => ipcRenderer.invoke("edit:exportMlt", spec),
  onExportProgress: (cb) => {
    const fn = (_e, v) => cb(v);
    ipcRenderer.on("edit:progress", fn);
    return () => ipcRenderer.removeListener("edit:progress", fn);
  },
});
