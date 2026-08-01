# RESUME — where the work stands

**Read this first if you have no memory of the conversation.** The user's next message may
be nothing but the word "continue". This file has to be enough.

Kept current under the **NOTHING IS LOST** rule in `CLAUDE.md`. Update it as part of the
work, not afterwards: before starting anything long, and again when it lands. It lives in
the repo because the container, the assistant's memory and the harness task list all die
with the session — only what is pushed to GitHub survives.

Last updated: **2026-08-01, night** (after PR #17).

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
| #14 | The NOTHING IS LOST rule and this file |
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

**Nothing.** Everything asked for is built, merged, verified and published.

PR #13's build (`0c4da26`) was verified end to end: every step green, and the release notes
read back to confirm they now carry

```
Build v0.1.1 · 2026-08-01 20:03 · 0c4da26
```

which parses to `2026-08-01 20:03`, so an app stamped earlier will finally see it. The exe
from that run carries the same `20:03` stamp, so updating settles rather than looping.

### A transient worth knowing about before you panic

Mid-run, the release genuinely has **the docs but no exes**, for roughly ten seconds. It is
`gh release upload --clobber` deleting each asset before replacing it, and a 217 MB exe
takes far longer to re-upload than a text file. A read taken in that window shows a download
page with no application on it and the previous build's notes.

This happened during the PR #13 verification and read exactly like a catastrophe. It was
not. **Before reporting missing exes, read the release a second time** — and check whether
the job's final step has actually completed, rather than trusting a step that reports
success while later steps are still running.

Not worth engineering around (the window is short, and the alternative is uploading under
temporary names and renaming), but absolutely worth knowing.

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

## Corrections that cost real time today — do not repeat them

- **Anthropic is PAID.** Never recommend adding or replacing that key as a fix. The user's
  standing rule: paid features stay inert until he deliberately selects one. A saved key
  for a non-active provider is now not even contacted (`checkPaidKey` returns early).
  I also misread its red health line as a live fault and told him his output quality was
  capped by it. It was not — his active brain is `free`, by choice, and always was.
- **Ollama is local and has no rate limit.** It is slow on a CPU-only machine, not
  throttled. The 429s in his log are the free IMAGE service, which is hosted and unrelated.
- **He asked for identity rotation to evade free-tier limits. That was declined**, and the
  reasoning should hold: it means impersonating many users to take more than the service
  offers. The legitimate substitute is P4 below — honour `Retry-After`, back off with
  jitter, pace requests, cache, and use the free KEYED tiers (AI Horde, Pollinations).

## THE TELEPROMPTER INCIDENT — why the ship guard exists

Committed 04:13, shipped 04:30, and the installed app had **18 tabs where the code had 20**
(no Teleprompter, no Your Channel). `c81405e` is not an ancestor of the shipped `3354ec9`:
the ship ran from a tree that did not contain the work. Nothing failed — the tests passed
because they tested the tree being built, the exe was valid, the badge was honest. Only the
user noticing found it, days later.

`scripts/ship.ps1` now refuses to build when `git rev-list --count HEAD..origin/main` is
non-zero. If that guard is ever removed, this class of bug comes straight back.

## THE STANDING MANDATE (2026-08-02)

He has told me to stop asking and just work: plan, build, test, stress test, fix, and come
back only when it is done, with a detailed report. Work the queue below in order without
checking in. See DO NOT ASK in `CLAUDE.md` for the three narrow exceptions.

## Approved by the user, NOT yet built

1. **P4 — image 429 backoff.** Honour `Retry-After`, exponential backoff with jitter,
   pacing, caching. Replaces "5 fast retries then give up" (45 failures in his log).
2. **P3 — in-app YouTube API key walkthrough.** Free, 10k units/day. Without it the whole
   Your Channel tab and every evidence/trend feature is inert.
3. **P5 — nudge for a second backup home.** His is unset and his own restore log shows
   8 files had gone missing.
4. **Dead-brain switch notice.** When the active provider refuses permanently (the hosted
   free service returned HTTP 402 twice), say so plainly and move him to Ollama in one
   action. He must never be left pointed at a dead service failing 50 times in silence.
   Partly addressed by defaulting to Ollama, but an EXISTING install keeps its saved
   'free' setting, so the switch still has to happen for him.

## Autopilot — spine built, rest outstanding

`src/shared/autopilot.ts` (planner + approval gate) is done and merged. Still to do:
voice catalogue (only 4 Piper voices exist: 2 en_US, 2 ur_PK — he wants 20-30 incl. British
and kids), per-platform SEO metadata, wiring the planner to the render queue, and
evidence-backed title scoring from `channelLearn`.

**Automatic PUBLIC posting is gated by the platforms, not by our code.** Google locks
API-uploaded videos to private until the app passes verification; TikTok's Content Posting
API is the same until audit. There is no upload code yet at all — `youtube/index.ts` only
opens the browser upload page.

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
