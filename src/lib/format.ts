export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function timecode(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const pad = (x: number) => x.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function mb(n: number) {
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n >= 1024) return `${(n / 1024).toFixed(2)} GB`;
  return `${n.toFixed(0)} MB`;
}

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
