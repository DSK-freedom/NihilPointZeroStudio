# RESUME — where the work stands

**Read this first if you have no memory of the conversation.** The user's next message may
be nothing but the word "continue". This file has to be enough.

Kept current under the **NOTHING IS LOST** rule in `CLAUDE.md`. Update it as part of the
work, not afterwards: before starting anything long, and again when it lands. It lives in
the repo because the container, the assistant's memory and the harness task list all die
with the session — only what is pushed to GitHub survives.

Last updated: **2026-08-01, late evening** (after PR #13).

---

## The standing rules that govern every task

Read these in `CLAUDE.md` before doing anything, in this order. They are not background
colour; each was written after something went wrong.

- **THE LAST STEP IS MINE, NOT THE USER'S** — phone + PC + GitHub all brought to one
  version before reporting, without asking. Where a session cannot reach the PC, say so in
  one sentence and change the software so the remainder is one click. Never hand over a
  manual procedure a machine could run.
- **ONE VERSION EVERYWHERE** — five places, and the phone is the one that silently breaks
  the rule because a phone app is cached on the handset.
- **The six documents** — any change touching code, docs or resources updates every one of
  the six that it affects, in the SAME commit.
- **NOTHING IS LOST** — this file, and pushing at every coherent step.
- **The AI features must never delete user work.** This one does not bend.

## Where things stand

**Everything asked for is built, merged and shipped.** `main` is green across five
consecutive builds; the rolling `latest` release carries the two exes and all six
documents, re-uploaded by CI on every build.

Tonight's four merges, newest first:

| PR | What |
|---|---|
| #13 | Fixed the update notice that never appeared; added `Settings → Version` |
| #12 | Open with Windows, and update at sign-in |
| #11 | The app installs its own updates; the phone repo publishes itself |
| #10 | Items 18/19/20 — the last three of the twenty-seven |

Health at the last check: **1443 tests passing**, 0 lint errors, five clean typechecks,
`npm run build` succeeds, zero unreachable modules.

Five test files fail in a Linux container and this is **not** a defect: `xlsx` is installed
from a CDN tarball (`package.json` → `https://cdn.sheetjs.com/...`) that the sandbox proxy
blocks. They pass on the Windows CI runner. Do not "fix" them.

## In progress right now

**Verifying the build for `0c4da26` (PR #13).** Started 2026-08-01 ~19:59 UTC; a Windows
build takes about nine minutes.

Two things must be true before this can be called done, and the second is the one that
matters:

1. The run concluded `success` and the step **"Refresh the GitHub download"** ran.
2. The release notes now contain a line reading **`Build v0.1.1 · <date> <time> · <hash>`**.
   That line is the entire point of PR #13 — without it, no installed app can ever see an
   update. Read the release body back and look for it. Do not infer it from a green build.

How to check, from a container with no `gh` and no unauthenticated API access:
`mcp__github__actions_list` (parse the JSON from the saved tool-result file with python —
the response is too large to read inline) then `mcp__github__get_release_by_tag`.

If the `Build` line is missing, the fix is in `.github/workflows/windows-build.yml`: the
"Decide the build tag" step exports `NPZ_BUILD_TAG`, and the `gh release edit --notes`
heredoc must end with `Build $NPZ_BUILD_TAG` and nothing containing `*` after it.

## What the user still has to do, once each, and cannot be done from a container

- **PC:** open the app → the blue notice → **Get the update** → the download page → run
  `NIHILPOINTZERO-OS-setup.exe`. Their badge read `v0.1.1 · 2026-08-01 04:30 · 3354ec9` as
  of 19:50, i.e. they were still on the morning build and had accidentally re-run the stale
  installer from their Desktop folder. After PR #13's build lands, the notice will finally
  appear for them.
- **Phone:** Chrome → `dskjazz.github.io/nihilpointzero-phone` → ⋮ → Add to Home screen.
  Once only; the service worker keeps it current after that. The published Pages site
  cannot be fetched from this sandbox (proxy 403 on `github.io`), so the GitHub API is the
  only available evidence — say which is which rather than claiming the page was seen.

## Offered and awaiting a decision — do not start these unsolicited

Put to the user after PR #12; **no answer yet**. A background task notification is not an
answer.

1. **Wi-Fi-only guard on the sign-in auto-update.** Today it would download ~210 MB over a
   phone hotspot without asking. Ready to build.
2. **A copy of the user's work off the laptop.** Backups exist but the second home is
   likely another folder on the same machine; a dead laptop takes everything.
3. **Publish at the audience's actual peak hour** — join `channelLearn` (which already
   computes when the audience shows up) to the render queue.
4. **Code signing** (`docs/SIGNING.md`, Azure Trusted Signing, ~$10/month, currently off).
   The single biggest remaining source of friction: it is why every install shows "Windows
   protected your PC", and why a fully silent background install can be blocked by Smart
   App Control. **Cannot be started without the user** — it needs their Azure account.

## Traps worth knowing before touching this code

Each of these cost real time at least once.

- **`fileUrl()` must be called in the RENDERER, never in main.** In main it always produces
  `file:///`, which is dead on the phone. `src/shared/mediaUrl.ts` is the only place a disk
  path becomes a playable link.
- **`src/preload` must never import from `src/main`.** The web typecheck enforces it.
- **Five typechecks, not one:** `node`, `web`, `remote` (DOM types, no Node), `phone`,
  `phone-test`. A browser-incompatible import in the remote bridge fails only in `remote`.
- **A module with passing tests that nothing imports is not a feature.** Ten of the
  twenty-seven were finished, correct, and unreachable from the UI. Check the chain to a
  button before calling anything done.
- **`atempo` in the bundled ffmpeg accepts 0.5–100**, not the documented 0.5–2.0 — measured
  against the binary, not assumed. Only the 0.5 floor is enforced.
- **`zoompan` emits `d` frames per INPUT frame**, so feeding it a looped input explodes the
  frame count.
- **Release notes are a contract with the app**, not prose. `src/main/releaseNotes.test.ts`
  guards it; that test exists because the contract broke silently and cost the user an
  evening.

## The failure mode to design against, always

The bug in PR #13 was invisible for hours because the app's response to *"I could not read
that"* was byte-identical to its response to *"you are up to date"*: silence. Nothing
failed, nothing was logged, no test broke — two files simply stopped agreeing.

When adding anything that checks, compares or verifies: make "I could not tell" a distinct,
visible, logged outcome. Never let it render as success.
