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

## ONE VERSION EVERYWHERE (standing rule, 2026-08-01)

There is never more than one live version of anything. When something is upgraded,
the old copy is REPLACED, not left running alongside. Five places count, and the
phone is one of them:

1. workshop source (this folder)   2. Desktop studio folder
3. the INSTALLED Windows app        4. GitHub (`main` + the rolling `latest` release)
5. **the phone** — both the hosted app and the studio served from the PC

The phone is the one that silently breaks this rule, because a phone app is cached
ON the handset: publishing a new one does not remove the old one. `scripts/build-phone.mjs`
stamps a build tag into the service worker's cache name and into the bundle, the
service worker deletes the previous cache on activate and messages every open tab,
and the app reloads itself once. Settings shows the stamp so the running version can
always be read off the screen. **Never revert to a fixed cache name.**

The desktop equivalent is the gold sidebar badge. Both exist for the same reason: an
old build looks exactly like a new one, and the user has no other way to tell.

## Shipping rule (MANDATORY)

Whenever a completed change touches app code, docs, or resources, finish the
job by running `npm run ship` (scripts/ship.ps1). Work is NOT done until the
Desktop studio folder and GitHub both match the source. Ship once per
completed change/fix/upgrade — not after every individual file edit. If the
build or push cannot be run for any reason, explicitly tell the user their
change is NOT yet shipped and the Desktop exe is stale.

## THE LAST STEP IS MINE, NOT THE USER'S (hard rule, 2026-08-01)

The user's exact instruction: *"this is your job to get everything updated right
then and there... my mobile phone, my PC, and my GitHub. This is a hard rule after
everything, every upgrade, every change we make. Once it's done, that's the last thing
you do before you even report to me. And you don't even ask me this. You just tell me
that you did these three things."*

So, before reporting a change as done, all three are brought to the same version, in
this order, without asking:

1. **GitHub** — commit, push, merge to `main`, and confirm the build ran green and the
   rolling `latest` release actually carries the new exes AND all six docs. "Pushed" is
   not "shipped": read the release back and check the asset timestamps.
2. **The PC** — `npm run ship`, which builds, copies to the Desktop studio folder and
   updates the INSTALLED app in place.
3. **The phone** — the phone app is a separate public repo with its own Pages workflow;
   a push there publishes it. The service worker's build-stamped cache name is what makes
   the handset drop the old copy (see ONE VERSION EVERYWHERE).

Then report: say which three were updated, and what the user will see. Do not ask
permission for any of it.

### When a step genuinely cannot be done from here

Some sessions run on the user's Windows PC; others (Claude Code on the web) run in a
Linux container that can reach GitHub and nothing else on the machine. In a container,
step 2 is impossible — there is no Desktop, no installed app, no Windows to build on.

When that happens the rule does not become "give the user a list of chores". It becomes:

- Say plainly, in one sentence, that this session cannot reach their PC and why.
- Do every step that IS possible, in full. The GitHub half covers the exes and the docs,
  and the CI workflow already builds them — use it.
- Then make the remaining step require as close to zero human actions as physically
  possible, and prefer changing the software over instructing the user. The in-app
  updater (`update:install`, `src/main/selfUpdate.ts`) exists for exactly this reason:
  the app downloads its own installer, verifies it and runs it, so the answer is "click
  the button in the app you already have open" rather than a ten-step walkthrough
  involving a browser, a security warning and File Explorer.

**Never hand the user a manual procedure that a machine could have done.** If a walkthrough
is the best that can be offered, that is a bug in the software, and fixing it is the
work — not the walkthrough. The user does not code, and steps are where things break.

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

SIX files, all maintained on the SAME footing — the user's explicit instruction,
2026-08-01. Any change that touches app code, docs or resources updates every one of
these that it affects, in the SAME commit, and both workflows upload all six to the
rolling `latest` release so the download page can never serve a fresh exe beside a
stale instruction:

1. `docs/HOW-TO-USE.txt` — orientation, read first
2. `docs/NIHILPOINTZERO-GUIDE.txt` — the full manual
3. `docs/NIHILPOINTZERO-CHEATSHEET.txt` — the 1-pager
4. `docs/MEGA-DIAGNOSTIC-REPORT.md` — honest status of what works offline/online,
   and what is NOT built yet
5. `SETUP_GUIDE.md` — first-time setup
6. `UPDATE-MY-STUDIO.cmd` — the one-double-click updater (see below)

`BACKUP-NOW.cmd` ships with them and is checked the same way.

Write all of them in the same plain, non-technical voice.

**Why `UPDATE-MY-STUDIO.cmd` exists and must keep working.** Everything about
updating was already automatic except the last step, which was "open a terminal and
type `npm run ship`". That is not a step for somebody who does not code, and asking
for it anyway is how a laptop ends up three builds behind while GitHub and the phone
are current. The .cmd checks its tools, names the missing one, pulls, installs, runs
ship, and stops on the first failure rather than half-updating. If ship's steps ever
change, that file changes with it — it is the only route the user actually has.
