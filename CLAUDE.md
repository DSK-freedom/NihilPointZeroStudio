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
npm run build:bridge      # just the phone bridge -> out/remote/bridge.js
npm run typecheck:remote  # the bridge + preload + shared, with BROWSER types only
npm run typecheck:phone   # the standalone phone app
npm run ship       # test -> build -> copy exes+docs to Desktop studio -> git push -> update GitHub release downloads
```

Builds land in `release\` as `NIHILPOINTZERO-OS-portable.exe` and
`NIHILPOINTZERO-OS-setup.exe`. The live studio the user actually runs is
`%USERPROFILE%\Desktop\NihilPointZeroStudio\` (exes + the 4 docs +
`nihilpointzero-data`, which is user work — never write into or delete it).

## USER PREFERENCE (standing, 2026-07-31)

All future updates, changes, and upgrades must be synchronized automatically across
all environment directories (workshop source → Desktop studio → installed app →
GitHub) to save the user time. The user does not code; handle pathing and
synchronization autonomously. `npm run ship` already does all of this — including
updating the INSTALLED app in place (Smart App Control-safe) and refusing to ship
unless the automated UI click-through gate passes.

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
- `src/remote/` — the SAME preload, bundled for a phone browser with `electron`
  aliased to an HTTP/SSE stand-in. This is what makes the real studio run on the
  phone with the PC doing the work; see below.

## The studio on the phone (added 2026-08-01)

The desktop UI reaches the app through exactly one door: `src/preload/index.ts`.
`scripts/build-remote-bridge.mjs` bundles that same file for the browser with
`electron` → `src/remote/electron.ts`, so `out/renderer` — the *identical* build the
Electron window loads — runs in a phone browser and the PC does the work. **There is
no second version of any screen; do not create one.** A change to a page reaches the
phone automatically.

- `src/main/remote/registry.ts` records handlers by wrapping `ipcMain.handle` for the
  duration of `registerIpcHandlers()` (see `captureHandlers` in `main/index.ts`).
  `DENIED_CHANNELS` refuses PC-dialog channels with an explanation.
- `src/main/remote/events.ts` wraps the main window's `webContents.send` **once**; the
  desktop is always fed first and unconditionally.
- `src/shared/wire.ts` carries byte arrays and dates through JSON. Both ends run it.
- `src/shared/mediaUrl.ts` is the ONLY place a disk path becomes a playable link.
  Never hand-write `file:///` in a page again — it breaks the phone.
- `tsconfig.remote.json` typechecks all of it with DOM types and no Node, so a
  browser-incompatible import fails at build time rather than on a handset.

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
