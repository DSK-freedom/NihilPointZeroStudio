# FinScript Studio

Desktop app for planning and writing YouTube finance & economics scripts in bilingual Roman Urdu + English, institutional-grade tone.

## Running it

```
npm run dev
```

This opens the app with hot reload. First time, you'll need an API key:

1. Get a key from [console.anthropic.com](https://console.anthropic.com) (Claude, recommended) or [platform.openai.com](https://platform.openai.com) (OpenAI).
2. Open the app → **Settings** → paste the key → **Save Key**.
3. Pick that provider as "Active provider".

Keys are stored only in your local user data folder and never sent anywhere except directly to the provider you chose. **Installed builds** encrypt them at rest via Windows DPAPI (Electron's `safeStorage`). **Portable mode is different by design**: DPAPI blobs can't move between PCs, so a portable copy stores keys base64-obfuscated (NOT encrypted) in `nihilpointzero-data\settings.json` next to the exe — anyone who can read that folder (shared USB, synced drive) can recover them. Only store keys on a portable copy you physically control.

## What it does

- **Ideas & Trends**: generates video ideas scored for view potential, with reasoning, competition level, and content pillars, seeded by the model's reasoning about current finance/economics themes.
- **Script Writer**: writes full long-form scripts (short/long/deep-dive), with adjustable Roman Urdu/English mix, structured as hook → context → analysis → counterpoint → takeaway → outro.
- **Library**: saves ideas and scripts locally (JSON in your user data folder), browsable and exportable to `.txt`.
- **Settings**: swap between Claude and OpenAI, change models, manage keys.

## Building an installer

```
npm run dist:win
```

## Upgrade paths (by design)

- **Real trend data**: `src/main/trends/index.ts` is the only place that needs to change to swap the current LLM-reasoning trend source for a real YouTube Data API / Google Trends client — nothing else in the app depends on how trends are fetched.
- **New LLM provider**: implement the `LLMProvider` interface in `src/main/llm/` (see `anthropic.ts` / `openai.ts`) and register it in `src/main/llm/index.ts`.
- **Richer storage**: `src/main/store.ts` currently persists to flat JSON files; swap its internals for SQLite later without touching IPC or renderer code, since callers only see the exported functions.
