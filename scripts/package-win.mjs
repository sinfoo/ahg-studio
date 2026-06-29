// Assembles a runnable Windows build into release/AHG Studio/ without electron-builder's
// code-signing toolchain (which needs Windows Developer Mode / admin to extract).
// Produces: release/AHG Studio/AHG Studio.exe  (portable folder — copy it anywhere, double-click).
import { cpSync, existsSync, mkdirSync, rmSync, renameSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const distSrc = join(root, "node_modules/electron/dist");

if (!existsSync(join(distSrc, "electron.exe"))) {
  console.error(
    "Electron runtime missing at node_modules/electron/dist/electron.exe.\n" +
      "Fix: node node_modules/electron/install.js\n" +
      "If that leaves dist empty, extract the cached zip from\n" +
      "  %LOCALAPPDATA%\\electron\\Cache\\electron-v*-win32-x64.zip\n" +
      "into node_modules/electron/dist with 7-Zip."
  );
  process.exit(1);
}
if (!existsSync(join(root, "dist/index.html"))) {
  console.error("Renderer not built. Run: npm run build");
  process.exit(1);
}

const out = join(root, "release", "AHG Studio");
rmSync(join(root, "release"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

console.log("Copying Electron runtime…");
cpSync(distSrc, out, { recursive: true });
renameSync(join(out, "electron.exe"), join(out, "AHG Studio.exe"));

const app = join(out, "resources", "app");
mkdirSync(join(app, "electron"), { recursive: true });
mkdirSync(join(app, "node_modules"), { recursive: true });

copyFileSync(join(root, "package.json"), join(app, "package.json"));
copyFileSync(join(root, "electron/main.cjs"), join(app, "electron/main.cjs"));
copyFileSync(join(root, "electron/preload.cjs"), join(app, "electron/preload.cjs"));
cpSync(join(root, "dist"), join(app, "dist"), { recursive: true });
cpSync(join(root, "build"), join(app, "build"), { recursive: true });
cpSync(join(root, "node_modules/ffmpeg-static"), join(app, "node_modules/ffmpeg-static"), {
  recursive: true,
});
cpSync(join(root, "node_modules/ffprobe-static"), join(app, "node_modules/ffprobe-static"), {
  recursive: true,
});

const def = join(out, "resources", "default_app.asar");
if (existsSync(def)) rmSync(def);

// Embed the app icon + metadata into the .exe so Explorer / taskbar show it.
const exe = join(out, "AHG Studio.exe");
const ico = join(root, "build", "icon.ico");
if (existsSync(ico)) {
  try {
    const mod = await import("rcedit");
    const rcedit = mod.rcedit || mod.default;
    await rcedit(exe, {
      icon: ico,
      "version-string": {
        ProductName: "AHG Studio",
        FileDescription: "AHG Studio — Screen & Optimize",
        CompanyName: "AHG",
        LegalCopyright: "© AHG",
        OriginalFilename: "AHG Studio.exe",
      },
      "file-version": "0.1.0.0",
      "product-version": "0.1.0.0",
    });
    console.log("Embedded icon + metadata into the exe.");
  } catch (e) {
    console.warn("rcedit step skipped:", e.message);
  }
}

console.log("Done → release/AHG Studio/AHG Studio.exe");
