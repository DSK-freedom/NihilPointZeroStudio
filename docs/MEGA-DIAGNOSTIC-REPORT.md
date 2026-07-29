# NIHILPOINTZERO STUDIO — Status & Honest Capabilities

_What actually works, what needs internet, what needs a one-time setup, and what it
deliberately doesn't do. No hype — this is the "will it do X?" reference._

## Build: v0.1.1 · 2026-07-29 20:19
The running app shows this in the sidebar (under "OS") as a gold badge. The badge is now stamped
**automatically at build time** (version · build date+time · code id) — it can never be forgotten
or go stale by hand. If yours shows an older tag, you launched a stale copy — see **"If updates
don't show up"** at the bottom of this file.

## New in this build (2026-07-29)
- **🧭 A second AI helper — the STUDIO EXPERT — now floats on every tab**, separate from
  the 🎬 Producer. It knows the entire app and answers anything about it in whatever
  format you ask (bullet points · step-wise · precise clicks · fully detailed · brief —
  chips or your own words). Under each answer, "⚡ Execute these steps" turns the
  explanation into a validated action plan, and its Execute mode takes orders you write
  yourself — nothing runs until you click "▶ Run it", and it can never delete anything.
- **📱 MAKE SHORTS.** Every video in Video Studio now has a "Cut into vertical shorts"
  button: the app listens to the video (offline Whisper), picks the strongest moments —
  hooks, questions, concrete numbers — and cuts 1–5 vertical 9:16 clips with big
  burned-in captions, ready for YouTube Shorts / TikTok / Reels. It tells you why it
  picked each moment, and the clips land in the same list. Completely free and offline.
- **The 🎬 Producer button (bottom-right of EVERY tab) is now also your in-app guide.**
  Ask it "how do I…?" about anything — it knows every tab, every button and every
  workflow, and answers with exact click-paths instead of guesses. Two new buttons let
  you choose the answer length: **📖 Detailed** (full step-by-step) or **⚡ Brief**
  (quick bullets). It still does everything it did before: growth advice, rewriting your
  script/title (you approve with Apply), and "Do it" action plans you approve with Run.
- **A new `SETUP_GUIDE.md`** (in the project folder and on GitHub) explains, in plain
  English, how to install or run the portable app on ANY new machine — including USB and
  CD transfer rules — plus a developer section for building from source.
- **Storyboard Director can no longer say "could not turn that into shots".** If the AI
  fails to structure your script (common on the free backup AI), the Director now retries
  once with stricter instructions and then — if the AI still fails — builds the storyboard
  DIRECTLY from your script with no AI at all: timed pointers like "0-15s: …" or
  "0:15 to 0:40 …" (typos forgiven) become shots, [bracketed directions] become shots, and
  plain prose is split into speech-paced beats. Even a bare title yields an editable shot.
- **"Generate all scenes" now finishes the whole board in one click.** The free image
  service rate-limits parallel requests; generation is now paced to what it accepts, retries
  are spread out instead of hammering in lockstep, and any scenes that still fail are
  automatically retried in up to two extra passes — no more clicking "regenerate" one by one.
- **A building video can never silently vanish.** Builds always ran in the background (they
  keep going when you switch tabs, and the finished video lands in Video Studio) — but now
  the Activity Log records when a build STARTS, when it FINISHES, and — new — if it FAILS
  and why. If you ever wonder "where did my video go?", the Activity Log has the answer.
- **Scene Studio images are now downloadable.** Every generated scene has a "⬇ Save"
  button, and "⬇ Save all images" copies the whole storyboard, numbered in order, into a
  folder you pick — so you can use the pictures outside the studio too.
- **After building a scene video, two new buttons take you onward:** "🎥 Open in Video
  Studio" (voice, music, captions, export) and "✂ Edit in Timeline" (cut/trim/rearrange).
- **The Library now keeps EVERY generated picture automatically** (scene images and
  thumbnails), with new filter tabs: All · Ideas · Scripts · Images · Trash.
- **Deleting from the Library is no longer permanent.** "Delete" now moves items to a
  Trash Can; only YOU can restore or permanently remove them ("Delete forever" / "Empty
  Trash" ask for confirmation). Nothing in the app — the AI included — can destroy a
  library item.
- **The app now TELLS you when the free backup AI answered.** Before, if your chosen AI
  (Anthropic/OpenAI/Ollama) failed for any reason — wrong key, no credits, a typo in the
  model name — the app silently asked a free public AI instead and showed that answer as
  if nothing happened, which looked like "the AI got dumb". Now every such switch is
  written to the Activity Log in plain English (e.g. "Your anthropic AI failed — this
  answer came from the free AI instead"), including the technical reason. If answers seem
  weak, check the Activity Log first.
- **...and shows an amber WARNING BANNER on screen the moment it happens.** The banner
  names the AI that failed, shows the technical reason in small print, and links straight
  to Settings so a wrong/expired API key gets fixed in seconds instead of going unnoticed
  for weeks. Dismissing it hides it until the next failure.
- **The sidebar build badge now names the exact commit that was built.** It used to run
  one commit behind (the hash was read before the ship commit existed), which could make
  a perfectly current app look outdated when checked against the project history.
- **Model names are cleaned up automatically.** A pasted model name with an accidental
  space (e.g. " claude-sonnet-5") used to break every AI call invisibly; spaces are now
  removed when you save.
- **The Build line at the top of this file is now stamped automatically at ship time**
  and matches the sidebar badge's version and date (the badge additionally shows the
  exact commit that was built) — it can no longer drift out of date and wrongly tell
  you a stale app is current.

## New in the 2026-07-19 build
- **An INSTALLED version now exists** — run `NIHILPOINTZERO-OS-setup.exe` once (in the studio
  folder). It opens in ~2 seconds (no 60-90s unpack), taskbar pins are SAFE forever, and it uses
  the SAME `nihilpointzero-data` folder as the portable exe — same videos, scripts and settings
  in both. Keep the portable exe for USB travel; use the installed one day-to-day.
- **The exe went on a diet: 270 MB → 196 MB (–27%).** Mac/Linux binaries that could never run
  on Windows were being packaged; removed. Portable launches unpack faster too (~1.2 GB → 0.8 GB).
- **⏹ Stop is now instant in every stage.** Pressing Stop used to wait out the full retry cycle
  of an in-flight AI image download (up to minutes); it now aborts mid-download.
- **Real progress percentages.** Timeline renders, Storyboard renders and Stitch now show
  "Rendering 42% (0:34 / 1:20)" instead of raw ffmpeg text (Video Studio already had this).
- **Live PSX Data works offline now.** Every successful fetch is saved; if the PSX portal is
  unreachable, the app shows your last SAVED data with a clear amber "not live, fetched <date>"
  banner instead of a blank tab — and it retries once before giving up.
- **No more infinite hangs.** Every internet call in the app (free AI, images, music removal,
  music search, stock clips, news, currency, YouTube signals, voice download) now has a hard
  time limit — a dead connection fails with a clear message instead of hanging forever.
- **The whole source code is now under version control (git)** with the shipped build tag
  traceable to the exact code that produced it.

## Health check (last full sweep)
The whole app was reviewed file-by-file and machine-verified:
- **279 automated tests pass**, both TypeScript type-checks clean, full production build clean.
- 148 source files / ~19,000 lines; 101 app commands, all real (no dead/placeholder features).
- The video engine, audio graphs, and the finance math were checked against known-correct
  references and validated by actually running ffmpeg.
- A full read-only audit of every screen + IPC channel confirmed there are no missing/mis-wired
  handlers, and the AI paths fall back to the free brain when a provider is down.

## Latest fixes (build 2026-07-19-C)
- **Images now FOLLOW your script's `[bracketed cinematic directions]`.** A bug capped bracket
  parsing at 40 characters, so long shot descriptions were dropped and images were built from
  meaningless 5-word snippets of narration. Now each full direction becomes its own AI image
  (up to 30), and **"AI visuals (free)" is the default engine** in Video Studio.
- **"Only 1–2 of N images generated" is fixed.** The free image service used to fail with no
  retry; now every scene retries with backoff + a timeout and falls back to a faster model, so
  far more scenes come out with a real image (offline/very-busy still falls back to the animated look).
- **The ⏹ Stop button now stops EVERY stage** — voice, image downloads, and render — not just the
  final ffmpeg step (before, Stop did nothing while images were generating).
- **Natural voice (Piper) no longer drops your script.** A multi-paragraph script used to keep
  only the LAST line's audio; it's now synthesized in chunks and joined into one continuous track.
- **AI Director** now correctly labels the free online brain as "· free" (was mislabeled "· paid").

## The math is exact
SMA (20/50/200), Wilder RSI(14), % returns, correlation, and the flow↔price backtest all
match the standard textbook formulas and are unit-tested (RSI is even checked against the
published StockCharts worked example). The tools compute from real data and **never invent
numbers** — if a figure can't be derived, it says so.

## Bugs found and FIXED (verified)
- **Video generation** — the render used to balloon frames ~100× and crash; fixed, so videos
  now render at the correct length, fast. One bad image no longer aborts a build.
- **Audio** — added a peak limiter to every mix (no more clipping/distortion), set it to
  attenuate-only, and normalized sample-rate/channels before mixing (Piper voice + music no
  longer clash). "Replace background music" (was broken) works.
- **Burn-in captions** — fixed (now ships an explicit font, so they actually appear).
- **Narration** — the natural voice is the default when installed; the voice now reads
  UTF-8 correctly (em-dashes, curly quotes, Urdu, accents pronounced right).
- **Finance** — fundamentals auto-detect newest-first columns (no more backwards growth %).
- **Music removal (offline Demucs)** — fixed for folders with spaces in the path.
- **Data safety** — all saves are now atomic (a USB yank / crash mid-save can't wipe data);
  autosave added to every tab that holds work; the mic is released when you leave a tab.
- **AI reliability** — every AI feature falls back to the free hosted brain if your provider
  is down; idea output is validated so it can't crash or save garbage.

## What's REAL and works
- Make videos 3 ways (Producer "Do it" · Storyboard Director · Video Studio), Batch (many at once)
- **🎬 Producer that operates the app** — on any tab, "Do it" plans real actions and runs them
  after you approve (scripts, videos, thumbnails, images, music, ideas, PSX analysis, scenes).
  Safe validated actions only — it creates/edits, **never deletes**.
- Script / idea / thumbnail generation; AI Command & AI Director
- 🎞 Storyboard Director (shot-by-shot) + ✂ Timeline Editor (real NLE)
- Looks (Clean/News/Cinematic/Bold), 16:9 / 9:16 / 1:1, up to 8K
- Voice: your own recording, Natural (Piper), or Windows
- Music synth + DJ mixer (auto-duck + limiter), captions (.srt + burn-in), trim, stitch, export
- **📈 Live PSX Data** (real prices → analysis → Excel → script → video) and **Charts** (live or your file)
- **Photo Beautify** — retouches your REAL photo (skin/brightness/sharpen); it is a genuine
  retouch of your own pixels, not "AI makeup" and not a fabricated face.

## Real, but needs internet or a one-time setup
- **Needs internet** (keys already built in, nothing to sign up for): AI writing/ideas/advisor,
  AI images & visuals, "put me in a scene", online music removal.
- **Put me in a scene** — free, but the queue can be slow and the generated look **approximates**
  you; your true face is preserved by compositing your actual photo/clip, not by faking a face.
- **Natural voice (Piper)** — a one-time ~80 MB download (already done on this PC).
- **Offline music separation (Demucs)** — needs Python (already set up on this PC); not needed
  if you have internet (the Online button removes music).
- **YouTube signals / Pixabay stock footage** — optional free API keys in Settings.

## What it deliberately does NOT do (so you're never misled)
- **NCCPL live auto-fetch** — NCCPL's portal blocks automated access, so the app does NOT scrape
  it. Instead you download the FIPI/LIPI file yourself and upload it — then it's fully analysed.
- **A fabricated video of your real face** — not done on purpose; free AI can't guarantee a
  made-up face is truly you, so the app composites your real photo/clip instead.
- **One-click YouTube upload** — it prepares the title/description/tags and opens your upload
  page so you drop the file in (reliable + free). Full auto-upload would require Google app
  verification and force videos private until approved.
- **Automating a third-party charting site** (TradingView etc.) from a pasted URL — fragile and
  can't be accurate from a screenshot; the app charts real PSX data itself instead.
- **"Beautify" is a retouch, not plastic surgery** — it smooths/brightens/sharpens; it does not
  reshape hair/skin/muscles into someone else.

## Honest note on "bug-free forever"
The logic and math are tested and correct today. The parts that reach the internet (live PSX
prices, free AI services, online music removal) depend on those services staying up and
unchanged — if one changes, the app fails with a clear message rather than inventing a result.

## If updates don't show up (IMPORTANT — this wasted real time once)
The **portable exe** unpacks itself into a temporary folder on each launch and runs from there.
If you **pin the running portable app to the taskbar or Start**, Windows freezes that pin to the
*temporary* unpacked path — so it keeps launching an **old copy forever**, no matter how many
times the exe on disk is updated.

How to always run the newest build:
1. **Easiest fix: use the installed version** (`NIHILPOINTZERO-OS-setup.exe`, run once). It has
   no temp folder and no pin trap — pins always launch the current code, in ~2 seconds.
2. If using the portable exe: launch from the **Desktop shortcut** ("NIHILPOINTZERO-OS") or the
   **.exe in this folder** — never an old taskbar/Start pin.
3. Check the **build badge** in the sidebar (under "OS"). It should read the build at the top of
   this file. If it's older, you're on a stale copy.
4. If a taskbar/Start icon shows old code: **unpin it**, then pin the installed app or the
   Desktop shortcut instead.

_This is a snapshot of the current build. Re-run a check any time; the app tells you plainly
when something needs internet or setup._
