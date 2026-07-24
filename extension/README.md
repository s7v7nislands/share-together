# Share Together — Chrome Extension

Share articles to [Share Together](https://github.com/s7v7nislands/share_together) rooms with AI-generated summaries and tags.

## Features

- **One-click share** — Click the extension icon on any page to share it to a room
- **AI summary** — Automatically generates a concise 2-3 sentence summary of the article
- **AI tags** — Suggests 3-5 relevant tags for categorization
- **Fully editable** — Summary and tags are editable before you share
- **Multiple AI providers** — Supports OpenAI (GPT-4o-mini) and Anthropic (Claude Haiku)
- **Offline-friendly** — Generated results are cached per URL so reopening the popup doesn't re-call the AI

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked** and select the `extension/` folder from this repo
4. The extension icon appears in your toolbar

## Setup

Before using the extension, open its **Options** page (right-click the icon → Options, or click "Open Settings" in the popup):

1. **Server URL** — Enter your Share Together deployment URL (e.g., `https://share-together.your-worker.workers.dev`)
2. **Account** — Log in or register with your Share Together username and password
3. **AI Provider** — Choose OpenAI or Anthropic (Claude), paste your API key, and optionally set a model

All settings and credentials are stored locally in Chrome storage. Your AI API key is never sent to the Share Together server.

## Usage

1. Navigate to any article or webpage you want to share
2. Click the Share Together icon in the toolbar
3. Wait ~2-3 seconds while the AI generates a summary and tags
4. Edit the summary and tags if needed
5. Select the target room from the dropdown
6. Click **Share**

If the AI generation fails, you can still type a summary and tags manually.

Use the **🔄 Regenerate** button to clear the cached result and get a fresh AI pass.

## Supported AI Providers

| Provider | Default Model | API Key Format |
|---|---|---|
| OpenAI | `gpt-4o-mini` | `sk-...` |
| Anthropic | `claude-3-haiku-20240307` | `sk-ant-...` |
| DeepSeek | `deepseek-v4-flash` | `sk-...` |

You can override the model in the options page (e.g., `gpt-4o`, `claude-3-5-sonnet-20241022`).

## Files

```
extension/
├── manifest.json     Extension manifest (Manifest V3)
├── background.js     Service worker for caching
├── content.js        Article text extraction
├── ai.js             AI provider adapters
├── popup.html        Share popup UI
├── popup.css
├── popup.js          Share flow logic
├── options.html      Settings page
├── options.css
├── options.js        Auth, AI config, server URL
└── icons/            Placeholder icons (16, 48, 128)
```

## Privacy

- Article text is sent to your chosen AI provider (OpenAI or Anthropic) for summarization
- Your API key is stored in Chrome's local storage and used directly from the extension
- No data is sent to third parties beyond your configured AI provider
- Summary results are cached locally in Chrome storage keyed by URL
