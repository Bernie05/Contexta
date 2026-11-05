# Contexta

Store your PDFs, Word files and notes, organize them in folders, and chat with them. Every upload is indexed and embedded automatically (RAG), and answers cite the document and page they came from.

**Version 0.0.1**: single user, runs locally.

## Features

- **Upload PDF and Word (.docx) files** with the button or by dragging files from your desktop onto the page or onto any folder.
- **Automatic indexing**: text is extracted per page, chunked, and embedded locally in the background. The status shows Queued, Indexing, ready, or Failed.
- **Notes** (like NotebookLM): **+ New → Note** opens a Markdown editor (Write / Preview, Ctrl+S). Notes are indexed like any file, so the assistant answers from them too. Each assistant answer has **Save to note**, which keeps the answer and its sources. Uploaded `.md` and `.txt` files become editable notes.
- **Summaries**: a document's **⋯ → Create summary** reads the whole file with the model picked in chat and saves the result as a new, named file of the same type in the same folder: a PDF gives a PDF, a Word file gives a Word file, and a note gives a note. If the PDF font can't show the language, such as Chinese, the summary is saved as a note instead.
- **Save from a link**: **+ New → From URL** saves a web page's article text as a PDF in the open folder, or keeps the original file if the link is already a PDF. Only public addresses are allowed.
- **Folders**: create nested folders, rename, delete, and move documents and folders by drag and drop or with **Move to…**.
- **AI assistant** (round bot button, bottom right) knows your whole library: for each question it picks the files that hold the answer, shows them, and cites the pages it used. Pick Claude or any local Ollama model.
- **Small screens**: the ☰ button opens the folder sidebar as a drawer.
- **Settings** (top right): add your Claude API key, point to your Ollama server, or add any OpenAI-compatible provider (OpenAI, Gemini, Groq, OpenRouter, Mistral, DeepSeek, LM Studio) with its key and models. Keys stay in the database and are never sent back to the browser.

## Getting started

Requires **Node.js 22.13+**. The database is built in, so there is nothing else to install.

```bash
npm install
npm run dev                  # then open Settings to add an API key, or run Ollama
```

Open http://localhost:3000. The first indexed PDF downloads the embedding model (~25 MB) into `data/models/`.

To use local models, install [Ollama](https://ollama.com) and pull a chat model, e.g. `ollama pull llama3.2`. It appears in the picker automatically.

## How it works

```
Upload ─► data/files/<id>.<kind> ─► queue ─► format extractor (PDF pages / Word sections) ─► chunks (~1000 chars, 200 overlap)
       ─► transformers.js all-MiniLM-L6-v2 ─► Postgres (chunks, pgvector embeddings, full-text index)

Question ─► embed ─► vector + keyword search ─► pick top documents ─► top-6 chunks from them ─► Claude / Ollama (streamed, with [n] citations)
```

| Path | What it does |
|---|---|
| `src/lib/db.ts` | Picks the database (PGlite or `DATABASE_URL`) and holds the shared queries |
| `src/lib/schema.ts` | Postgres schema (folders, documents, chunks, settings) |
| `src/lib/formats/` | One folder per file type (`pdf/`, `docx/`, `note/`): `meta.ts` (name, extensions, citation label) and `extract.ts` (file → text), and `write.ts` (text → file) for PDF and Word |
| `src/lib/library.ts` | Create, replace and delete documents, keeping the database, files on disk and search index in step |
| `src/lib/indexer.ts` | Background indexing queue (re-queues unfinished work on restart) |
| `src/lib/embeddings.ts` | Local embedding model |
| `src/lib/retrieval.ts` | Hybrid search (vectors + keywords), then picks the documents for a question |
| `src/lib/llm.ts` | Model list and streaming for Claude, Ollama and OpenAI-compatible providers |
| `src/lib/settings.ts` | Saved API keys and provider settings |
| `src/lib/utils/` | Shared helpers for browser and server: `errorMessage`, `plural`, `formatBytes`, URL checks, stream readers (`readLines`, `readNdjson`), folder-tree helpers, safe localStorage |
| `src/hooks/` | React hooks: `useAsyncAction` (busy + error for any button), `useDropTarget` (drag-and-drop zones) |
| `src/app/api/*` | REST routes: `library`, `folders`, `documents`, `models`, `chat` |
| `src/components/*` | Folder tree, document pane, chat bot, settings and dialogs; `ui.tsx` holds shared pieces (`Button`, `TextInput`, `Modal`, `DialogFooter`, `ActionMenu`) |

All data lives in `data/` (git-ignored). Delete it to start fresh.

## Database

Contexta always speaks PostgreSQL, with `pgvector` for embeddings and a `tsvector` column for keyword search. `DATABASE_URL` picks where it runs:

| `DATABASE_URL` | Database | Data lives in |
|---|---|---|
| Not set | [PGlite](https://pglite.dev), Postgres built into the app | `data/pg/` |
| Set | Any Postgres server with `pgvector` | That server |

Each database keeps its own data, so changing the setting doesn't move anything. To move your library to a server, stop the app, set `DATABASE_URL`, and run `npm run db:copy` (needs Node.js 22.18+). It refuses to copy into a database that already has data. Uploaded files stay in `data/files/` either way.

PGlite allows one process at a time, so `data/pg.lock` stops a second app or script from opening it. Stop the app before using the local database from a script.

Run a query with `npm run db:query -- "SELECT id, name FROM folders"`.

## Adding a file type

1. Create `src/lib/formats/<kind>/meta.ts` (label, extensions, MIME types, what a part is called) `extract.ts` (signature check + text extraction) and `write.ts` (creates a file, used for summaries).
2. Add the kind to `DocKind` in `formats/types.ts`, the meta to `FORMATS` in `formats/catalog.ts`, and the extractor to `EXTRACTORS` in `formats/registry.ts`.

Upload checks, the file picker, badges and citations pick it up from there.

## Known limits (v0.0.1)

- No accounts or auth. Run it locally only; don't expose it to the internet.
- Scanned PDFs (images only) can't be indexed yet, because there is no OCR. Old binary `.doc` files aren't supported; save them as `.docx`.
- Vector search is brute force, fine for thousands of pages but not millions.
- Chat history isn't saved; it clears on reload.
- Saving from a link keeps the text only, not images. Pages that need a login or build their content with JavaScript can't be saved.
