import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Label of the area being guarded (e.g. "Edit") for the fallback message. */
  area?: string;
  /** Bump this (e.g. the current page id) to auto-reset the boundary on navigation. */
  resetKey?: string;
}
interface State {
  error: Error | null;
}

/**
 * Catches render/runtime errors in a subtree so one bad page can't take down
 * the whole app. Shows a recoverable fallback with Retry / Reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Keep a breadcrumb in the console for diagnosis.
    console.error("[AHG] UI error caught by boundary:", error);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid h-full w-full place-items-center p-8">
          <div className="max-w-md rounded-2xl border border-line bg-panel p-6 text-center shadow-[var(--shadow-pop)]">
            <div className="text-[15px] font-700 text-ink">Something went wrong{this.props.area ? ` in ${this.props.area}` : ""}</div>
            <p className="mt-1.5 break-words text-[12.5px] leading-snug text-muted">{this.state.error.message || "An unexpected error occurred."}</p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                onClick={() => this.setState({ error: null })}
                className="focus-ring inline-flex h-9 items-center rounded-lg bg-accent px-4 text-[13px] font-600 text-[var(--on-accent)] transition-colors hover:bg-accent-strong"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="focus-ring inline-flex h-9 items-center rounded-lg border border-line bg-panel2 px-4 text-[13px] font-600 text-ink transition-colors hover:bg-hover"
              >
                Reload app
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
