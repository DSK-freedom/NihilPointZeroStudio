# RESUME FILE — full-sweep bug-fix round (2026-07-31)

If this session is interrupted, tell Claude: **"continue the sweep fixes — read RESUME-SWEEP-FIXES.md"**.

## Source of truth for the work list
56 adversarially-confirmed defects, full details in:
`C:\Users\SHOAIB~1\AppData\Local\Temp\claude\C--Users-Shoaib-Khan\cd246554-ce68-4f1f-862d-31de0bc51326\scratchpad\confirmed-findings.json`
(If that temp file is gone, the numbered list below still identifies each item; the raw
sweep output was at `...\tasks\w5967935p.output`.)

## DONE (committed in 0674f9f "WIP checkpoint")
- #1  VideoPage: mount loader no longer clobbers the restored draft (restoredContentRef)
- #2  VideoPage: handleSelect parks editor content on the outgoing source (no more wipes)
- #3  WriterPage: honest "Original in Library ✓ · edits kept here" badge
- #4  ScriptPad: save failures surface ("⚠ Not saved — …"), busy flag always clears
- #5  ScriptPad: pending autosave flushed on unmount/app-close
- #6  Timeline: dedicated audio file picker (timelinePickAudio channel + preload + UI)
- #7  DjStation: collision-proof clip ids (newClipId) instead of a counter reset at 0
- #8  SceneStudio: runIdRef — Resume can't revive the old worker pool (double requests)
- #9  SceneStudio: plan() over an existing board now confirms first
- #10 Nccpl: upload() no longer wipes analysis before the file dialog (cancel-safe)
- #11 Recorder: switching Camera/Screen calls stopEverything() (mic/camera released)
- #12 MicButton: in-flight guard — no second orphaned mic stream on double-click
- #13 MusicPicker previews: CSP media-src now allows https:
- #15 render.ts: file backgrounds loop (-stream_loop -1) so -shortest can't truncate
- #16 render.ts: planSlideshowShots — image floor beats the 12-shot cap (all 30 shown)
- #17/#47 video/index.ts: Piper narration wrapped; falls through to Windows voice
- #18 piper.ts: installed-check requires model AND .onnx.json config
- #19 piper.ts: sentence split no longer breaks decimals ("45.3" stays intact) + tests
- #20 piper.ts: downloadFile handles stream errors, removes truncated file
- #23 Settings: stock-key save guards against empty input (no more silent key wipe)
- #24 Settings: toggleWebServer/checkOllama try/finally (no stuck "Working…")
- #25 WriterPage: 4 MicButton handlers use functional setWriter (no overwrite)
- #27 Timeline Waveform: reads bytes via IPC (fetch(file://) never worked)
- #32 PsxPage: analyze() clears old analysis only after success
- #33 PsxPage: Excel/Script/build act on analyzedSym (displayed symbol)
- #35 ActivityLog: Clear uses a real confirm modal (double-click wipe removed)
- #36 Advisor: Clear-all uses the same confirm modal as single delete
- #37 Library: load failure shows error + stops "Loading…"; #54 all mutations toast on failure
- #43 useAutosave: failed write → status 'error' (+ SaveStatus union)
- #44 StudioContext: same; setIdeas/setWriter accept functional updaters
- #46 video/index.ts + aiCloud/videoEngine: stock/AI temp dirs cleaned on ALL paths
- #49 piper.ts: narration loop polls throwIfCancelled between chunks
- #50 WriterPage: psxStatus break-all (no page-wide horizontal scroll)
- #51 WriterPage: handleSaveThumbnail try/catch + cancel feedback
- #52 IdeasPage: MicButton handlers functional form
- #55 MicButton: "heard nothing" state instead of silent no-op
- ALSO: ErrorBoundary added (App.tsx) + aiErrorsRecordUi channel — one crashed tab can
  no longer blank the whole app; crashes land in Settings → Known issues log.
- Fixed test files: piperChunk.test.ts (+2 tests), slideshow.test.ts (+1), render.test.ts (+1),
  style.test.ts (updated file-bg assertion to looped input)

## SKIPPED deliberately (say so if asked)
- #14 (AI footage as images): NOT PRESENT in current code — backgroundVideo already routes it.
- #21/#22/#26 (progress state lost on tab switch, unstoppable long ops): needs a small
  shared build-progress store — design decision, not a one-liner. Still open.

## REMAINING (in priority order)
- #28 StoryboardPage:108 — user's chosen Style overwritten by AI pick after "Direct storyboard"
- #29 StoryboardPage:186 — render() doesn't check photo is set for subject.kind 'photo' beats
- #30 DirectorPage:88 — apply() sends the CURRENTLY-selected video, not the interpreted one
- #31 PresenterPage:131 — switching mode keeps stale presenterPath attached
- #34 ChartsPage:285 — script panel gated on `series`, so a restored script is invisible
- #38 VoiceRecorder:309 — punch-in silently discards take when camera toggle is on
- #39 MusicPicker:30 — late mount-suggest overwrites the user's own search results
- #40 TrimTimeline:56 — keyboard marker moves not clamped to [0, duration]
- #41 AssistantWidget:94 — auto-scroll guard `(nearBottom || open)` is always true
- #42 GuideWidget:97 — fallback answer appended to truncated stream (needs reset signal)
- #45 agentRunLock — AgentPage runs plans without taking the shared lock
- #48 speech/index.ts:26 — rejected transcriber promise cached forever (dictation dies)
- #53 DjStation:550 — left-column errors render only at bottom of right column
- #56 MusicTrackBar:55 — "Tap to choose a track…" tap starts a no-op 'move' drag instead

## FINISH SEQUENCE (mandatory)
1. `npx tsc --noEmit -p tsconfig.web.json` and `-p tsconfig.node.json`
2. `npm run test` (all ~437 tests must pass)
3. `npm run lint`
4. Commit, then `npm run ship`
5. Remind the user to run NIHILPOINTZERO-OS-setup.exe once.
6. Delete this file in the same ship once everything above is done.
