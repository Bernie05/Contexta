# Contexta

Store your PDFs and Word files, organize them in folders, and chat with them. Every upload is indexed and embedded automatically (RAG), and answers cite the document and page they came from.

**Version 0.0.1**: single user, runs locally.

## Features

- **Upload PDF and Word (.docx) files** with the button or by dragging files from your desktop onto the page or onto any folder.
- **Automatic indexing**: text is extracted per page, chunked, and embedded locally in the background. The status shows Queued, Indexing, ready, or Failed.
- **Folders**: create nested folders, rename, delete, and move documents and folders by drag and drop or with **Move to…**.
- **AI assistant** (round bot button, bottom right) knows your whole library: for each question it picks the files that hold the answer, shows them, and cites the pages it used. Pick Claude or any local Ollama model.
- **Settings** (top right): add your Claude API key, point to your Ollama server, or add any OpenAI-compatible provider (OpenAI, Gemini, Groq, OpenRouter, Mistral, DeepSeek, LM Studio) with its key and models. Keys stay in the local database and are never sent back to the browser.

## Getting started

Requires **Node.js 22.13+** (it uses the built-in `node:sqlite`).

```bash
npm install
npm run dev                  # then open Settings to add an API key, or run Ollama
```

Open http://localhost:3000. The first indexed PDF downloads the embedding model (~25 MB) into `data/models/`.

To use local models, install [Ollama](https://ollama.com) and pull a chat model, e.g. `ollama pull llama3.2`. It appears in the picker automatically.

## How it works

```
Upload ─► data/files/<id>.<kind> ─► queue ─► format extractor (PDF pages / Word sections) ─► chunks (~1000 chars, 200 overlap)
       ─► transformers.js all-MiniLM-L6-v2 ─► SQLite (chunks + vectors)

Question ─► embed ─► pick top documents ─► top-6 chunks from them ─► Claude / Ollama (streamed, with [n] citations)
```

| Path | What it does |
|---|---|
| `src/lib/db.ts` | SQLite schema (folders, documents, chunks) and queries |
| `src/lib/formats/` | One folder per file type (`pdf/`, `docx/`): `meta.ts` (name, extensions, citation label) and `extract.ts` (file → text) |
| `src/lib/library.ts` | Deletes that keep the database and files on disk in step |
| `src/lib/indexer.ts` | Background indexing queue (re-queues unfinished work on restart) |
| `src/lib/embeddings.ts` | Local embedding model |
| `src/lib/retrieval.ts` | Picks the documents for a question, then searches them |
| `src/lib/llm.ts` | Model list and streaming for Claude, Ollama and OpenAI-compatible providers |
| `src/lib/settings.ts` | Saved API keys and provider settings |
| `src/lib/utils/` | Shared helpers for browser and server: `errorMessage`, `plural`, `formatBytes`, URL checks, stream readers (`readLines`, `readNdjson`), folder-tree helpers, safe localStorage |
| `src/hooks/` | React hooks: `useAsyncAction` (busy + error for any button), `useDropTarget` (drag-and-drop zones) |
| `src/app/api/*` | REST routes: `library`, `folders`, `documents`, `models`, `chat` |
| `src/components/*` | Folder tree, document pane, chat bot, settings and dialogs; `ui.tsx` holds shared pieces (`Button`, `TextInput`, `Modal`, `DialogFooter`, `ActionMenu`) |

All data lives in `data/` (git-ignored). Delete it to start fresh.

## Adding a file type

1. Create `src/lib/formats/<kind>/meta.ts` (label, extensions, MIME types, what a part is called) and `extract.ts` (signature check + text extraction).
2. Add the kind to `DocKind` in `formats/types.ts`, the meta to `FORMATS` in `formats/catalog.ts`, and the extractor to `EXTRACTORS` in `formats/registry.ts`.

Upload checks, the file picker, badges and citations pick it up from there.

## Known limits (v0.0.1)

- No accounts or auth. Run it locally only; don't expose it to the internet.
- Scanned PDFs (images only) can't be indexed yet, because there is no OCR. Old binary `.doc` files aren't supported; save them as `.docx`.
- Vector search is brute force, fine for thousands of pages but not millions.
- Chat history isn't saved; it clears on reload.
