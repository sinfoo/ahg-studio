import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloseGuard } from "./components/CloseGuard";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ExportOverlay } from "./components/ExportOverlay";
import { NavRail } from "./components/NavRail";
import { OptimizeOverlay } from "./components/OptimizeOverlay";
import { Splash } from "./components/Splash";
import { TitleBar } from "./components/TitleBar";
import { Toaster } from "./components/Toaster";
import type { FileRef, RecFile } from "./lib/bridge";
import { CaptureProvider } from "./hooks/CaptureContext";
import { cx } from "./lib/format";
import { Edit } from "./pages/Edit";
import { Library } from "./pages/Library";
import { Optimize } from "./pages/Optimize";
import { Record } from "./pages/Record";
import { Settings } from "./pages/Settings";

export type Page = "record" | "optimize" | "edit" | "library" | "settings";

export default function App() {
  const [booted, setBooted] = useState(false);
  const [page, setPage] = useState<Page>("record");
  const [sendToOptimize, setSendToOptimize] = useState<FileRef | null>(null);
  // Batch of files chosen in the Library to import into the Edit bin (a new array
  // identity each time signals Edit to ingest it).
  const [importToEdit, setImportToEdit] = useState<FileRef[] | null>(null);
  // When the Library is opened as a PICKER from the Edit media bin.
  const [libraryPick, setLibraryPick] = useState(false);

  // Keep-alive: a page mounts on first visit and then stays mounted (hidden when
  // inactive). This preserves in-progress work (the editor timeline) across tabs
  // and removes the remount lag that came from rebuilding heavy pages each switch.
  // The Library is pre-mounted so it (and its thumbnails) are ready instantly.
  const visited = useRef<Set<Page>>(new Set(["record", "library"]));
  // Mark the current page visited in an effect (not during render) to keep render
  // pure. Once visited, a page stays mounted — same keep-alive behavior as before.
  useEffect(() => {
    visited.current.add(page);
  }, [page]);

  const optimizeClip = useCallback((ref: FileRef) => {
    setSendToOptimize(ref);
    setPage("optimize");
  }, []);

  // Open the Library as a multi-select picker (from the Edit media bin).
  const openLibraryPicker = useCallback(() => {
    setLibraryPick(true);
    setPage("library");
  }, []);
  // Library → Edit: ingest the chosen recordings into the Edit bin, then jump to
  // Edit. A fresh array identity each call so Edit's import effect always fires.
  const importFromLibrary = useCallback((files: RecFile[]) => {
    if (files.length) setImportToEdit(files.map((f) => ({ name: f.name, path: f.path, sizeMb: f.sizeMb })));
    setLibraryPick(false);
    setPage("edit");
  }, []);
  const cancelLibraryPick = useCallback(() => {
    setLibraryPick(false);
    setPage("edit");
  }, []);

  // Each page node is memoized on its OWN inputs so that navigating between tabs
  // does NOT re-render the other (heavy) pages. Only the page whose `active`
  // flips, or whose data changes, re-renders. This kills the per-navigation lag
  // that came from rebuilding every page's element on each App render.
  const recordActive = page === "record";
  const editActive = page === "edit";
  const libraryActive = page === "library";
  const recordNode = useMemo(() => <Record onOptimizeLast={optimizeClip} active={recordActive} />, [optimizeClip, recordActive]);
  const optimizeNode = useMemo(() => <Optimize incoming={sendToOptimize} />, [sendToOptimize]);
  const editNode = useMemo(() => <Edit incoming={null} importBatch={importToEdit} onOpenLibrary={openLibraryPicker} active={editActive} />, [editActive, importToEdit, openLibraryPicker]);
  const libraryNode = useMemo(
    () => <Library active={libraryActive} pickMode={libraryPick} onImport={importFromLibrary} onCancelPick={cancelLibraryPick} />,
    [libraryActive, libraryPick, importFromLibrary, cancelLibraryPick]
  );
  const settingsNode = useMemo(() => <Settings />, []);
  const pages: { id: Page; node: React.ReactNode }[] = [
    { id: "record", node: recordNode },
    { id: "optimize", node: optimizeNode },
    { id: "edit", node: editNode },
    { id: "library", node: libraryNode },
    { id: "settings", node: settingsNode },
  ];

  return (
    <CaptureProvider recordActive={recordActive}>
      <div className="flex h-screen flex-col overflow-hidden bg-base text-ink">
        <AnimatePresence>{!booted && <Splash onDone={() => setBooted(true)} />}</AnimatePresence>
        <Toaster />
        <OptimizeOverlay />
        <ExportOverlay />
        <CloseGuard />

        <TitleBar onNavigateSettings={() => setPage("settings")} />

        <div className="flex min-h-0 flex-1">
          <NavRail current={page} onNavigate={setPage} />

          <main className="relative min-w-0 flex-1 overflow-hidden">
            {pages.map(({ id, node }) =>
              // Mount the active page immediately, and keep any previously-visited
              // page mounted (the effect records visits after render).
              visited.current.has(id) || id === page ? (
                // Display toggle (not an opacity cross-fade). Cross-fading kept two
                // full pages composited at once, which on a fast tab switch left
                // ghosted/corrupted layers (the stray toggle + scrollbar artifacts).
                // Hiding the inactive page outright is both glitch-proof and faster,
                // and React keeps it mounted so in-progress work is preserved.
                <div
                  key={id}
                  className={cx("absolute inset-0 h-full", page === id ? "z-10 animate-[fadein_.14s_ease]" : "hidden")}
                  aria-hidden={page !== id}
                >
                  <ErrorBoundary area={id} resetKey={page}>
                    {node}
                  </ErrorBoundary>
                </div>
              ) : null
            )}
          </main>
        </div>
      </div>
    </CaptureProvider>
  );
}
