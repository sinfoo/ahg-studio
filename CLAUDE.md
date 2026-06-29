# CLAUDE.md

Guidance for AI assistants (and contributors) working in this repository.

AHG Studio is a premium desktop **screen recorder + video optimizer + multi-track video editor** built with Electron, React, TypeScript, and bundled FFmpeg. See [README.md](README.md) for the feature overview and structure.

## Commits (required)

- **Use Conventional Commits.** Every commit message must start with a type and a concise, imperative subject:
  - `feat:` a new feature
  - `fix:` a bug fix
  - `docs:` documentation only
  - `refactor:` code change that neither fixes a bug nor adds a feature
  - `perf:` a performance improvement
  - `style:` formatting / non-functional code style
  - `test:` adding or fixing tests
  - `build:` / `chore:` build system, tooling, deps, or maintenance
  - Optional scope: `feat(editor): ...`, `fix(record): ...`. Use `!` or a `BREAKING CHANGE:` footer for breaking changes.
  - Example: `feat(timeline): add ripple trim`
- **No AI co-authorship.** Do NOT add `Co-Authored-By: Claude` (or any AI) trailers, and do not credit an AI as an author/contributor anywhere in the repo. Commits are authored solely by the human committer.

## Before committing

- Type-check and build must pass: `npm run build` (runs `tsc --noEmit` + `vite build`).
- Keep changes focused; match the existing code style.
