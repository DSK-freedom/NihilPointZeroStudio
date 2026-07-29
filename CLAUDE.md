# NIHILPOINTZERO-OS (NihilPointZero Studio)

Electron desktop app for Windows x64: a video studio + financial content & analysis
engine that produces narrated videos in Roman Urdu / Urdu / English. The user is
non-technical — all user-facing docs are written in plain English.

**THE source of truth is THIS folder (`NihilPointZeroStudio-workshop`,
formerly `finscript-studio` — renamed 2026-07-21).** The exe on the Desktop
(inside the `NihilPointZeroStudio` folder) is a *build output* — never edit or
inspect it expecting current code. After code changes, a new build must be made and
shipped for the user to see them.

The `name` field in package.json stays `finscript-studio`: it determines the
installed app's data folder (`%APPDATA%\finscript-studio`) and install dir.
Changing it would orphan the user's installed-app data — never rename it.

## Commands

```
npm run dev        # run the app in dev mode (electron-vite)
npm run test       # vitest (tests are colocated: src/**/*.test.ts)
npm run lint       # eslint src
npm run dist:win   # full build -> release\ (portable exe + NSIS installer)
npm run ship       # test -> build -> copy exes+docs to Desktop studio -> git push -> update GitHub release downloads
```

Builds land in `release\` as `NIHILPOINTZERO-OS-portable.exe` and
`NIHILPOINTZERO-OS-setup.exe`. The live studio the user actually runs is
`%USERPROFILE%\Desktop\NihilPointZeroStudio\` (exes + the 4 docs +
`nihilpointzero-data`, which is user work — never write into or delete it).

## Shipping rule (MANDATORY)

Whenever a completed change touches app code, docs, or resources, finish the
job by running `npm run ship` (scripts/ship.ps1). Work is NOT done until the
Desktop studio folder and GitHub both match the source. Ship once per
completed change/fix/upgrade — not after every individual file edit. If the
build or push cannot be run for any reason, explicitly tell the user their
change is NOT yet shipped and the Desktop exe is stale. After shipping, remind
the user to run NIHILPOINTZERO-OS-setup.exe once to refresh the INSTALLED app.

## Architecture

electron-vite + React 19 + TypeScript + Tailwind. Three processes:

- `src/main/` — all real work happens here, exposed to the UI via `ipc.ts`
  (the large IPC surface) and `store.ts` (persistence). Domain modules:
  `agent/` (AI producer that plans+runs jobs), `analysis/` (financial math,
  PDF/XLSX parsing, backtests, ratios), `video/` + `scene/` + `director/`
  (rendering via bundled ffmpeg-static), `speech/` + `voice/` (offline Whisper
  STT through onnxruntime + @huggingface/transformers, bundled in
  `resources/models`), `llm/` (Anthropic + OpenAI SDKs), `audio/`, `image/`,
  `trends/`, `youtube/`, `webserver/`. Prompts live in `prompts.ts`.
- `src/renderer/src/` — React UI (`pages/`, `components/`, `hooks/`, `store/`).
- `src/preload/`, `src/shared/` — bridge and shared types.

## Hard rules

- **The AI features must NEVER delete user work** (videos, scripts, settings in
  the `nihilpointzero-data` folder). Deletion is user-initiated and always
  confirmed. Do not weaken this when touching agent/IPC code.
- The sidebar build badge (`v0.1.1 · date · git hash`) is written automatically
  at build time and is the user's only proof of which build runs. Don't break it.
- `electron-builder.yml` is heavily tuned (platform-binary diet, `asarUnpack`
  for ffmpeg/onnxruntime/pdfjs, `extraResources` for Whisper models and the
  audio pack, portable exe with NO fixed unpackDirName). Read its comments
  before changing packaging — several entries fix real past bugs.
- Code signing is currently OFF; the Azure Trusted Signing setup is documented
  in `docs/SIGNING.md` and commented in `electron-builder.yml`.

## Docs (shipped to the user, keep them in sync with changes)

`docs/HOW-TO-USE.txt` (orientation), `NIHILPOINTZERO-GUIDE.txt` (full manual),
`NIHILPOINTZERO-CHEATSHEET.txt` (1-pager), `MEGA-DIAGNOSTIC-REPORT.md` (honest
status of what works offline/online). Write these in the same plain,
non-technical voice.
