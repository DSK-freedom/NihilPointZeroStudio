import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, extname, join } from 'path'
import { IPC } from '../shared/ipc-channels'
import type {
  AdvisorRequest,
  IdeaGenRequest,
  LLMProviderId,
  LibraryEntry,
  ScriptGenRequest,
  VideoBuildRequest
} from '../shared/types'
import { getActiveProvider } from './llm'
import { getOllamaStatus, ollamaChatStream, type ChatTurn } from './llm/ollama'
import { buildAdvisorSystemPrompt } from './prompts'
import { APP_GUIDE } from './appGuide'
import { getAvailableUpdate, tagDate } from './updateCheck'
import { runHealthCheck } from './health'
import { generateIdeasFlow, generateScriptFlow } from './services'
import { synthesizeSpeechToFile } from './voiceover'
import { analyzeImportedFile, correlateFlowWithPrice, parseSpreadsheetFile } from './analysis'
import { buildPriceSeriesFromBars } from './analysis/priceSeries'
import { buildPriceSeries } from './analysis/priceSeries'
import { extractPdfText, summarizeStatement } from './analysis/pdf'
import { attachRecordedVoice, beautifyImage, buildVideoFromScript, exportVideo, ffprobeDuration, formatExtension, renderThumbnail, renderTimeline, setVideoMusic, stitchVideos, trimVideo } from './video'
import { cancelActiveFfmpeg, ffprobeVideoSize, runFfmpeg } from './video/ffmpeg'
import { buildWatermarkArgs, type WatermarkPosition } from './video/watermark'
import { makeSeparationScratch, separateLocal, separateOnline } from './audio/separate'
import { deriveTitleFromFilename, normalizeScriptText } from './video/scriptText'
import { renderMixToAudio, renderMusic, renderSfx, remixVideoAudio } from './audio'
import { assembleVoice } from './audio/voiceAssemble'
import { executeActions, interpretInstruction } from './director'
import { executeAgentPlan, interpretCommand, runBatch, sanitizeAgentPlan } from './agent'
import { extractJson } from './director'
import { buildStoryboardPrompt, sanitizeStoryboard, storyboardFromScript } from './video/storyboard'
import { buildShortArgs, pickShortMoments } from './video/shorts'
import { renderStoryboard } from './video/storyboardRender'
import { planPresenterStoryboard, type PresenterMode } from './video/presenter'
import { renderGraftPreview, renderGraftVideo, runGraftTool, sanitizeGraftRegion } from './video/graft'
import type { GraftRegion } from '../shared/types'
import { buildEnhanceArgs } from './video/enhance'
import { generateSceneImage, planScenes } from './scene'
import { downloadPiper, isPiperInstalled } from './voice/piper'
import { buildUploadUrl, generatePublishMeta } from './youtube'
import { generateFromPhoto } from './image/horde'
import { generateVideoPlan } from './director/planner'
import { downloadTrack, searchMusic } from './data/freeMusic'
import { generatedAudioDir, getAiVideoConfig, getStockConfig, setAiVideoConfig, setStockKey, thumbnailsDir } from './store'
import { isCloudConfigured } from './video/aiCloud'
import { detectLocal } from './video/aiLocal'
import type {
  AgentPlan,
  AiVideoConfig,
  AudioClip,
  AudioPlan,
  DirectorAction,
  ExportFormat,
  Mood,
  SfxKind,
  StoryboardDoc,
  TimelineDoc,
  TrimMode,
  VideoJob,
  VideoStyle
} from '../shared/types'
import { transcribeAudio, transcribeFileToSegments } from './speech'
import { buildBurnSubsArgs, buildSrt } from './video/captions'
import { fetchPsxDocument, PsxFetchError } from './data/psxFetch'
import {
  analyzePsxBars,
  buildPsxWorkbook,
  fetchPsxEod,
  fetchPsxEodDetailed,
  normalizeSymbol,
  setPsxCacheDir,
  summarizePsxAnalysis
} from './data/psxLive'
import { buildAnalysisScriptPrompt, type AnalysisKind, type ScriptDirectives } from './data/analysisScript'
import { getWebServerStatus, startWebServer, stopWebServer } from './webserver'
import {
  appendChat,
  appendVideo,
  clearActivityLog,
  clearChat,
  deleteChatMessage,
  deleteDjPlan,
  deleteFromLibrary,
  deleteVideo,
  emptyLibraryTrash,
  getDemucsCmd,
  getDraft,
  getHordeApiKey,
  getModel,
  getMvsepToken,
  getFaceAnimCmd,
  getScriptPad,
  getSettings,
  getYouTubeChannelId,
  setDemucsCmd,
  setFaceAnimCmd,
  setDraft,
  setHordeApiKey,
  setMvsepToken,
  setYouTubeChannelId,
  listActivityLog,
  listChat,
  listDjPlans,
  listLibrary,
  listVideos,
  logActivity,
  restoreLibraryEntry,
  saveDjPlan,
  saveScriptPad,
  saveToLibrary,
  trashLibraryEntry,
  setActiveProvider,
  setApiKey,
  setModel,
  setYouTubeApiKey,
  videosDir
} from './store'

export function registerIpcHandlers(): void {
  // Last-good PSX data cache lives with the rest of the user's data (travels with the
  // portable folder). psxLive.ts takes the dir by injection so it stays Electron-free.
  setPsxCacheDir(join(app.getPath('userData'), 'psx-cache'))

  ipcMain.handle(IPC.settingsGet, () => getSettings())

  ipcMain.handle(IPC.settingsSetProvider, (_e, provider: LLMProviderId) => {
    logActivity('user', 'Changed active provider', provider)
    return setActiveProvider(provider)
  })

  ipcMain.handle(IPC.settingsSetModel, (_e, provider: LLMProviderId, model: string) => {
    logActivity('user', `Changed ${provider} model`, model)
    return setModel(provider, model)
  })

  ipcMain.handle(IPC.settingsSetApiKey, (_e, provider: LLMProviderId, key: string) => {
    logActivity('user', `${key ? 'Updated' : 'Removed'} ${provider} API key`)
    return setApiKey(provider, key)
  })

  ipcMain.handle(IPC.settingsSetYouTubeKey, (_e, key: string) => {
    logActivity('user', `${key ? 'Updated' : 'Removed'} YouTube API key`)
    return setYouTubeApiKey(key)
  })

  ipcMain.handle(IPC.ollamaStatus, () => getOllamaStatus())

  ipcMain.handle(IPC.ideasGenerate, (_e, req: IdeaGenRequest) => generateIdeasFlow(req))

  ipcMain.handle(IPC.scriptGenerate, (e, req: ScriptGenRequest) =>
    // Feature-length generation is 12-20 sequential model calls (can exceed an
    // hour on local Ollama); stream chaptering progress to the originating window.
    generateScriptFlow(req, (stage) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.scriptProgress, stage)
    })
  )

  ipcMain.handle(IPC.thumbnailGenerate, async (_e, topic: string, title: string) => {
    const provider = getActiveProvider()
    const brief = await provider.generateThumbnailBrief(topic, title)
    logActivity('ai', 'Generated thumbnail brief', title || topic)
    return brief
  })

  // Renders an actual thumbnail IMAGE (1280x720 PNG) from a headline + style. Free,
  // offline. Returns the file path so the renderer can preview it via file://.
  ipcMain.handle(IPC.thumbnailRender, async (_e, headline: string, style: VideoStyle, bgImage?: string) => {
    const outPath = join(thumbnailsDir(), `thumb-${randomUUID().slice(0, 8)}.png`)
    await renderThumbnail(headline, style, outPath, bgImage)
    logActivity('user', 'Generated a thumbnail image', headline)
    saveToLibrary({
      id: randomUUID(),
      kind: 'image',
      data: { title: headline.slice(0, 80) || 'Thumbnail', path: outPath, source: 'Thumbnail' },
      savedAt: new Date().toISOString()
    })
    return outPath
  })

  // Saves a copy of a generated thumbnail wherever the user chooses.
  ipcMain.handle(IPC.thumbnailSave, async (_e, srcPath: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Save thumbnail',
      defaultPath: 'thumbnail.png',
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })
    if (res.canceled || !res.filePath) return { saved: false }
    try {
      copyFileSync(srcPath, res.filePath)
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : 'Could not save the file.' }
    }
    logActivity('user', 'Saved a thumbnail image', res.filePath)
    return { saved: true, path: res.filePath }
  })

  ipcMain.handle(IPC.libraryList, () => listLibrary())

  ipcMain.handle(IPC.librarySave, (_e, entry: Omit<LibraryEntry, 'id' | 'savedAt'>) => {
    logActivity('user', `Saved ${entry.kind} to library`, (entry.data as { title: string }).title)
    return saveToLibrary({ ...entry, id: randomUUID(), savedAt: new Date().toISOString() })
  })

  // "Delete" is now reversible: it only moves the entry to the Trash Can. Permanent
  // removal happens ONLY via the two explicit user actions below — nothing else in the
  // app (AI included) can destroy a library item.
  ipcMain.handle(IPC.libraryDelete, (_e, id: string) => {
    logActivity('user', 'Moved library item to Trash', id)
    return trashLibraryEntry(id)
  })

  ipcMain.handle(IPC.libraryRestore, (_e, id: string) => {
    logActivity('user', 'Restored library item from Trash', id)
    return restoreLibraryEntry(id)
  })

  ipcMain.handle(IPC.libraryDeleteForever, (_e, id: string) => {
    logActivity('user', 'Permanently deleted library item', id)
    return deleteFromLibrary(id)
  })

  ipcMain.handle(IPC.libraryEmptyTrash, () => {
    logActivity('user', 'Emptied the Library Trash')
    return emptyLibraryTrash()
  })

  ipcMain.handle(IPC.exportText, async (e, suggestedName: string, content: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions = {
      defaultPath: suggestedName,
      filters: [{ name: 'Text', extensions: ['txt'] }, { name: 'Markdown', extensions: ['md'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions)
    if (result.canceled || !result.filePath) return { saved: false }
    try {
      writeFileSync(result.filePath, content, 'utf-8')
    } catch (err) {
      // Match the other save handlers: return a structured error instead of
      // rejecting the invoke (which would surface as an unhandled rejection with
      // no user-visible message, making a failed export look like a success).
      return { saved: false, error: err instanceof Error ? err.message : 'Could not save the file.' }
    }
    logActivity('user', 'Exported script to file', result.filePath)
    return { saved: true, path: result.filePath }
  })

  ipcMain.handle(IPC.voiceoverGenerate, async (e, text: string, suggestedName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions = {
      defaultPath: suggestedName,
      filters: [{ name: 'WAV Audio', extensions: ['wav'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions)
    if (result.canceled || !result.filePath) return { saved: false }
    await synthesizeSpeechToFile(text, result.filePath)
    logActivity('ai', 'Generated voiceover', result.filePath)
    return { saved: true, path: result.filePath }
  })

  // Parse a user-picked price file (CSV/Excel — e.g. a PSX price export) into an OHLC
  // series with SMA/RSI overlays computed by the unit-tested analysis math, for the
  // in-app charts. No account, no scraping — your data, your math.
  ipcMain.handle(IPC.chartPriceFile, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Choose a price file (CSV / Excel)',
      properties: ['openFile'],
      filters: [{ name: 'Price data', extensions: ['csv', 'xlsx', 'xls'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    if (res.canceled || !res.filePaths[0]) return { canceled: true }
    try {
      const sheet = parseSpreadsheetFile(res.filePaths[0])
      const series = buildPriceSeries(sheet)
      logActivity('user', 'Charted a price file', basename(res.filePaths[0]))
      return { canceled: false, series, name: basename(res.filePaths[0]) }
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : 'Could not read that file.' }
    }
  })

  ipcMain.handle(IPC.dataImportFile, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheets', extensions: ['csv', 'xlsx', 'xls'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const filePath = result.filePaths[0]
    try {
      const analysis = analyzeImportedFile(filePath, basename(filePath))
      logActivity('user', 'Imported file for analysis', `${analysis.fileName} (${analysis.kind})`)
      return { canceled: false, analysis }
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : 'Failed to parse file' }
    }
  })

  ipcMain.handle(IPC.dataFetchPsxDocument, async (e, url: string) => {
    let buffer: Buffer
    let fileName: string
    try {
      ;({ buffer, fileName } = await fetchPsxDocument(url))
    } catch (err) {
      return { canceled: false, error: err instanceof PsxFetchError ? err.message : 'Failed to fetch document' }
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions = { defaultPath: fileName }
    const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions)
    if (result.canceled || !result.filePath) return { canceled: true }
    try {
      writeFileSync(result.filePath, buffer)
    } catch (err) {
      // Honour the PsxFetchResult contract's `error` field instead of throwing.
      return { canceled: false, error: err instanceof Error ? err.message : 'Could not save the document.' }
    }
    logActivity('user', 'Fetched document from PSX', `${fileName} <- ${url}`)

    const ext = result.filePath.split('.').pop()?.toLowerCase()
    if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') {
      try {
        const analysis = analyzeImportedFile(result.filePath, basename(result.filePath))
        return { canceled: false, savedPath: result.filePath, analysis }
      } catch {
        // Saved fine, just isn't a shape we can analyze — still a success.
      }
    }
    if (ext === 'pdf') {
      // Financial statements from PSX are usually PDFs. Extract their text +
      // detectable figures so the Writer can reason from real numbers. Uses the
      // buffer we already fetched (no re-read); failures are non-fatal.
      try {
        const text = await extractPdfText(buffer)
        const analysis = { fileName, kind: 'document' as const, summary: summarizeStatement(text) }
        logActivity('user', 'Extracted text from PSX statement PDF', fileName)
        return { canceled: false, savedPath: result.filePath, analysis }
      } catch {
        // Saved fine; text extraction just didn't work for this PDF — still a success.
      }
    }
    return { canceled: false, savedPath: result.filePath }
  })

  ipcMain.handle(IPC.dataCorrelateFlowPrice, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const flowDialog: Electron.OpenDialogOptions = {
      title: 'Select NCCPL flow data file (CSV/Excel)',
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheets', extensions: ['csv', 'xlsx', 'xls'] }]
    }
    const flowResult = win ? await dialog.showOpenDialog(win, flowDialog) : await dialog.showOpenDialog(flowDialog)
    if (flowResult.canceled || !flowResult.filePaths[0]) return { canceled: true }

    const priceDialog: Electron.OpenDialogOptions = {
      title: 'Now select the PSX price history file to correlate against',
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheets', extensions: ['csv', 'xlsx', 'xls'] }]
    }
    const priceResult = win ? await dialog.showOpenDialog(win, priceDialog) : await dialog.showOpenDialog(priceDialog)
    if (priceResult.canceled || !priceResult.filePaths[0]) return { canceled: true }

    try {
      const flowSheet = parseSpreadsheetFile(flowResult.filePaths[0])
      const priceSheet = parseSpreadsheetFile(priceResult.filePaths[0])
      const summary = correlateFlowWithPrice(flowSheet, priceSheet)
      logActivity(
        'user',
        'Correlated NCCPL flow data with PSX price data',
        `${basename(flowResult.filePaths[0])} + ${basename(priceResult.filePaths[0])}`
      )
      return { canceled: false, summary }
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : 'Failed to correlate files' }
    }
  })

  // LIVE PSX: fetch a symbol's real EOD history from dps.psx.com.pk and analyse it in-app.
  ipcMain.handle(IPC.psxLiveAnalyze, async (_e, symbol: string) => {
    try {
      const { bars, staleAsOf } = await fetchPsxEodDetailed(symbol)
      const analysis = analyzePsxBars(symbol, bars)
      logActivity('user', 'Fetched live PSX data', `${analysis.symbol} (${analysis.points} days)`)
      // staleAsOf ≠ null → the portal was unreachable and this is the last SAVED data;
      // the page shows that plainly so nobody mistakes it for a live quote.
      return { ok: true, analysis, summary: summarizePsxAnalysis(analysis), staleAsOf }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not fetch PSX data.' }
    }
  })

  // LIVE PSX: export the fetched data + indicators to a downloadable .xlsx.
  ipcMain.handle(IPC.psxLiveExcel, async (e, symbol: string) => {
    let bars, analysis
    try {
      bars = await fetchPsxEod(symbol)
      analysis = analyzePsxBars(symbol, bars)
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : 'Could not fetch PSX data.' }
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.SaveDialogOptions = {
      title: 'Save PSX data workbook',
      defaultPath: `${normalizeSymbol(symbol)}-PSX-${analysis.to}.xlsx`,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { saved: false }
    try {
      buildPsxWorkbook(bars, analysis, res.filePath)
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : 'Could not write the Excel file.' }
    }
    logActivity('user', 'Exported PSX data to Excel', `${analysis.symbol} → ${basename(res.filePath)}`)
    return { saved: true, path: res.filePath }
  })

  // LIVE PSX: turn the (accurate, in-app) analysis into a reasoned narration script via the
  // active free/paid brain. The model only writes prose around figures WE computed. The
  // user drives it with an optional instruction + language.
  ipcMain.handle(IPC.psxLiveScript, async (_e, symbol: string, directives?: ScriptDirectives) => {
    let analysis, summary
    try {
      const bars = await fetchPsxEod(symbol)
      analysis = analyzePsxBars(symbol, bars)
      summary = summarizePsxAnalysis(analysis)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not fetch PSX data.' }
    }
    try {
      const prompt = buildAnalysisScriptPrompt({ kind: 'technical', subject: `${analysis.symbol} on the PSX`, figures: summary, directives })
      const script = await getActiveProvider().generateText(prompt, 1800)
      logActivity('ai', 'Generated a PSX analysis script', analysis.symbol)
      return { ok: true, title: `${analysis.symbol} — PSX Live Analysis (${analysis.latestDate})`, script }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not generate the script.' }
    }
  })

  // GENERIC analysis → narration script. Used by the NCCPL tab (uploaded FIPI/LIPI files)
  // and any tab that already has computed figures. `figures` is the verified summary; the
  // model only writes prose around it, in the requested language/instruction.
  ipcMain.handle(
    IPC.analysisScript,
    async (_e, kind: AnalysisKind, subject: string, figures: string, directives?: ScriptDirectives) => {
      if (!figures || !figures.trim()) return { ok: false, error: 'Nothing to write about — analyze a file first.' }
      try {
        const prompt = buildAnalysisScriptPrompt({ kind, subject: subject || 'this data', figures, directives })
        const script = await getActiveProvider().generateText(prompt, 1800)
        logActivity('ai', 'Generated an analysis script', `${kind}: ${subject}`)
        return { ok: true, title: `${subject || 'Analysis'} — ${kind} script`, script }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Could not generate the script.' }
      }
    }
  )

  // LIVE PSX: fetch a symbol's EOD history and return a chart-ready PriceSeries (close
  // line + SMA20/50 + RSI14), for the Charts tab.
  ipcMain.handle(IPC.psxLiveSeries, async (_e, symbol: string) => {
    try {
      const { bars, staleAsOf } = await fetchPsxEodDetailed(symbol)
      const series = buildPriceSeriesFromBars(bars.map((b) => ({ date: b.date, close: b.close, volume: b.volume })))
      logActivity('user', 'Charted live PSX data', normalizeSymbol(symbol))
      const name = `${normalizeSymbol(symbol)} · PSX ${staleAsOf ? `SAVED data (offline — last fetched ${staleAsOf})` : 'live (EOD close)'}`
      return { ok: true, series, name, staleAsOf }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not fetch PSX data.' }
    }
  })

  ipcMain.handle(IPC.activityList, () => listActivityLog())

  // The ONLY caller of clearActivityLog() in the entire app — reachable exclusively
  // via an explicit user click on the "Clear Log" button in the renderer. No AI/generation
  // code path is wired to this channel.
  ipcMain.handle(IPC.activityClear, () => clearActivityLog())

  ipcMain.handle(IPC.advisorHistory, () => listChat())

  // Both deletes below are reachable ONLY from explicit user buttons in the Advisor UI —
  // no AI/generation path ever removes advisor memory.
  ipcMain.handle(IPC.advisorDelete, (_e, id: string) => {
    logActivity('user', 'Deleted an advisor message')
    return deleteChatMessage(id)
  })
  ipcMain.handle(IPC.advisorClear, () => {
    logActivity('user', 'Cleared advisor conversation')
    return clearChat()
  })

  ipcMain.handle(IPC.advisorSend, async (e, req: AdvisorRequest) => {
    const settings = getSettings()
    const system = buildAdvisorSystemPrompt(req.context)
    const messages = Array.isArray(req.messages) ? req.messages : []

    const flat = `${system}\n\n${messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n')}\n\nASSISTANT:`
    let reply: string
    if (settings.activeProvider === 'ollama') {
      const turns: ChatTurn[] = [{ role: 'system', content: system }, ...messages]
      try {
        reply = await ollamaChatStream(getModel('ollama'), turns, (delta) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.advisorStream, delta)
        })
      } catch {
        // Ollama unreachable (not installed/running) — degrade to the free hosted brain so
        // the advisor still answers instead of dying with ECONNREFUSED.
        reply = await getActiveProvider().generateText(flat, 1500)
        if (!e.sender.isDestroyed()) e.sender.send(IPC.advisorStream, reply)
      }
    } else {
      reply = await getActiveProvider().generateText(flat, 1500)
      if (!e.sender.isDestroyed()) e.sender.send(IPC.advisorStream, reply)
    }

    // Persist BOTH turns only AFTER a successful reply, so a failed generation never leaves
    // durable memory with a user message and no answer.
    const lastUser = messages[messages.length - 1]
    if (lastUser?.role === 'user') {
      appendChat({ id: randomUUID(), role: 'user', content: lastUser.content, createdAt: new Date().toISOString() })
    }
    const assistantMsg = {
      id: randomUUID(),
      role: 'assistant' as const,
      content: reply,
      createdAt: new Date().toISOString()
    }
    appendChat(assistantMsg)
    logActivity('ai', 'Advisor replied')
    return assistantMsg
  })

  // Global studio assistant: a page-aware, streaming chat available on every tab.
  // Uses the active brain (free Ollama / paid). Ephemeral — not persisted like the
  // Advisor, so it never clutters your saved advisor memory.
  ipcMain.handle(IPC.assistantAsk, async (e, messages: { role: 'user' | 'assistant'; content: string }[], context: string) => {
    const settings = getSettings()
    // Cap the grounding context so a large pasted draft can't blow a small model's window.
    const ctx = typeof context === 'string' ? context.slice(0, 6000) : ''
    const system =
      `You are the channel's in-house YouTube PRODUCER inside NihilPointZero Studio — a sharp, ` +
      `highly intelligent growth strategist, script doctor AND the app's own guide. You think in hooks ` +
      `(first 3 seconds), curiosity gaps, pattern interrupts, retention/watch-time, high-CTR titles & thumbnails, ` +
      `pacing, and CTAs. Context: ${ctx || 'the app'}. Give practical, specific, direct advice — concrete rewrites ` +
      `and numbers, not vague tips. When the user wants you to actually REWRITE what they're editing (hook, title, ` +
      `intro, script), tell them to use the quick-action buttons or say "rewrite this" so the change can be applied ` +
      `to their field. For cutting/keeping video parts or adding music/SFX, point them to the AI Director in Video ` +
      `Studio or the Timeline editor.\n\n` +
      `HOW-TO QUESTIONS: when the user asks how to do something in the app ("how do I…", "where is…", "why won't…"), ` +
      `answer ONLY from the manual below with exact tab names and click-paths, as numbered steps. If the manual ` +
      `doesn't cover it, say so honestly rather than inventing buttons. ANSWER DENSITY: if the user asks for detail ` +
      `("step by step", "explain fully", or their preference in the context says detailed), give complete granular ` +
      `steps; if they ask for brevity ("quick", "short", or preference says brief), give tight high-level bullets. ` +
      `Default to short numbered steps.\n${APP_GUIDE}`
    const msgs = Array.isArray(messages) ? messages : []
    const flat = `${system}\n\n${msgs.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}\n\nASSISTANT:`
    let reply: string
    try {
      if (settings.activeProvider === 'ollama') {
        const turns: ChatTurn[] = [{ role: 'system', content: system }, ...msgs]
        try {
          reply = await ollamaChatStream(getModel('ollama'), turns, (delta) => {
            if (!e.sender.isDestroyed()) e.sender.send(IPC.assistantStream, delta)
          })
        } catch {
          // Ollama unreachable — degrade to the free hosted brain so the on-tab assistant
          // still answers instead of dying with ECONNREFUSED.
          reply = await getActiveProvider().generateText(flat, 1200)
          if (!e.sender.isDestroyed()) e.sender.send(IPC.assistantStream, reply)
        }
      } else {
        reply = await getActiveProvider().generateText(flat, 1200)
        if (!e.sender.isDestroyed()) e.sender.send(IPC.assistantStream, reply)
      }
    } catch (err) {
      // Never reject the invoke: surface a readable error in the chat instead of an
      // unhandled rejection that makes the panel appear dead.
      reply = `⚠ ${err instanceof Error ? err.message : 'The AI brain is unavailable'} — check Settings (Free online needs internet; Ollama/paid need setup).`
      if (!e.sender.isDestroyed()) e.sender.send(IPC.assistantStream, reply)
    }
    return reply
  })

  // The "Studio Expert" (🧭): a SECOND on-every-tab assistant, separate from the Producer.
  // Pure app expert — answers anything about the software from the manual, in whatever
  // format the user asks (bullets / steps / precise clicks / detailed / brief), and points
  // the user at the widget's Execute flow when they want steps actually RUN. Ephemeral,
  // same streaming shape as the Producer's assistantAsk.
  ipcMain.handle(IPC.guideAsk, async (e, messages: { role: 'user' | 'assistant'; content: string }[], context: string) => {
    const settings = getSettings()
    const ctx = typeof context === 'string' ? context.slice(0, 6000) : ''
    const system =
      `You are the STUDIO EXPERT inside NihilPointZero Studio — the app's dedicated, all-knowing guide ` +
      `(a separate helper from the YouTube Producer). The manual below is your ONLY source of truth about ` +
      `the app: answer with exact tab names and click-paths, and if the manual doesn't cover something, say ` +
      `so honestly instead of inventing buttons.\n\n` +
      `FORMAT — the user chooses, you obey EXACTLY: "bullet points" = tight bullets; "step by step" or ` +
      `"step wise" = numbered steps; "precise steps"/"exact clicks" = one UI action per numbered step naming ` +
      `the exact button/tab; "detailed" = a full granular walkthrough including what the user should see ` +
      `after each action; "brief"/"quick" = 3-5 lines max. A format asked in the message beats any default. ` +
      `If no format is requested, use short numbered steps.\n\n` +
      `EXECUTION — you cannot click the UI yourself, but the app CAN run real creation steps (write scripts, ` +
      `build videos, generate scenes/images/thumbnails/music/ideas, PSX analysis). When the user wants ` +
      `something DONE rather than explained, tell them to press the "⚡ Execute" button under your answer, or ` +
      `switch this panel to Execute mode and type the order directly — the app turns it into a validated plan ` +
      `they approve with Run. NEVER claim you already did or clicked something yourself.\n\n` +
      `Context: ${ctx || 'the app'}\n${APP_GUIDE}`
    const msgs = Array.isArray(messages) ? messages : []
    const flat = `${system}\n\n${msgs.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}\n\nASSISTANT:`
    let reply: string
    try {
      if (settings.activeProvider === 'ollama') {
        const turns: ChatTurn[] = [{ role: 'system', content: system }, ...msgs]
        try {
          reply = await ollamaChatStream(getModel('ollama'), turns, (delta) => {
            if (!e.sender.isDestroyed()) e.sender.send(IPC.guideStream, delta)
          })
        } catch {
          // Ollama unreachable — degrade to the active chain (which itself degrades to free)
          // so the Expert still answers instead of dying with ECONNREFUSED.
          reply = await getActiveProvider().generateText(flat, 1200)
          if (!e.sender.isDestroyed()) e.sender.send(IPC.guideStream, reply)
        }
      } else {
        reply = await getActiveProvider().generateText(flat, 1200)
        if (!e.sender.isDestroyed()) e.sender.send(IPC.guideStream, reply)
      }
    } catch (err) {
      // Never reject the invoke: surface a readable error in the chat instead of an
      // unhandled rejection that makes the panel appear dead.
      reply = `⚠ ${err instanceof Error ? err.message : 'The AI brain is unavailable'} — check Settings (Free online needs internet; Ollama/paid need setup).`
      if (!e.sender.isDestroyed()) e.sender.send(IPC.guideStream, reply)
    }
    return reply
  })

  // Live health check — actually talks to every service (validates keys with a cheap
  // authenticated request) instead of trusting saved settings. See src/main/health.ts.
  ipcMain.handle(IPC.healthRun, () => runHealthCheck())

  // "Update available" banner support: pull-based re-read for renderers that mounted
  // after the one-shot broadcast (slow first paint, Ctrl+R reload).
  ipcMain.handle(IPC.updateGet, () => getAvailableUpdate())

  // Reveal the setup exe in the Desktop studio folder so a non-technical user finds it
  // in one click. ONLY when that exe is at least as new as the advertised build — on a
  // PC where the studio folder was merely copied, the local exe is the OLD installer and
  // revealing it would trap the user in an update loop. Stale/missing -> download page.
  ipcMain.handle(IPC.updateRevealSetup, (_e, remoteTag?: string) => {
    const setup = join(app.getPath('desktop'), 'NihilPointZeroStudio', 'NIHILPOINTZERO-OS-setup.exe')
    const remoteAt = typeof remoteTag === 'string' ? tagDate(remoteTag) : null
    if (existsSync(setup)) {
      const mtime = statSync(setup).mtimeMs
      // 30 min slack: build/copy timestamps of the SAME release can differ slightly.
      if (remoteAt === null || mtime >= remoteAt - 30 * 60_000) {
        shell.showItemInFolder(setup)
        return { ok: true, opened: 'local' }
      }
    }
    void shell.openExternal('https://github.com/DSKJazz/NihilPointZeroStudio/releases/latest')
    return { ok: true, opened: 'download-page' }
  })

  // The "YouTube Producer": a growth-strategist that critiques/rewrites the creator's
  // current document (script/title/brief/notes) and returns a structured result — a short
  // reasoning `reply` plus, when a rewrite is warranted, the full `edited` text the UI can
  // apply on the user's command. Grounded in what they're actually writing.
  ipcMain.handle(
    IPC.producerEdit,
    async (
      _e,
      params: { instruction: string; text: string; kind: string; pageName?: string }
    ): Promise<{ ok: boolean; reply?: string; edited?: string; error?: string }> => {
      const kind = params.kind || 'script'
      const sys = [
        'You are a world-class YouTube growth producer and script doctor for this creator\'s channel.',
        'You obsess over: a hook that lands in the first 3 seconds, curiosity gaps, pattern interrupts,',
        'tight pacing, clear CTAs, watch-time/retention, and high-CTR titles/thumbnails.',
        `The creator is working on their ${kind} on the "${params.pageName || 'app'}" screen.`,
        'Keep their voice and language exactly (English / Roman Urdu / Urdu as written).',
        'Return ONLY a JSON object (no prose, no fences):',
        '{"reply":"<1-3 sentences: what you changed or advise, and why it grows the channel>",',
        ' "edited":"<the FULL revised text, ready to paste — OMIT this key entirely if the task is a',
        '  question or advice-only with no rewrite>"}',
        '',
        `TASK: ${params.instruction}`,
        '',
        'CURRENT TEXT:',
        '<<<',
        (params.text || '').slice(0, 12000),
        '>>>',
        '',
        'JSON:'
      ].join('\n')
      try {
        // Scale the output budget to the input length so a long-script rewrite isn't
        // truncated mid-document (a cut-off reply is invalid JSON → nothing applied).
        const budget = Math.min(6000, Math.max(2200, Math.ceil((params.text || '').length / 3) + 600))
        const raw = await getActiveProvider().generateText(sys, budget)
        // extractJson THROWS on non-JSON, so it must be caught here — otherwise an
        // advice-only reply (e.g. "Title ideas") skips the fallback below and errors out.
        let parsed: { reply?: unknown; edited?: unknown } | null = null
        try {
          parsed = extractJson(raw) as { reply?: unknown; edited?: unknown }
        } catch {
          parsed = null
        }
        if (parsed && typeof parsed === 'object') {
          const reply = typeof parsed.reply === 'string' ? parsed.reply : ''
          const edited = typeof parsed.edited === 'string' && parsed.edited.trim() ? parsed.edited : undefined
          if (reply || edited) {
            logActivity('ai', 'Producer suggestion', params.instruction.slice(0, 60))
            return { ok: true, reply: reply || 'Here is a revision.', edited }
          }
        }
        // Advice-only / non-JSON reply — return the prose as advice instead of erroring.
        return { ok: true, reply: raw.trim() || 'No suggestion.' }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Producer is unavailable — set up your AI brain in Settings.' }
      }
    }
  )

  ipcMain.handle(IPC.videoBuild, async (e, req: VideoBuildRequest) => {
    const id = randomUUID()
    const slug = (req.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50) || 'video'
    const outPath = join(videosDir(), `${slug}-${id.slice(0, 8)}.mp4`)
    const narrationOutPath = `${outPath}.narration.wav`
    // Bookend the build in the Activity Log. Builds run here in the MAIN process, so they
    // keep going when the user switches tabs — these entries (start / failed / built) are
    // how the user can always answer "where did my video go?".
    logActivity('ai', 'Started building a video — it keeps building even if you switch tabs; the finished video appears in Video Studio', req.title)
    try {
      await buildVideoFromScript(
        req.title,
        req.body,
        outPath,
        (stage) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, stage)
        },
        {
          resolution: req.resolution,
          aspect: req.aspect,
          template: req.template,
          narrationVoice: req.narrationVoice,
          musicPath: req.musicPath,
          soundEffects: req.soundEffects,
          engine: req.engine,
          style: req.style,
          images: req.images,
          useStock: req.useStock,
          // Read the key server-side (never sent from the renderer).
          stockApiKey: req.useStock ? getStockConfig().pixabayKey : undefined,
          onPreview: (png) => {
            if (!e.sender.isDestroyed()) e.sender.send(IPC.videoPreview, png)
          },
          narrationOutPath
        }
      )
    } catch (err) {
      logActivity('ai', 'Video build FAILED', `${req.title} — ${err instanceof Error ? err.message : 'unknown error'}`)
      throw err
    }
    const job = {
      id,
      title: req.title,
      path: outPath,
      hasCustomVoice: false,
      createdAt: new Date().toISOString(),
      narrationPath: existsSync(narrationOutPath) ? narrationOutPath : undefined
    }
    appendVideo(job)
    logActivity('ai', `Built ${(req.resolution ?? '1080p').toUpperCase()} video${req.musicPath ? ' with music' : ''}${req.soundEffects ? ' + SFX' : ''}`, req.title)
    return job
  })

  // Opens a file picker for a background-music track. Returns the absolute path
  // (or null if canceled). The app never fetches audio — you supply your own file,
  // which keeps the whole feature free and offline.
  ipcMain.handle(IPC.videoPickMusic, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose a background music file',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }]
    })
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // Saves a copy of a built video wherever the user chooses (e.g. Downloads / USB).
  ipcMain.handle(IPC.videoSaveAs, async (_e, srcPath: string, suggestedName: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Save video',
      defaultPath: suggestedName,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    })
    if (res.canceled || !res.filePath) return { saved: false }
    try {
      copyFileSync(srcPath, res.filePath)
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : 'The original video is no longer available.' }
    }
    logActivity('user', 'Exported a copy of a video', res.filePath)
    return { saved: true, path: res.filePath }
  })

  // Transcode a built video into a chosen delivery format and save it wherever the
  // user picks (Downloads / USB). All encoders are in the bundled ffmpeg — free/offline.
  ipcMain.handle(IPC.videoExport, async (e, videoId: string, format: ExportFormat) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const ext = formatExtension(format)
    const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50) || 'video'
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions = {
      title: 'Download / export video',
      defaultPath: `${slug}.${ext}`,
      filters: [{ name: `${ext.toUpperCase()} video`, extensions: [ext] }]
    }
    const res = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions)
    if (res.canceled || !res.filePath) return { saved: false }
    await exportVideo(src.path, format, res.filePath, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
    })
    logActivity('user', `Exported video as ${format}`, res.filePath)
    return { saved: true, path: res.filePath }
  })

  // Cut a built video: keep only a range, or remove a range. Produces a NEW video
  // (the original is untouched) saved to the videos folder and indexed.
  ipcMain.handle(IPC.videoTrim, async (e, videoId: string, mode: TrimMode, start: number, end: number) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const id = randomUUID()
    const outPath = join(videosDir(), `${src.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'}-${mode}-${id.slice(0, 8)}.mp4`)
    await trimVideo(src.path, mode, start, end, outPath, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
    })
    const job = {
      id,
      title: `${src.title} (${mode === 'keep' ? 'clip' : 'cut'})`,
      path: outPath,
      hasCustomVoice: src.hasCustomVoice,
      createdAt: new Date().toISOString()
    }
    appendVideo(job)
    logActivity('user', `Trimmed a video (${mode})`, src.title)
    return job
  })

  // Import a script from a user-picked file (.txt/.md/.srt/.pdf) so a video can be
  // built from your own writing — no need to generate one in the finance Writer.
  // Text is extracted in the main process (no CSP) and returned to the renderer.
  ipcMain.handle(IPC.videoImportScript, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Choose a script file',
      properties: ['openFile'],
      filters: [
        { name: 'Script / text', extensions: ['txt', 'md', 'markdown', 'srt', 'text', 'pdf'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const filePath = result.filePaths[0]
    const name = basename(filePath)
    const ext = (name.split('.').pop() || '').toLowerCase()
    try {
      let raw: string
      if (ext === 'pdf') {
        raw = await extractPdfText(readFileSync(filePath))
      } else {
        raw = readFileSync(filePath, 'utf-8')
      }
      const body = normalizeScriptText(raw, ext)
      if (!body.trim()) {
        return { canceled: false, error: 'That file had no readable text to turn into a script.' }
      }
      logActivity('user', 'Imported a script file for video', name)
      return { canceled: false, title: deriveTitleFromFilename(name), body }
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : 'Could not read that file.' }
    }
  })

  // Pick one or more images for a Ken-Burns slideshow background (preset engine).
  ipcMain.handle(IPC.videoPickImages, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Choose background images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return res.canceled ? [] : res.filePaths
  })

  // Live status for the engine badges + saved config for the settings inputs.
  ipcMain.handle(IPC.aiEngineStatus, async () => {
    const cfg = getAiVideoConfig()
    return {
      cloudConfigured: isCloudConfigured(),
      localDetected: await detectLocal(),
      cloudEndpoint: cfg.cloudEndpoint,
      localEndpoint: cfg.localEndpoint
    }
  })

  ipcMain.handle(IPC.aiGetConfig, () => {
    // Never send the raw key back to the renderer — just whether one is set.
    const cfg = getAiVideoConfig()
    return {
      cloudEndpoint: cfg.cloudEndpoint ?? '',
      cloudModel: cfg.cloudModel ?? '',
      localEndpoint: cfg.localEndpoint ?? '',
      hasCloudKey: !!cfg.cloudApiKey
    }
  })

  ipcMain.handle(IPC.aiSetConfig, (_e, partial: AiVideoConfig) => {
    setAiVideoConfig(partial)
    logActivity('user', 'Updated AI video engine settings')
    return { ok: true }
  })

  // Whether a stock-footage key is set (never returns the key itself).
  ipcMain.handle(IPC.stockGetConfig, () => {
    const c = getStockConfig()
    return { hasPixabay: !!c.pixabayKey, hasPexels: !!c.pexelsKey }
  })

  ipcMain.handle(IPC.stockSetKey, (_e, provider: 'pixabay' | 'pexels', key: string) => {
    const r = setStockKey(provider, key)
    logActivity('user', `${key ? 'Saved' : 'Removed'} ${provider} stock-footage key`)
    return r
  })

  ipcMain.handle(IPC.scriptpadGet, () => getScriptPad())

  ipcMain.handle(IPC.scriptpadSave, (_e, title: string, body: string) => saveScriptPad(title, body))

  // Procedurally generate a music bed / sound effect (free, offline, no downloads).
  // Returns the absolute file path so the renderer can preview it via file://.
  ipcMain.handle(IPC.audioGenerateMusic, async (_e, mood: Mood, durationSec: number, seed: number) => {
    const path = await renderMusic(mood, durationSec, seed)
    logActivity('ai', `Generated ${mood} music bed`, `${Math.round(durationSec)}s`)
    return path
  })

  ipcMain.handle(IPC.audioGenerateSfx, async (_e, kind: SfxKind) => {
    const path = await renderSfx(kind)
    logActivity('ai', 'Generated sound effect', kind)
    return path
  })

  // Pick your own audio file to add to the DJ station library.
  ipcMain.handle(IPC.audioPickFile, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Add an audio file',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }]
    })
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // Lists the bundled royalty-free starter pack (rendered into resources/audio-pack
  // at build time). Returns [] in dev builds where the pack hasn't been generated.
  ipcMain.handle(IPC.audioListPack, () => {
    const packDir = app.isPackaged
      ? join(process.resourcesPath, 'audio-pack')
      : join(app.getAppPath(), 'resources', 'audio-pack')
    const manifest = join(packDir, 'manifest.json')
    if (!existsSync(manifest)) return []
    try {
      const items = JSON.parse(readFileSync(manifest, 'utf-8')) as Array<{
        id: string
        kind: 'music' | 'sfx'
        label: string
        file: string
      }>
      // Manifest stores basenames; resolve each to an absolute path under the pack dir.
      return items
        .map((it) => ({ ...it, file: join(packDir, basename(it.file)) }))
        .filter((it) => existsSync(it.file))
    } catch {
      return []
    }
  })

  // Re-mix a built video with the DJ-station timeline clips → a new video.
  ipcMain.handle(IPC.audioRemix, async (e, videoId: string, clips: AudioClip[]) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const id = randomUUID()
    const outPath = join(videosDir(), `${src.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'}-mix-${id.slice(0, 8)}.mp4`)
    await remixVideoAudio(src.path, clips, outPath, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
    })
    const job = {
      id,
      title: `${src.title} (DJ mix)`,
      path: outPath,
      hasCustomVoice: src.hasCustomVoice,
      createdAt: new Date().toISOString()
    }
    appendVideo(job)
    logActivity('user', 'Re-mixed a video with DJ station', `${clips.length} clips`)
    return job
  })

  // DJ "create music only": render the timeline to a standalone MP3 (no video). Returns the path.
  ipcMain.handle(IPC.audioRenderMix, async (e, clips: AudioClip[], durationSec: number) => {
    if (!clips.length) throw new Error('Add at least one sound to the timeline first.')
    const outPath = join(generatedAudioDir(), `mix-${randomUUID().slice(0, 8)}.mp3`)
    await renderMixToAudio(clips, durationSec, outPath, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
    })
    logActivity('user', 'Created a standalone music mix', `${clips.length} clips`)
    return outPath
  })

  // Save/download any generated audio file to a location the user picks.
  ipcMain.handle(IPC.audioSaveFile, async (_e, srcPath: string, suggestedName: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Save audio',
      defaultPath: suggestedName || 'mix.mp3',
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a'] }]
    })
    if (res.canceled || !res.filePath) return { saved: false }
    try {
      copyFileSync(srcPath, res.filePath)
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : 'The original audio is no longer available.' }
    }
    logActivity('user', 'Saved an audio file', res.filePath)
    return { saved: true, path: res.filePath }
  })

  // AI Director: interpret a plain-English instruction into a validated edit plan
  // (using the active free/paid brain), then execute it on the chosen video.
  ipcMain.handle(IPC.directorInterpret, async (_e, videoId: string, instruction: string) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    return interpretInstruction(src.path, instruction)
  })

  ipcMain.handle(IPC.directorExecute, async (e, videoId: string, actions: DirectorAction[]) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    if (!actions.length) throw new Error('No edits to apply.')
    const id = randomUUID()
    const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'
    const scratch = mkdtempSync(join(tmpdir(), 'director-'))
    try {
      const finalTemp = await executeActions(
        src.path,
        actions,
        (tag) => join(scratch, `${tag}.mp4`),
        (stage) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, stage)
        }
      )
      // Persist only the final result into the videos folder.
      const outPath = join(videosDir(), `${slug}-aiedit-${id.slice(0, 8)}.mp4`)
      copyFileSync(finalTemp, outPath)
      const job = {
        id,
        title: `${src.title} (AI edit)`,
        path: outPath,
        hasCustomVoice: src.hasCustomVoice,
        createdAt: new Date().toISOString()
      }
      appendVideo(job)
      logActivity('user', 'AI Director edited a video', `${actions.length} actions`)
      return job
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  // AI Command Panel: interpret a plain-English request into a validated, ordered plan
  // of safe steps (using the active free/paid brain). No changes are made yet.
  ipcMain.handle(IPC.agentInterpret, async (_e, command: string) => {
    if (!command || !command.trim()) throw new Error('Type a command first.')
    return interpretCommand(command)
  })

  // Execute a confirmed plan end-to-end (write scripts, build videos, make thumbnails,
  // generate ideas), streaming per-step progress. Returns the outcome of each step.
  ipcMain.handle(IPC.agentExecute, async (e, plan: AgentPlan) => {
    const safePlan = sanitizeAgentPlan(plan) // re-validate whatever the renderer sent
    if (!safePlan.steps.length) throw new Error('There are no runnable steps in this plan.')
    const results = await executeAgentPlan(safePlan, {
      onProgress: (stage) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.agentProgress, stage)
      },
      onPreview: (png) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.videoPreview, png)
      },
      stockApiKey: getStockConfig().pixabayKey
    })
    return { results }
  })

  // Scene Studio: plan editable scenes from a script, and generate one scene image at a
  // time (the renderer drives the loop so the user can watch, pause, and regenerate).
  ipcMain.handle(IPC.scenePlan, (_e, title: string, body: string, style: VideoStyle, direction: string) => {
    return planScenes(title || '', body || '', style, direction || '')
  })
  ipcMain.handle(IPC.sceneGenerate, async (_e, prompt: string, seed: number, fast: boolean) => {
    if (!prompt || !prompt.trim()) throw new Error('Empty scene prompt.')
    const imgPath = await generateSceneImage(prompt.trim(), Math.max(1, Math.round(seed) || 1), !!fast)
    // Every generated picture lands in the Library automatically (nothing generated is
    // losable); Trash-Can rules apply, so only the user can ever remove it.
    saveToLibrary({
      id: randomUUID(),
      kind: 'image',
      data: { title: prompt.trim().slice(0, 80), path: imgPath, source: 'Scene Studio' },
      savedAt: new Date().toISOString()
    })
    return imgPath
  })

  // Save ONE generated scene image wherever the user chooses.
  ipcMain.handle(IPC.sceneSaveImage, async (_e, srcPath: string, suggestedName: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Save scene image',
      defaultPath: suggestedName || 'scene.jpg',
      filters: [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }]
    })
    if (res.canceled || !res.filePath) return { saved: false }
    try {
      copyFileSync(srcPath, res.filePath)
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : 'Could not save the file.' }
    }
    logActivity('user', 'Saved a scene image', res.filePath)
    return { saved: true, path: res.filePath }
  })

  // Save ALL generated scene images into a folder the user picks, numbered in order.
  ipcMain.handle(IPC.sceneSaveAllImages, async (_e, srcPaths: string[]) => {
    if (!Array.isArray(srcPaths) || srcPaths.length === 0) {
      return { saved: false, error: 'No generated images to save yet.' }
    }
    const res = await dialog.showOpenDialog({
      title: 'Choose a folder for the scene images',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return { saved: false }
    const dir = res.filePaths[0]
    let count = 0
    try {
      for (const src of srcPaths) {
        copyFileSync(src, join(dir, `scene-${String(count + 1).padStart(2, '0')}.jpg`))
        count++
      }
    } catch (err) {
      return {
        saved: false,
        error: err instanceof Error ? err.message : `Failed after saving ${count} image(s).`
      }
    }
    logActivity('user', `Saved ${count} scene images to a folder`, dir)
    return { saved: true, path: dir, count }
  })

  // Put the user IN a scene: image-to-image from their attached photo (free, AI Horde).
  // Streams queue progress on scene:progress so the slow free queue never looks frozen.
  ipcMain.handle(
    IPC.sceneGenerateFromPhoto,
    async (e, index: number, prompt: string, sourceImagePath: string, strength: number) => {
      if (!prompt || !prompt.trim()) throw new Error('Empty scene prompt.')
      if (!sourceImagePath) throw new Error('No photo attached.')
      const imgPath = await generateFromPhoto({
        prompt: prompt.trim(),
        sourceImagePath,
        apikey: getHordeApiKey() ?? undefined,
        strength,
        onProgress: (p) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.sceneProgress, { index, ...p })
        }
      })
      saveToLibrary({
        id: randomUUID(),
        kind: 'image',
        data: { title: prompt.trim().slice(0, 80), path: imgPath, source: 'Scene Studio (photo)' },
        savedAt: new Date().toISOString()
      })
      return imgPath
    }
  )

  // Auto-captions: transcribe the narration (offline Whisper) → .srt sidecar, and
  // optionally burn the subtitles into a new video. Free/offline.
  ipcMain.handle(IPC.videoCaptions, async (e, videoId: string, burn: boolean) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const notify = (m: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, m)
    }
    notify('Transcribing narration (offline)…')
    const audioSrc = src.narrationPath && existsSync(src.narrationPath) ? src.narrationPath : src.path
    const segments = await transcribeFileToSegments(audioSrc)
    if (!segments.length) throw new Error('No speech was detected to caption.')
    const srtPath = `${src.path.replace(/\.mp4$/i, '')}.srt`
    writeFileSync(srtPath, buildSrt(segments), 'utf-8')
    let job: VideoJob | undefined
    if (burn) {
      notify('Burning captions into the video…')
      const id = randomUUID()
      const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'
      const outPath = join(videosDir(), `${slug}-captioned-${id.slice(0, 8)}.mp4`)
      await runFfmpeg(buildBurnSubsArgs(src.path, srtPath, outPath), (line) => notify(line.trim().slice(0, 160)))
      job = {
        id,
        title: `${src.title} (captioned)`,
        path: outPath,
        hasCustomVoice: src.hasCustomVoice,
        createdAt: new Date().toISOString(),
        narrationPath: src.narrationPath
      }
      appendVideo(job)
    }
    logActivity('user', burn ? 'Burned captions into a video' : 'Generated captions (.srt)', src.title)
    return { srtPath, job }
  })

  /**
   * MAKE SHORTS — one long video → several vertical (9:16) captioned clips for
   * YouTube Shorts / TikTok / Reels. Everything is local and free: the offline Whisper
   * transcript finds the moments, pure scoring picks the strongest, and bundled ffmpeg
   * cuts + reframes + burns the captions. Each clip is added to Video Studio.
   */
  /**
   * Ready-to-paste posting text for a finished clip: title + description + hashtags.
   * Uses the video's own title/script as grounding so it describes THIS clip, and
   * degrades to a usable non-AI fallback rather than failing the click.
   */
  ipcMain.handle(IPC.videoPostMeta, async (_e, videoId: string, platform: 'youtube' | 'tiktok', vertical?: boolean) => {
    const job = listVideos().find((j) => j.id === videoId)
    if (!job) throw new Error('Video not found — build it again first.')
    // The saved script isn't part of VideoJob, so the title is the grounding text.
    const source = job.title.slice(0, 2500)
    const prompt =
      `Write posting text for a ${vertical ? 'VERTICAL short-form' : 'long-form'} video on ` +
      `${platform === 'youtube' ? (vertical ? 'YouTube Shorts' : 'YouTube') : 'TikTok'}.\n` +
      `The channel covers Pakistani/global finance and markets for a general audience; the video's ` +
      `language may be Roman Urdu — match the language of the source text.\n` +
      `Return STRICT JSON only, no prose, no code fence:\n` +
      `{"title": "<=80 chars, high click-through, no clickbait lying", ` +
      `"description": "2-3 short lines, plain text, no markdown", ` +
      `"hashtags": ["8-12 relevant tags WITHOUT the # symbol"]}\n\n` +
      `VIDEO TITLE: ${source}`
    const fallback = {
      title: job.title.slice(0, 80),
      description: `${job.title}\n\nMore finance breakdowns on the channel.`,
      hashtags: ['finance', 'stockmarket', 'psx', 'pakistan', 'investing', 'money', 'shorts', 'trading']
    }
    try {
      const raw = await getActiveProvider().generateText(prompt, 700)
      // director's extractJson is untyped (and THROWS on non-JSON — caught below).
      const parsed = extractJson(raw) as { title?: string; description?: string; hashtags?: unknown }
      const tags = Array.isArray(parsed.hashtags)
        ? (parsed.hashtags as unknown[])
            .filter((t): t is string => typeof t === 'string')
            .map((t: string) => t.replace(/^#+/, '').replace(/\s+/g, '').trim())
            .filter(Boolean)
            .slice(0, 12)
        : []
      const meta = {
        title: (parsed.title || fallback.title).slice(0, 100),
        description: parsed.description || fallback.description,
        hashtags: tags.length ? tags : fallback.hashtags
      }
      logActivity('ai', 'Generated posting text for a video', job.title)
      return meta
    } catch {
      // A busy free model must not cost the user the feature — hand back the fallback.
      return fallback
    }
  })

  ipcMain.handle(IPC.videoMakeShorts, async (e, videoId: string, count: number) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const notify = (m: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, m)
    }
    logActivity('user', 'Started making shorts from a video', src.title)
    notify('Listening to the video to find the best moments (offline)…')
    const audioSrc = src.narrationPath && existsSync(src.narrationPath) ? src.narrationPath : src.path
    const segments = await transcribeFileToSegments(audioSrc)
    if (!segments.length) {
      throw new Error('No speech was found in this video, so there are no moments to clip.')
    }
    const moments = pickShortMoments(segments, { count: Math.max(1, Math.min(10, Math.round(count) || 3)) })
    if (!moments.length) throw new Error('This video is too short to cut into shorts.')

    const jobs: VideoJob[] = []
    for (let i = 0; i < moments.length; i++) {
      const m = moments[i]
      notify(`Making short ${i + 1} of ${moments.length} — ${m.title}…`)
      const id = randomUUID()
      const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 32) || 'video'
      const outPath = join(videosDir(), `${slug}-short${i + 1}-${id.slice(0, 8)}.mp4`)
      // Per-clip .srt on the clip's own timeline (pickShortMoments re-bases the captions).
      const srtPath = `${outPath.replace(/\.mp4$/i, '')}.srt`
      writeFileSync(srtPath, buildSrt(m.captions), 'utf-8')
      await runFfmpeg(
        buildShortArgs({ srcPath: src.path, outPath, startSec: m.startSec, endSec: m.endSec, srtPath }),
        (line) => notify(line.trim().slice(0, 160))
      )
      const job: VideoJob = {
        id,
        title: `${src.title} — Short ${i + 1}: ${m.title}`,
        path: outPath,
        hasCustomVoice: src.hasCustomVoice,
        createdAt: new Date().toISOString()
      }
      appendVideo(job)
      jobs.push(job)
    }
    logActivity('ai', `Made ${jobs.length} vertical short(s) — now in Video Studio`, src.title)
    return { jobs, moments: moments.map((m) => ({ title: m.title, reason: m.reason, startSec: m.startSec, endSec: m.endSec })) }
  })

  // Brand kit: overlay a logo watermark in a corner. New video, original kept.
  ipcMain.handle(
    IPC.videoWatermark,
    async (e, videoId: string, logoPath: string, position: WatermarkPosition) => {
      const src = listVideos().find((j) => j.id === videoId)
      if (!src) throw new Error('Video not found — build it again first.')
      if (!logoPath) throw new Error('Pick a logo image first.')
      const [vw] = await ffprobeVideoSize(src.path)
      const id = randomUUID()
      const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'
      const outPath = join(videosDir(), `${slug}-logo-${id.slice(0, 8)}.mp4`)
      await runFfmpeg(
        buildWatermarkArgs({ videoPath: src.path, logoPath, logoWidthPx: Math.round(vw * 0.15), position, outPath }),
        (line) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
        }
      )
      const job = {
        id,
        title: `${src.title} (logo)`,
        path: outPath,
        hasCustomVoice: src.hasCustomVoice,
        createdAt: new Date().toISOString(),
        narrationPath: src.narrationPath
      }
      appendVideo(job)
      logActivity('user', 'Added a logo watermark', src.title)
      return job
    }
  )

  // Optional free AI Horde key (faster photo-to-scene). Stored encrypted like other keys.
  ipcMain.handle(IPC.settingsSetHordeKey, (_e, key: string) => setHordeApiKey(key))
  ipcMain.handle(IPC.settingsSetMvsepToken, (_e, key: string) => setMvsepToken(key))
  ipcMain.handle(IPC.settingsSetDemucsCmd, (_e, cmd: string) => setDemucsCmd(cmd))
  ipcMain.handle(IPC.settingsSetFaceAnimCmd, (_e, cmd: string) => setFaceAnimCmd(cmd))

  // OUTSIDE videos: remove the background music by AI-separating the audio and keeping
  // only the vocals/narration. engine 'online' (MVSEP, free token) or 'local' (Demucs).
  // Optional add-on; clear errors if not set up. New video, original kept.
  ipcMain.handle(IPC.videoSeparateMusic, async (e, videoId: string, engine: 'online' | 'local') => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const notify = (msg: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, msg)
    }
    const scratch = makeSeparationScratch()
    try {
      notify('Extracting the audio track…')
      const mixed = join(scratch, 'mixed.wav')
      await runFfmpeg(['-y', '-i', src.path, '-vn', '-ar', '44100', '-ac', '2', mixed])
      const vocals =
        engine === 'online'
          ? await separateOnline(mixed, getMvsepToken() ?? '', scratch, (p) => notify(p.message))
          : await separateLocal(mixed, getDemucsCmd(), scratch, (p) => notify(p.message))
      notify('Rebuilding the video with music removed…')
      const id = randomUUID()
      const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'
      const outPath = join(videosDir(), `${slug}-nomusic-${id.slice(0, 8)}.mp4`)
      // The vocals stem IS the "narration only" track → reuse the exact music-remove muxer.
      await setVideoMusic(src.path, vocals, 'remove', undefined, outPath, (line) => notify(line.trim().slice(0, 160)))
      const job = {
        id,
        title: `${src.title} (music removed)`,
        path: outPath,
        hasCustomVoice: src.hasCustomVoice,
        createdAt: new Date().toISOString()
      }
      appendVideo(job)
      logActivity('user', `Separated music (${engine}) from a video`, src.title)
      return job
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  // Remove or replace a built video's background music WITHOUT touching the narration
  // (uses the saved narration track — exact, offline, no AI un-mixing). New video, original kept.
  ipcMain.handle(IPC.videoSetMusic, async (e, videoId: string, mode: 'remove' | 'replace', mood?: Mood) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    if (!src.narrationPath || !existsSync(src.narrationPath)) {
      throw new Error(
        'This video has no saved narration track, so its music can’t be separated. Videos built from now on support this — rebuild it once to enable music removal.'
      )
    }
    let musicPath: string | undefined
    if (mode === 'replace') {
      if (!mood) throw new Error('Choose a music mood to replace with.')
      musicPath = await renderMusic(mood, 40, 1)
    }
    const id = randomUUID()
    const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'
    const outPath = join(videosDir(), `${slug}-music-${id.slice(0, 8)}.mp4`)
    await setVideoMusic(src.path, src.narrationPath, mode, musicPath, outPath, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
    })
    const job = {
      id,
      title: `${src.title} (${mode === 'remove' ? 'no music' : 'new music'})`,
      path: outPath,
      hasCustomVoice: src.hasCustomVoice,
      createdAt: new Date().toISOString(),
      narrationPath: src.narrationPath
    }
    appendVideo(job)
    logActivity('user', `Music ${mode} on a video`, src.title)
    return job
  })

  // Natural voice (Piper): status + one-time opt-in download into the portable data folder.
  ipcMain.handle(IPC.voicePiperStatus, () => ({ installed: isPiperInstalled() }))
  ipcMain.handle(IPC.voicePiperDownload, async (e) => {
    await downloadPiper((stage) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.voicePiperProgress, stage)
    })
    logActivity('user', 'Installed the natural narration voice (Piper)')
    return { installed: isPiperInstalled() }
  })

  ipcMain.handle(IPC.settingsSetYouTubeChannel, (_e, id: string) => setYouTubeChannelId(id))

  // Assisted YouTube publish: generate description+tags, copy to clipboard, open the
  // upload page, and reveal the file to drag in. Free, no OAuth, no upload limits.
  ipcMain.handle(IPC.youtubePublish, async (_e, videoId: string) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const meta = await generatePublishMeta(src.title)
    const clip = `TITLE:\n${src.title}\n\nDESCRIPTION:\n${meta.description}\n\nTAGS:\n${meta.tags.join(', ')}`
    clipboard.writeText(clip)
    const url = buildUploadUrl(getYouTubeChannelId())
    await shell.openExternal(url)
    shell.showItemInFolder(src.path)
    logActivity('user', 'Prepared a YouTube upload', src.title)
    return { title: src.title, description: meta.description, tags: meta.tags, uploadUrl: url }
  })

  // Batch: make a video per topic (write script → build), streaming per-topic progress.
  ipcMain.handle(
    IPC.agentBatch,
    async (e, topics: string[], style?: VideoStyle, resolution?: import('../shared/types').VideoResolution, aiVisuals?: boolean) => {
      if (!Array.isArray(topics) || !topics.length) throw new Error('Add at least one topic (one per line).')
      const results = await runBatch(topics, {
        style,
        resolution,
        aiVisuals: !!aiVisuals,
        stockApiKey: getStockConfig().pixabayKey,
        onProgress: (stage) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.agentProgress, stage)
        }
      })
      return { results }
    }
  )

  // DAW-lite: render a waveform image of a video's audio (visual reference in the DJ).
  ipcMain.handle(IPC.audioWaveform, async (_e, videoId: string) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const out = join(thumbnailsDir(), `wave-${src.id.slice(0, 8)}.png`)
    await runFfmpeg(['-y', '-i', src.path, '-filter_complex', '[0:a]showwavespic=s=1000x160:colors=0xE8B923[w]', '-map', '[w]', '-frames:v', '1', out])
    return out
  })

  // Universal autosave: renderer debounce-saves each tab's state here; restored on open.
  ipcMain.handle(IPC.draftGet, (_e, key: string) => getDraft(key))
  ipcMain.handle(IPC.draftSet, (_e, key: string, value: unknown) => {
    setDraft(key, value)
    return { ok: true }
  })

  ipcMain.handle(IPC.djPlansList, () => listDjPlans())
  ipcMain.handle(IPC.djPlanSave, (_e, plan: AudioPlan) => saveDjPlan(plan))
  ipcMain.handle(IPC.djPlanDelete, (_e, id: string) => deleteDjPlan(id))

  // Online free (Creative-Commons) music search. Returns { online:false } when there's
  // no connection so the renderer shows a notice and falls back to built-in sounds.
  ipcMain.handle(IPC.musicSearch, async (_e, query: string) => {
    const result = await searchMusic(query)
    if (result.online && result.tracks.length) logActivity('user', 'Searched free music', query)
    return result
  })

  // Downloads a chosen track into the generated-audio folder; returns its local path.
  ipcMain.handle(IPC.musicDownload, async (_e, audioUrl: string, suggestedName: string) => {
    const safe = (suggestedName || 'track').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50) || 'track'
    const ext = (audioUrl.split('?')[0].split('.').pop() || 'mp3').toLowerCase().slice(0, 4)
    const outPath = join(generatedAudioDir(), `dl-${safe}-${randomUUID().slice(0, 6)}.${/^[a-z0-9]+$/.test(ext) ? ext : 'mp3'}`)
    await downloadTrack(audioUrl, outPath)
    logActivity('user', 'Downloaded a free music track', suggestedName)
    return outPath
  })

  ipcMain.handle(IPC.videoAttachVoice, async (_e, videoId: string, audioBytes: Uint8Array) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const id = randomUUID()
    const outPath = `${src.path.replace(/\.mp4$/i, '')}-myvoice-${id.slice(0, 8)}.mp4`
    await attachRecordedVoice(src.path, audioBytes, outPath)
    const job = {
      id,
      title: `${src.title} (my voice)`,
      path: outPath,
      hasCustomVoice: true,
      createdAt: new Date().toISOString()
    }
    appendVideo(job)
    logActivity('user', 'Recorded own voice onto video', src.title)
    return job
  })

  // Assemble a narration take from one or more recorded segments (with optional trims)
  // into a single WAV. Powers review + "redo from here" (punch-in). Returns WAV bytes.
  ipcMain.handle(
    IPC.voiceAssemble,
    (_e, segments: { bytes: Uint8Array; startSec?: number; endSec?: number }[]) => assembleVoice(segments)
  )

  // KEEP-BOTH: add the recorded voice ON TOP of the video's existing audio (does not
  // replace it), unlike video:attach-voice which replaces. Produces a new video.
  ipcMain.handle(IPC.videoAddVoice, async (e, videoId: string, audioBytes: Uint8Array) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const scratch = mkdtempSync(join(tmpdir(), 'finscript-addvoice-'))
    try {
      const voice = join(scratch, 'voice.wav')
      writeFileSync(voice, Buffer.from(audioBytes))
      const id = randomUUID()
      const outPath = `${src.path.replace(/\.mp4$/i, '')}-addvoice-${id.slice(0, 8)}.mp4`
      await remixVideoAudio(
        src.path,
        [{ id: 'myvoice', src: voice, label: 'My voice', atSec: 0, gain: 1, fadeIn: 0, fadeOut: 0 }],
        outPath,
        (line) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
        }
      )
      const job = {
        id,
        title: `${src.title} (voice added)`,
        path: outPath,
        hasCustomVoice: true,
        createdAt: new Date().toISOString()
      }
      appendVideo(job)
      logActivity('user', 'Added own voice over existing audio', src.title)
      return job
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  ipcMain.handle(IPC.videoList, () => listVideos())

  // User-only delete (removes the file too); no AI/generation path calls this.
  ipcMain.handle(IPC.videoDelete, (_e, id: string) => {
    logActivity('user', 'Deleted a built video')
    return deleteVideo(id)
  })

  // Stitch several built videos into one new video (non-destructive).
  ipcMain.handle(IPC.videoStitch, async (e, videoIds: string[]) => {
    const all = listVideos()
    const inputs = videoIds.map((id) => all.find((j) => j.id === id)?.path).filter((p): p is string => !!p)
    if (inputs.length < 2) throw new Error('Pick at least two videos to stitch.')
    const id = randomUUID()
    const outPath = join(videosDir(), `stitched-${id.slice(0, 8)}.mp4`)
    await stitchVideos(inputs, outPath, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
    })
    const job = { id, title: `Stitched (${inputs.length} clips)`, path: outPath, hasCustomVoice: false, createdAt: new Date().toISOString() }
    appendVideo(job)
    logActivity('user', 'Stitched videos together', `${inputs.length} clips`)
    return job
  })

  // ── Timeline NLE ──
  // Let the user pick one or more video/image clips to drop on the timeline.
  ipcMain.handle(IPC.timelinePickClips, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Add clips to the timeline',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video / Image', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'jpg', 'jpeg', 'png', 'webp'] }
      ]
    }
    const res = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return res.canceled ? [] : res.filePaths
  })

  // Probe a source file's duration (seconds) so the UI can default a clip's out-point.
  ipcMain.handle(IPC.timelineProbe, async (_e, src: string) => {
    try {
      return { ok: true, duration: await ffprobeDuration(src) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not read that file.' }
    }
  })

  // Render a timeline project to a new video (non-destructive). Streams progress.
  ipcMain.handle(IPC.timelineRender, async (e, docJson: TimelineDoc, title?: string) => {
    const id = randomUUID()
    const outPath = join(videosDir(), `timeline-${id.slice(0, 8)}.mp4`)
    try {
      await renderTimeline(docJson, outPath, (line) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
      })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Timeline render failed.' }
    }
    const job: VideoJob = { id, title: (title && title.trim()) || 'Timeline edit', path: outPath, hasCustomVoice: false, createdAt: new Date().toISOString() }
    appendVideo(job)
    logActivity('user', 'Rendered a timeline edit', job.title)
    return { ok: true, video: job }
  })

  // ── Storyboard Director ──
  // Pick the user's real photo for 'photo' subject beats.
  ipcMain.handle(IPC.storyboardPickPhoto, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Choose your photo',
      properties: ['openFile'],
      filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // Plan a storyboard from either the user's own beats (guided) or a pasted script (auto).
  ipcMain.handle(
    IPC.storyboardPlan,
    async (
      _e,
      params: { mode: 'auto' | 'guided'; title: string; brief: string; totalSeconds?: number; language?: string; width?: number; height?: number; fps?: number }
    ) => {
      const defaults = { width: params.width ?? 1920, height: params.height ?? 1080, fps: params.fps ?? 25 }
      // One AI attempt: null (never a throw) when the model is down or returns junk.
      const attemptAI = async (extra = ''): Promise<ReturnType<typeof sanitizeStoryboard> | null> => {
        try {
          const prompt =
            buildStoryboardPrompt({
              mode: params.mode,
              title: params.title,
              brief: params.brief,
              totalSeconds: params.totalSeconds,
              language: params.language
            }) + extra
          const doc = sanitizeStoryboard(extractJson(await getActiveProvider().generateText(prompt, 2600)), defaults)
          return doc.beats.length ? doc : null
        } catch {
          return null
        }
      }
      let doc = await attemptAI()
      // Weak/free models often wrap the JSON in prose — one strict retry fixes most cases.
      if (!doc) {
        doc = await attemptAI('\nIMPORTANT: Reply with ONLY the JSON object — no explanation, no markdown. Start with { and end with }.')
      }
      if (!doc) {
        // The AI failed twice — direct it ourselves. storyboardFromScript always yields at
        // least one beat, so this button never dead-ends with "could not turn that into shots".
        doc = sanitizeStoryboard(
          storyboardFromScript({
            title: params.title,
            brief: params.brief,
            totalSeconds: params.totalSeconds,
            language: params.language
          }),
          defaults
        )
        logActivity('ai', 'Director AI could not structure the script — built the storyboard directly from it instead', params.title)
      }
      // Keep the title/language the user asked for if the model dropped them.
      if (params.title.trim()) doc.title = params.title.trim()
      if (params.language) doc.language = params.language
      logActivity('ai', `Planned a ${doc.beats.length}-beat storyboard`, doc.title)
      return { ok: true, storyboard: doc }
    }
  )

  // Beautify (or roughen) a photo and return a preview file the UI can show.
  ipcMain.handle(IPC.photoBeautify, async (_e, src: string, strength: number) => {
    try {
      const dir = join(videosDir(), 'beautify')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const out = join(dir, `preview-${randomUUID().slice(0, 8)}.jpg`)
      await beautifyImage(src, out, { strength })
      return { ok: true, path: out }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Beautify failed.' }
    }
  })

  // Render a storyboard to a video. Returns the video job AND the TimelineDoc so the
  // user can keep editing the result in the Timeline editor.
  ipcMain.handle(IPC.storyboardRender, async (e, doc: StoryboardDoc, opts?: { photoPath?: string; beautifyStrength?: number; windowsVoice?: boolean }) => {
    const id = randomUUID()
    const outPath = join(videosDir(), `storyboard-${id.slice(0, 8)}.mp4`)
    let timeline
    try {
      ;({ timeline } = await renderStoryboard(id, doc, outPath, {
        photoPath: opts?.photoPath,
        beautifyStrength: opts?.beautifyStrength,
        windowsVoice: opts?.windowsVoice,
        onProgress: (line) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
        }
      }))
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Storyboard render failed.' }
    }
    // The MP4 exists at this point — register it OUTSIDE the try so a store write hiccup
    // can't make a successful render look like a failure.
    const job: VideoJob = { id, title: doc.title || 'Storyboard film', path: outPath, hasCustomVoice: false, createdAt: new Date().toISOString() }
    appendVideo(job)
    logActivity('user', 'Rendered a storyboard film', job.title)
    return { ok: true, video: job, timeline }
  })

  // PRESENTER: pick your narration video (video/lip-graft modes).
  ipcMain.handle(IPC.presenterPickVideo, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose your narration video',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // PRESENTER: build a video where YOU (real footage or your photo) are interleaved with
  // theme B-roll + AI scenes. In video/graft modes your video's OWN audio (your real voice)
  // is the master track. Saves a durable copy of your upload + the result.
  ipcMain.handle(
    IPC.presenterBuild,
    async (
      e,
      params: {
        title: string
        body: string
        mode: PresenterMode
        presenterPath?: string
        graftPhotoPath?: string
        graftRegion?: GraftRegion
        style?: VideoStyle
        everyN?: number
        windowsVoice?: boolean
      }
    ) => {
      if (!params.body?.trim()) return { ok: false, error: 'Paste your script first.' }
      const mode = params.mode
      const realVoice = mode === 'video' || mode === 'graft'
      if (realVoice && !params.presenterPath) return { ok: false, error: 'Upload your narration video first (or use the Photo presenter).' }
      if (mode === 'photo' && !params.presenterPath) return { ok: false, error: 'Choose your photo first (or use the Video presenter).' }
      if (mode === 'graft' && !params.graftPhotoPath) return { ok: false, error: 'Choose the picture to graft onto (the one where you look your best).' }
      const id = randomUUID()
      const assetDir = join(videosDir(), 'presenter', id)
      mkdirSync(assetDir, { recursive: true })
      const emit = (line: string): void => { if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160)) }
      try {
        let presenterSrc: string | undefined
        let masterAudioSrc: string | undefined
        let voiceTrackSeconds: number | undefined
        let photoPath: string | undefined
        if (realVoice) {
          emit('Reading your narration video…')
          presenterSrc = join(assetDir, `presenter${extname(params.presenterPath as string) || '.mp4'}`)
          copyFileSync(params.presenterPath as string, presenterSrc)
          masterAudioSrc = join(assetDir, 'voice.wav')
          await runFfmpeg(['-y', '-i', presenterSrc, '-vn', '-ac', '2', '-ar', '44100', masterAudioSrc])
          voiceTrackSeconds = await ffprobeDuration(masterAudioSrc).catch(() => 0)
          if (!voiceTrackSeconds) return { ok: false, error: 'Could not read audio from that video — use one that has your voice in it.' }
        } else {
          photoPath = params.presenterPath
        }
        // GRAFT: turn (your video + your best picture) into a "living picture" ONCE, then
        // the rest of the pipeline consumes it exactly like normal presenter footage. The
        // voice was already extracted from the ORIGINAL video above, so nothing about the
        // master audio changes. Engine order: optional local AI tool → built-in ffmpeg
        // graft → (on total failure) your raw clip, so a build never breaks.
        if (mode === 'graft' && presenterSrc) {
          const graftPhoto = join(assetDir, `graft-photo${extname(params.graftPhotoPath as string) || '.jpg'}`)
          copyFileSync(params.graftPhotoPath as string, graftPhoto)
          const region = sanitizeGraftRegion(params.graftRegion)
          const grafted = join(assetDir, 'living-picture.mp4')
          let done = false
          const toolCmd = getFaceAnimCmd()
          if (toolCmd) {
            emit('Running your local face-animation tool (full-quality graft)…')
            done = await runGraftTool(toolCmd, { photo: graftPhoto, video: presenterSrc, audio: masterAudioSrc, out: grafted }, emit)
          }
          if (!done) {
            emit('Grafting the moving part of your video onto your picture…')
            try {
              await renderGraftVideo({
                photoPath: graftPhoto,
                videoPath: presenterSrc,
                region,
                width: 1920,
                height: 1080,
                fps: 25,
                outPath: grafted,
                onProgress: emit
              })
              done = existsSync(grafted)
            } catch (err) {
              emit(`Graft failed (${err instanceof Error ? err.message : 'error'}) — using your raw footage instead.`)
            }
          }
          if (done) presenterSrc = grafted
        }
        const doc = planPresenterStoryboard({
          title: params.title, body: params.body, mode, style: params.style, everyN: params.everyN,
          presenterSrc, voiceTrackSeconds, masterAudioSrc, width: 1920, height: 1080, fps: 25
        })
        const outPath = join(videosDir(), `presenter-${id.slice(0, 8)}.mp4`)
        const { timeline } = await renderStoryboard(id, doc, outPath, {
          photoPath,
          beautifyStrength: 0.4,
          windowsVoice: params.windowsVoice,
          onProgress: (line) => emit(line)
        })
        const job: VideoJob = { id, title: doc.title, path: outPath, hasCustomVoice: realVoice, createdAt: new Date().toISOString() }
        appendVideo(job)
        logActivity('user', `Built a ${mode} presenter video`, doc.title)
        return { ok: true, video: job, timeline }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Presenter build failed.' }
      }
    }
  )

  // GRAFT: one composited "living picture" frame so the region sliders give instant,
  // honest feedback (this exact pixel result is what the full render produces).
  ipcMain.handle(
    IPC.graftPreview,
    async (_e, params: { photoPath: string; videoPath: string; region?: GraftRegion; atSec?: number }) => {
      if (!params?.photoPath || !params?.videoPath) return { ok: false, error: 'Pick both the picture and the video first.' }
      try {
        const outPng = join(tmpdir(), `npz-graft-preview-${Date.now().toString(36)}.png`)
        await renderGraftPreview({
          photoPath: params.photoPath,
          videoPath: params.videoPath,
          region: sanitizeGraftRegion(params.region),
          width: 1280,
          height: 720,
          atSec: Math.max(0, params.atSec ?? 1),
          outPng
        })
        return { ok: true, path: outPng }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Preview failed.' }
      }
    }
  )

  // RECORDER: enumerate screen/window sources for screen capture (renderer feeds the id
  // into getUserMedia's desktop source). Cameras/mics are enumerated in the renderer.
  ipcMain.handle(IPC.recorderScreenSources, async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } })
    return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }))
  })

  // RECORDER: save an in-app recording (browser webm bytes) → transcode to a standard MP4 →
  // register in Video Studio so it's saved and usable (Presenter, trim, export…).
  ipcMain.handle(IPC.recorderSave, async (_e, bytes: Uint8Array, kind: string, enhance?: boolean) => {
    const id = randomUUID()
    const scratch = mkdtempSync(join(tmpdir(), 'npz-rec-'))
    const webm = join(scratch, 'rec.webm')
    const outPath = join(videosDir(), `recording-${kind || 'clip'}-${id.slice(0, 8)}.mp4`)
    try {
      writeFileSync(webm, Buffer.from(bytes))
      // When enhance is on, clean the voice + polish the picture in the SAME transcode pass;
      // otherwise just transcode webm → MP4.
      const args = enhance
        ? buildEnhanceArgs(webm, outPath, { audio: true, video: true })
        : ['-y', '-i', webm, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath]
      await runFfmpeg(args)
      const job: VideoJob = { id, title: `Recording (${kind || 'clip'})`, path: outPath, hasCustomVoice: true, createdAt: new Date().toISOString() }
      appendVideo(job)
      logActivity('user', 'Saved an in-app recording', kind)
      return { ok: true, video: job }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not save the recording.' }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  // Enhance an existing built video: voice cleanup + video polish → a NEW video (original kept).
  ipcMain.handle(IPC.videoEnhance, async (_e, videoId: string, opts?: { audio?: boolean; video?: boolean }) => {
    const src = listVideos().find((v) => v.id === videoId)
    if (!src || !existsSync(src.path)) return { ok: false, error: 'Video not found.' }
    const id = randomUUID()
    const outPath = join(videosDir(), `enhanced-${id.slice(0, 8)}.mp4`)
    try {
      await runFfmpeg(buildEnhanceArgs(src.path, outPath, opts ?? { audio: true, video: true }))
      const job: VideoJob = { id, title: `${src.title} (enhanced)`, path: outPath, hasCustomVoice: src.hasCustomVoice, createdAt: new Date().toISOString() }
      appendVideo(job)
      logActivity('user', 'Enhanced a video', src.title)
      return { ok: true, video: job }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Enhance failed.' }
    }
  })

  // AI plans a video (hook, sections + b-roll keywords, thumbnail, CTR tips) using
  // the active brain. Throws a clear error if no brain is configured.
  ipcMain.handle(IPC.videoPlan, async (_e, title: string, body: string) => {
    const plan = await generateVideoPlan(title, body)
    logActivity('ai', 'Planned a video', title)
    return plan
  })

  ipcMain.handle(IPC.videoReveal, (_e, path: string) => shell.showItemInFolder(path))

  // Stops any in-progress render/export/trim by killing the active ffmpeg process(es).
  ipcMain.handle(IPC.videoCancel, () => {
    const n = cancelActiveFfmpeg()
    if (n) logActivity('user', 'Stopped a render')
    return { stopped: n }
  })

  // Offline speech-to-text (dictation). Receives a recorded audio clip, returns
  // the transcribed text. Runs a local Whisper model — no cloud, free for life.
  ipcMain.handle(IPC.speechTranscribe, async (_e, audioBytes: Uint8Array) => {
    const text = await transcribeAudio(audioBytes)
    if (text) logActivity('user', 'Dictated text (speech-to-text)')
    return text
  })

  ipcMain.handle(IPC.webServerStatus, () => getWebServerStatus())
  ipcMain.handle(IPC.webServerStart, () => startWebServer())
  ipcMain.handle(IPC.webServerStop, () => stopWebServer())
}
