# AHG Studio — Design Tokens

Register: product. Pro-neutral premium. Dark-first + true light mode. OKLCH color.

## Color strategy
Restrained floor. Tinted-cool graphite neutrals + ONE accent (teal-cyan) for primary/active/selection. Red is a reserved semantic for the live recording state only. Green = ready/saved, amber = warning/dropped frames.

### Dark theme (default)
| Token | OKLCH | Usage |
|---|---|---|
| `--bg-base` | `0.16 0.012 256` | App background |
| `--bg-sunken` | `0.13 0.012 256` | Recessed wells, canvas matte |
| `--bg-panel` | `0.195 0.013 256` | Dock / panel surface |
| `--bg-panel-2` | `0.225 0.014 256` | Raised rows, inputs |
| `--bg-hover` | `0.265 0.015 256` | Hover state |
| `--border` | `0.30 0.015 256` | Dividers, dock edges |
| `--border-strong` | `0.40 0.02 256` | Emphasis borders, focus ring base |
| `--text` | `0.97 0.005 256` | Primary text |
| `--text-muted` | `0.72 0.012 256` | Labels, secondary |
| `--text-dim` | `0.55 0.012 256` | Metadata, hints |
| `--accent` | `0.74 0.12 195` | Primary action, active, selection |
| `--accent-strong` | `0.82 0.13 195` | Hover/emphasis on accent |
| `--rec` | `0.63 0.22 22` | Live recording ONLY |
| `--good` | `0.74 0.14 152` | Ready, saved, success |
| `--warn` | `0.80 0.14 80` | Warning, dropped frames |

### Light theme
Same roles, inverted lightness, chroma reduced near the extremes. Accent darkens to `0.55 0.13 195` for contrast on light surfaces. Red stays a strong `0.57 0.22 25`.

## Typography
- UI: `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`.
- Numerics (timecode, bitrate, sizes, FPS): `"JetBrains Mono", ui-monospace, monospace`, `font-variant-numeric: tabular-nums`.
- Fixed rem scale, ratio ~1.2: 12 / 13 / 14 / 16 / 18 / 22 / 28 / 36.
- Weight contrast: 400 body, 500 labels, 600 headings, 700 display/timecode.

## Radius
`6px` inputs/chips · `10px` docks/cards/buttons · `14px` modals/large panels · `999px` pills/knobs.

## Elevation
Restrained. Panels separate by surface tint + 1px border, not heavy shadow. One soft shadow for floating menus (`0 12px 32px oklch(0 0 0 / 0.45)` dark). Accent focus ring: `0 0 0 2px var(--bg-base), 0 0 0 4px var(--accent)`.

## Motion
- 150-220ms, ease-out (cubic-bezier(0.22,1,0.36,1)).
- State only (hover, select, reveal, meters). No decorative loops except: the splash reveal, the live REC pulse, and audio VU meters.
- `prefers-reduced-motion`: meters freeze, transitions collapse to 0.01ms.

## Signature components
- **Dock**: rounded panel, header (title + optional action) + body. The single repeating chrome that organizes the multi-dock studio.
- **REC pill**: pulsing red dot + mono timecode. The one place red appears.
- **VU meter**: horizontal level bar, green→amber→red zones, peak tick.
- **Before/After split**: draggable divider comparing original vs optimized frame, with size + estimated VMAF readout.
- **Segmented control**: for FPS (30/60/120/144/custom) and rate-control mode.
- **Settings row**: label + control + hint, advanced options behind a disclosure.
