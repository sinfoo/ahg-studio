import { createContext, useContext, type ReactNode } from "react";
import { useCapture } from "./useCapture";

type Capture = ReturnType<typeof useCapture>;
const CaptureContext = createContext<Capture | null>(null);

export function CaptureProvider({ children, recordActive = false }: { children: ReactNode; recordActive?: boolean }) {
  const cap = useCapture({ recordActive });
  return <CaptureContext.Provider value={cap}>{children}</CaptureContext.Provider>;
}

export function useCaptureCtx(): Capture {
  const c = useContext(CaptureContext);
  if (!c) throw new Error("useCaptureCtx must be used within CaptureProvider");
  return c;
}
