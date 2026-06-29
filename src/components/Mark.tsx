/* AHG Studio mark: a capture aperture wrapping a record core.
   Aperture = screen capture, center dot = record. Single accent, no glow. */
export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="13.5" stroke="var(--accent)" strokeWidth="2.2" opacity="0.5" />
      <g stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round">
        <path d="M16 4.5 22 9.7" />
        <path d="M27.5 16 21.3 19" />
        <path d="M16 27.5 10 22.3" />
        <path d="M4.5 16 10.7 13" />
      </g>
      <circle cx="16" cy="16" r="5" fill="var(--accent)" />
    </svg>
  );
}
