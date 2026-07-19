import { useEffect, useState } from 'react'
import type { LLMProviderId, OllamaStatus, ProviderSettings } from '../../../shared/types'

const providerLabel: Record<LLMProviderId, string> = {
  free: 'Free (online)',
  ollama: 'Local (Free)',
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI'
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<ProviderSettings | null>(null)
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [youtubeKey, setYoutubeKey] = useState('')
  const [hordeKey, setHordeKey] = useState('')
  const [mvsepToken, setMvsepToken] = useState('')
  const [demucsCmd, setDemucsCmd] = useState('')
  const [ytChannel, setYtChannel] = useState('')
  const [piperInstalled, setPiperInstalled] = useState(false)
  const [piperBusy, setPiperBusy] = useState(false)
  const [piperMsg, setPiperMsg] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [checkingOllama, setCheckingOllama] = useState(false)
  const [webUrl, setWebUrl] = useState<string | null>(null)
  const [webBusy, setWebBusy] = useState(false)
  const [aiCloudEndpoint, setAiCloudEndpoint] = useState('')
  const [aiCloudModel, setAiCloudModel] = useState('')
  const [aiCloudKey, setAiCloudKey] = useState('')
  const [aiLocalEndpoint, setAiLocalEndpoint] = useState('')
  const [aiHasCloudKey, setAiHasCloudKey] = useState(false)
  const [pixabayKey, setPixabayKey] = useState('')
  const [hasPixabay, setHasPixabay] = useState(false)

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setSettings(s)
      setDemucsCmd(s.demucsCmd || '')
      setYtChannel(s.youtubeChannelId || '')
    })
    checkOllama()
    window.api.webServer.status().then((s) => setWebUrl(s.url))
    window.api.ai.getConfig().then((c) => {
      setAiCloudEndpoint(c.cloudEndpoint)
      setAiCloudModel(c.cloudModel)
      setAiLocalEndpoint(c.localEndpoint)
      setAiHasCloudKey(c.hasCloudKey)
    })
    window.api.stock.getConfig().then((c) => setHasPixabay(c.hasPixabay))
    window.api.voice.piperStatus().then((s) => setPiperInstalled(s.installed))
  }, [])

  async function saveYtChannel(): Promise<void> {
    await window.api.settings.setYouTubeChannel(ytChannel.trim())
    setStatus('YouTube channel saved — Publish will open your upload page.')
    await refresh()
    setTimeout(() => setStatus(null), 2500)
  }

  async function downloadPiper(): Promise<void> {
    setPiperBusy(true)
    setPiperMsg('Starting…')
    const unsub = window.api.voice.onPiperProgress((stage) => setPiperMsg(stage))
    try {
      const r = await window.api.voice.piperDownload()
      setPiperInstalled(r.installed)
      setPiperMsg(r.installed ? 'Natural voice installed ✓' : 'Install failed — try again.')
    } catch (err) {
      setPiperMsg(err instanceof Error ? err.message : 'Install failed')
    } finally {
      unsub()
      setPiperBusy(false)
    }
  }

  async function saveStockKey(): Promise<void> {
    const r = await window.api.stock.setKey('pixabay', pixabayKey.trim())
    setHasPixabay(r.hasPixabay)
    setPixabayKey('')
    setStatus('Stock footage key saved.')
    setTimeout(() => setStatus(null), 2500)
  }

  async function saveAiConfig(): Promise<void> {
    await window.api.ai.setConfig({
      cloudEndpoint: aiCloudEndpoint || undefined,
      cloudModel: aiCloudModel || undefined,
      localEndpoint: aiLocalEndpoint || undefined,
      ...(aiCloudKey ? { cloudApiKey: aiCloudKey } : {})
    })
    setAiCloudKey('')
    setAiHasCloudKey(aiHasCloudKey || !!aiCloudKey)
    setStatus('AI Video settings saved.')
    setTimeout(() => setStatus(null), 2500)
  }

  async function toggleWebServer(): Promise<void> {
    setWebBusy(true)
    const s = webUrl ? await window.api.webServer.stop() : await window.api.webServer.start()
    setWebUrl(s.url)
    setWebBusy(false)
  }

  async function checkOllama(): Promise<void> {
    setCheckingOllama(true)
    setOllamaStatus(await window.api.settings.ollamaStatus())
    setCheckingOllama(false)
  }

  async function refresh(): Promise<void> {
    setSettings(await window.api.settings.get())
  }

  async function handleSetProvider(provider: LLMProviderId): Promise<void> {
    setSettings(await window.api.settings.setProvider(provider))
  }

  async function handleSetModel(provider: LLMProviderId, model: string): Promise<void> {
    setSettings(await window.api.settings.setModel(provider, model))
  }

  async function handleSaveKey(provider: 'anthropic' | 'openai'): Promise<void> {
    const key = provider === 'anthropic' ? anthropicKey : openaiKey
    await window.api.settings.setApiKey(provider, key)
    if (provider === 'anthropic') setAnthropicKey('')
    else setOpenaiKey('')
    setStatus(`${providerLabel[provider]} key saved.`)
    await refresh()
    setTimeout(() => setStatus(null), 2500)
  }

  async function handleSaveYoutubeKey(): Promise<void> {
    await window.api.settings.setYouTubeKey(youtubeKey)
    setYoutubeKey('')
    setStatus('YouTube Data API key saved.')
    await refresh()
    setTimeout(() => setStatus(null), 2500)
  }

  async function handleSaveHordeKey(): Promise<void> {
    await window.api.settings.setHordeKey(hordeKey)
    setHordeKey('')
    setStatus('AI Horde key saved — photo scenes will get priority.')
    await refresh()
    setTimeout(() => setStatus(null), 2500)
  }

  async function handleSaveMvsepToken(): Promise<void> {
    await window.api.settings.setMvsepToken(mvsepToken)
    setMvsepToken('')
    setStatus('MVSEP token saved — online music separation is ready.')
    await refresh()
    setTimeout(() => setStatus(null), 2500)
  }

  async function handleSaveDemucsCmd(): Promise<void> {
    await window.api.settings.setDemucsCmd(demucsCmd.trim())
    setStatus('Local Demucs command saved.')
    await refresh()
    setTimeout(() => setStatus(null), 2500)
  }

  if (!settings) return <div className="p-8 text-ink-400 text-sm">Loading…</div>

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-serif text-ink-100">Settings</h1>
      <p className="text-ink-400 text-sm mt-1">
        Choose what writes your ideas and scripts. The local option is free and runs entirely on this PC; the API
        options cost a small amount per script but write at higher quality.
      </p>

      {/* Setup health — at-a-glance readiness of every subsystem. */}
      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <div className="text-sm text-ink-100 font-medium mb-2">Setup health</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4 text-xs">
          {[
            {
              label: 'AI brain',
              ok: settings.activeProvider === 'free' || (settings.activeProvider === 'ollama' ? !!ollamaStatus?.connected : settings.activeProvider === 'anthropic' ? settings.hasAnthropicKey : settings.hasOpenAIKey),
              note: settings.activeProvider === 'free' ? 'Free (online)' : settings.activeProvider
            },
            { label: 'Photo scenes', ok: true, note: 'built-in key — needs internet (free queue)' },
            { label: 'Online music removal', ok: true, note: 'built-in token — needs internet (free queue)' },
            { label: 'Natural voice', ok: piperInstalled, note: piperInstalled ? 'installed' : 'optional — not installed' },
            { label: 'Local music separation', ok: !!settings.demucsCmd, note: settings.demucsCmd ? 'ready' : 'optional — not set up' },
            { label: 'YouTube channel', ok: !!settings.youtubeChannelId, note: settings.youtubeChannelId ? 'set' : 'not set' }
          ].map((h) => (
            <div key={h.label} className="flex items-center gap-2">
              <span className={h.ok ? 'text-emerald-400' : 'text-amber-400'}>{h.ok ? '●' : '○'}</span>
              <span className="text-ink-300">{h.label}</span>
              <span className="text-ink-600 ml-auto truncate">{h.note}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-ink-600 mt-2">Green = ready. Amber = optional/needs setup. AI features also need internet.</p>
      </div>

      <div className="mt-6 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-2">
        <label className="text-xs text-ink-400">Active provider</label>
        <div className="flex gap-2">
          {(['free', 'ollama', 'anthropic', 'openai'] as LLMProviderId[]).map((p) => (
            <button
              key={p}
              onClick={() => handleSetProvider(p)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                settings.activeProvider === p
                  ? 'border-gold-500 bg-ink-800 text-gold-400'
                  : 'border-ink-700 text-ink-300 hover:border-ink-500'
              }`}
            >
              {providerLabel[p]}
            </button>
          ))}
        </div>
      </div>

      {settings.activeProvider === 'free' && (
        <div className="mt-4 rounded-lg border border-emerald-700/50 bg-emerald-950/20 p-4">
          <div className="text-sm text-emerald-300 font-medium">🟢 Free online AI — active</div>
          <p className="text-xs text-ink-300 mt-1 leading-relaxed">
            No API key, no signup, no install — this uses a free hosted AI model and works out of the box
            as long as you have internet. It powers the AI Command panel, Script Writer, Ideas, Advisor and
            the AI Director, and free AI image generation for thumbnails and video visuals. Free services can
            get busy; if a request fails, just try again, or switch to a paid key below for top quality.
          </p>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Local (Free, runs on this PC via Ollama)</span>
          {checkingOllama ? (
            <span className="text-xs text-ink-500">Checking…</span>
          ) : ollamaStatus?.connected ? (
            <span className="text-xs text-emerald-400">Ollama running</span>
          ) : (
            <span className="text-xs text-red-400">Ollama not detected</span>
          )}
        </div>

        {!ollamaStatus?.connected && !checkingOllama && (
          <p className="text-xs text-ink-500">
            Install Ollama from ollama.com, open it, then pull a model (e.g. <code>ollama pull llama3.1:8b</code>) in
            a terminal. No account or API key needed — generation just runs slower than the cloud options since it
            uses your own CPU.
          </p>
        )}

        <div>
          <label className="text-xs text-ink-400">Model</label>
          {ollamaStatus?.connected && ollamaStatus.models.length > 0 ? (
            <select
              value={settings.ollamaModel}
              onChange={(e) => handleSetModel('ollama', e.target.value)}
              className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
            >
              {ollamaStatus.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={settings.ollamaModel}
              onChange={(e) => handleSetModel('ollama', e.target.value)}
              placeholder="llama3.1:8b"
              className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
            />
          )}
        </div>

        <button
          onClick={checkOllama}
          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-sm px-4 py-1.5 transition-colors"
        >
          Re-check connection
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Claude (Anthropic)</span>
          <span className={`text-xs ${settings.hasAnthropicKey ? 'text-emerald-400' : 'text-ink-500'}`}>
            {settings.hasAnthropicKey ? 'Key configured' : 'No key set'}
          </span>
        </div>
        <div>
          <label className="text-xs text-ink-400">Model</label>
          <input
            value={settings.anthropicModel}
            onChange={(e) => handleSetModel('anthropic', e.target.value)}
            className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
            placeholder="sk-ant-…"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={() => handleSaveKey('anthropic')}
            disabled={!anthropicKey.trim()}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save Key
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">OpenAI</span>
          <span className={`text-xs ${settings.hasOpenAIKey ? 'text-emerald-400' : 'text-ink-500'}`}>
            {settings.hasOpenAIKey ? 'Key configured' : 'No key set'}
          </span>
        </div>
        <div>
          <label className="text-xs text-ink-400">Model</label>
          <input
            value={settings.openaiModel}
            onChange={(e) => handleSetModel('openai', e.target.value)}
            className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            placeholder="sk-…"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={() => handleSaveKey('openai')}
            disabled={!openaiKey.trim()}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save Key
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">YouTube channel (for Publish)</span>
          <span className={`text-xs ${ytChannel ? 'text-emerald-400' : 'text-ink-500'}`}>{ytChannel ? 'Set' : 'Not set'}</span>
        </div>
        <p className="text-xs text-ink-500">
          Your channel ID (starts with “UC…”). The “▶ Publish to YouTube” button on each built video copies the
          AI-written title/description/tags to your clipboard and opens YOUR channel’s upload page so you just drop the
          file in — free, no sign-in, no limits.
        </p>
        <div className="flex gap-2">
          <input
            value={ytChannel}
            onChange={(e) => setYtChannel(e.target.value)}
            placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={saveYtChannel}
            className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">YouTube Data API (optional, free)</span>
          <span className={`text-xs ${settings.hasYouTubeKey ? 'text-emerald-400' : 'text-ink-500'}`}>
            {settings.hasYouTubeKey ? 'Key configured' : 'No key set'}
          </span>
        </div>
        <p className="text-xs text-ink-500">
          When set, Ideas & Trends pulls real existing videos, channels, and view counts for your topic from
          YouTube's official free API (10,000 quota units/day, no billing needed) to ground competition scoring in
          real data instead of guesses. Get a free key from Google Cloud Console → enable "YouTube Data API v3" →
          create an API key.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={youtubeKey}
            onChange={(e) => setYoutubeKey(e.target.value)}
            placeholder="AIza…"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={handleSaveYoutubeKey}
            disabled={!youtubeKey.trim()}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save Key
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">AI Horde key — photo scenes (optional, free)</span>
          <span className={`text-xs ${settings.hasHordeKey ? 'text-emerald-400' : 'text-emerald-400'}`}>
            {settings.hasHordeKey ? 'Your key configured' : 'Built-in key active'}
          </span>
        </div>
        <p className="text-xs text-ink-500">
          Scene Studio’s “Put me in (photo)” uses the free AI Horde image queue. A free key is already built into this
          app (travels with every copy), so photo scenes work everywhere with priority — no setup. You can paste your
          own free key here to use your own account instead (get one at aihorde.net → Register → copy the API key).
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={hordeKey}
            onChange={(e) => setHordeKey(e.target.value)}
            placeholder="Your free AI Horde API key"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={handleSaveHordeKey}
            disabled={!hordeKey.trim()}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save Key
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Natural narration voice (optional, free)</span>
          <span className={`text-xs ${piperInstalled ? 'text-emerald-400' : 'text-ink-500'}`}>
            {piperInstalled ? 'Installed' : 'Not installed'}
          </span>
        </div>
        <p className="text-xs text-ink-500">
          A far more natural computer voice than the robotic Windows one — free, offline, and it travels with your
          data folder. One-time ~80 MB download. Your own recorded voice (🎙 Voice studio) is still the best and stays
          the default; this just upgrades the *computer* voice option. After installing, pick “Natural voice” under a
          build’s Narration voice.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadPiper}
            disabled={piperBusy || piperInstalled}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            {piperInstalled ? 'Installed ✓' : piperBusy ? 'Installing…' : 'Download natural voice (~80 MB)'}
          </button>
          {piperMsg && <span className="text-[11px] text-ink-400">{piperMsg}</span>}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Music separation — online (free)</span>
          <span className={`text-xs ${settings.hasMvsepToken ? 'text-emerald-400' : 'text-emerald-400'}`}>
            {settings.hasMvsepToken ? 'Your token configured' : 'Built-in token active'}
          </span>
        </div>
        <p className="text-xs text-ink-500">
          Removes background music from OUTSIDE videos (ones not made in this app) over the internet — no install. A
          free token is already built in (travels with every copy), so it works out of the box. You can paste your own
          free token here (mvsep.com → Register → API) to use your own account/quota instead. Videos you build in the
          app don’t need this; they remove/replace music exactly on their own.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={mvsepToken}
            onChange={(e) => setMvsepToken(e.target.value)}
            placeholder="Your free MVSEP API token"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={handleSaveMvsepToken}
            disabled={!mvsepToken.trim()}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Music separation — local (optional, best quality)</span>
          <span className={`text-xs ${settings.demucsCmd ? 'text-emerald-400' : 'text-ink-500'}`}>
            {settings.demucsCmd ? 'Command set' : 'Not set up'}
          </span>
        </div>
        <p className="text-xs text-ink-500">
          Offline, highest quality — needs a one-time install: install Python, then <code>pip install demucs</code>.
          Enter the command to run it (usually just <code>demucs</code>, or a full path). This is the only feature
          that needs an install; everything else stays copy-paste portable.
        </p>
        <div className="flex gap-2">
          <input
            value={demucsCmd}
            onChange={(e) => setDemucsCmd(e.target.value)}
            placeholder="demucs"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={handleSaveDemucsCmd}
            className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Phone access (same Wi-Fi)</span>
          <span className={`text-xs ${webUrl ? 'text-emerald-400' : 'text-ink-500'}`}>{webUrl ? 'On' : 'Off'}</span>
        </div>
        <p className="text-xs text-ink-500">
          Turn this on to open a companion page on your Android phone's browser (same Wi-Fi) and generate ideas,
          write scripts, and chat with the Advisor — your PC does all the work and everything saves to this PC's
          Library. Only works while this app is running and your phone is on the same network.
        </p>
        <button
          onClick={toggleWebServer}
          disabled={webBusy}
          className={`rounded-md text-sm px-4 py-1.5 transition-colors disabled:opacity-50 ${
            webUrl
              ? 'border border-red-500/60 text-red-300 hover:border-red-400'
              : 'bg-gold-500 hover:bg-gold-400 text-ink-950 font-medium'
          }`}
        >
          {webBusy ? 'Working…' : webUrl ? 'Turn off phone access' : 'Turn on phone access'}
        </button>
        {webUrl && (
          <div className="rounded-md border border-ink-700 bg-ink-800 p-3">
            <div className="text-xs text-ink-400 mb-1">Open this on your phone's browser:</div>
            <div className="text-sm text-gold-400 break-all font-mono">{webUrl}</div>
            <div className="text-[11px] text-ink-600 mt-1">
              The link includes a private access token — anyone on your Wi-Fi with this exact link can use it, so
              don't share it. Turning phone access off invalidates it.
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <h2 className="text-lg font-medium text-ink-100">Stock footage (free, optional)</h2>
        <p className="text-ink-400 text-sm mt-1">
          Add a free Pixabay API key to let the Video Studio pull real B-roll footage matched to your script (online).
          Without it, videos use the built-in animated look. Get a free key at pixabay.com → Join → the key appears at
          pixabay.com/api/docs while logged in.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={pixabayKey}
            onChange={(e) => setPixabayKey(e.target.value)}
            placeholder={hasPixabay ? 'Key saved — type to replace' : 'Pixabay API key'}
            className="flex-1 min-w-[220px] rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={saveStockKey}
            className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 font-medium text-sm px-4 py-1.5 transition-colors"
          >
            Save key
          </button>
          {hasPixabay && <span className="text-[11px] text-emerald-400">✓ Pixabay key set</span>}
        </div>
        <p className="text-[10px] text-ink-600 mt-2">
          Pixabay footage is free for commercial use, no attribution required. Your key is stored locally (obfuscated)
          and never leaves your machine except to call Pixabay.
        </p>
      </div>

      <div className="mt-8 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <h2 className="text-lg font-medium text-ink-100">AI Video engines (optional)</h2>
        <p className="text-ink-400 text-sm mt-1">
          The free “Style presets” engine needs nothing here and always works offline. These settings only power the two
          optional AI-footage engines in the Video Generator. Leave blank to keep using the free engine.
        </p>

        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-ink-700 bg-ink-800 p-3 space-y-2">
            <div className="text-sm text-ink-100">💳 Cloud AI footage (paid — your key)</div>
            <p className="text-[11px] text-ink-500">
              Get an API key from a text-to-video provider (e.g. Runway, Pika, Luma, or Replicate). Paste your key and
              the provider’s REST endpoint. Each video costs money on the provider’s side — that’s why it’s not
              “free for life”. Endpoint contract: POST {'{ prompt, seconds, width, height }'} → returns a video URL.
            </p>
            <input
              value={aiCloudEndpoint}
              onChange={(e) => setAiCloudEndpoint(e.target.value)}
              placeholder="Cloud endpoint URL (https://…)"
              className="w-full rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
            />
            <input
              value={aiCloudModel}
              onChange={(e) => setAiCloudModel(e.target.value)}
              placeholder="Model name (optional)"
              className="w-full rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
            />
            <input
              type="password"
              value={aiCloudKey}
              onChange={(e) => setAiCloudKey(e.target.value)}
              placeholder={aiHasCloudKey ? 'API key saved — type to replace' : 'API key'}
              className="w-full rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
            />
          </div>

          <div className="rounded-md border border-ink-700 bg-ink-800 p-3 space-y-2">
            <div className="text-sm text-ink-100">🟢 Local AI footage (free — needs a GPU)</div>
            <p className="text-[11px] text-ink-500">
              Free per video, but you must run a local text-to-video server on a capable GPU (e.g. ComfyUI/AnimateDiff or
              Stable Video Diffusion). This is not portable and won’t run on weak devices. Enter your server’s base URL.
              Contract: GET /health, POST /generate {'{ prompt, seconds, width, height }'} → video bytes or a URL.
            </p>
            <input
              value={aiLocalEndpoint}
              onChange={(e) => setAiLocalEndpoint(e.target.value)}
              placeholder="Local server URL (default http://127.0.0.1:7860)"
              className="w-full rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
            />
          </div>

          <button
            onClick={saveAiConfig}
            className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 font-medium text-sm px-4 py-1.5 transition-colors"
          >
            Save AI Video settings
          </button>
        </div>
      </div>

      {status && <div className="mt-4 text-sm text-emerald-400">{status}</div>}

      <div className="mt-8 text-xs text-ink-600 border-t border-ink-800 pt-4">
        Trend topics still reason from the model's own knowledge (no free live "trending topics" API exists), but
        with a YouTube key set, idea scoring is grounded in real existing videos and view counts for your topic.
      </div>
    </div>
  )
}
