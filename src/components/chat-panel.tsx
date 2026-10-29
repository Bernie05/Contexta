"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowUp, Bot, FileText, Loader2, Minus, NotebookPen, Settings, Sparkles, Square, Trash2, X } from "lucide-react";
import { api, chatStream } from "@/lib/api";
import { partLabel } from "@/lib/formats/catalog";
import { errorMessage, readLocal, writeLocal } from "@/lib/utils";
import type { ModelOption, RoutedDoc, SourceRef } from "@/lib/types";

interface Message {
  role: "user" | "assistant";
  content: string;
  routed?: RoutedDoc[];
  sources?: SourceRef[];
  error?: string;
}

const MODEL_KEY = "contexta:model";

const REASON_LABEL: Record<RoutedDoc["reasons"][number], string> = {
  content: "content matches the question",
  name: "file name matches",
  folder: "in the folder you have open",
};

/**
 * Floating AI assistant: a round launcher in the corner that opens the chat window.
 * It searches the whole library and picks the files itself; the open folder is a hint.
 */
export function ChatBot({
  open,
  onOpenChange,
  contextFolderId,
  prefill,
  modelsVersion,
  onOpenSettings,
  onSaveNote,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextFolderId: string | null;
  /** Text to start the question with; a new `n` replaces the input. */
  prefill: { text: string; n: number } | null;
  /** Bumped after Settings are saved, to reload the model list. */
  modelsVersion: number;
  onOpenSettings: () => void;
  /** Opens the note editor prefilled with an answer. */
  onSaveNote: (note: { title: string; content: string }) => void;
}) {
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [ollamaReachable, setOllamaReachable] = useState(false);
  const [model, setModel] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [appliedPrefill, setAppliedPrefill] = useState(0);
  if (prefill && prefill.n !== appliedPrefill) {
    setAppliedPrefill(prefill.n);
    setInput(prefill.text);
  }

  useEffect(() => {
    api
      .models()
      .then((r) => {
        setModels(r.models);
        setOllamaReachable(r.ollamaReachable);
        const saved = readLocal(MODEL_KEY);
        setModel((current) =>
          r.models.some((m) => m.id === current) ? current : (r.models.find((m) => m.id === saved)?.id ?? r.models[0]?.id ?? ""),
        );
      })
      .catch(() => setModels([]));
  }, [modelsVersion]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    const el = inputRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange, appliedPrefill]);

  async function send() {
    const question = input.trim();
    if (!question || !model || streaming) return;
    setInput("");

    const history = [...messages, { role: "user" as const, content: question }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const patchLast = (fn: (m: Message) => Message) =>
      setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])]);

    try {
      const payload = history.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
      for await (const ev of chatStream({ model, folderId: contextFolderId, messages: payload }, controller.signal)) {
        if (ev.type === "routing") patchLast((m) => ({ ...m, routed: ev.documents }));
        else if (ev.type === "sources") patchLast((m) => ({ ...m, sources: ev.sources }));
        else if (ev.type === "text") patchLast((m) => ({ ...m, content: m.content + ev.text }));
        else if (ev.type === "error") patchLast((m) => ({ ...m, error: ev.error }));
      }
    } catch (err) {
      if (!controller.signal.aborted) patchLast((m) => ({ ...m, error: errorMessage(err, "Chat failed.") }));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  const noModels = models !== null && models.length === 0;
  const groups = [...new Set((models ?? []).map((m) => m.group))];

  return (
    <>
      <section
        aria-label="AI assistant"
        hidden={!open}
        className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-surface shadow-2xl sm:inset-auto sm:right-6 sm:bottom-24 sm:h-[min(640px,calc(100vh-8rem))] sm:w-[400px] sm:rounded-2xl sm:border sm:border-border"
      >
        <header className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white dark:text-black">
              <Bot size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm leading-tight font-semibold">Contexta assistant</h2>
              <p className="text-xs leading-tight text-muted">Finds the right files and answers from them</p>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                disabled={streaming}
                aria-label="Clear conversation"
                title="Clear conversation"
                className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-40"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Minimize assistant"
              className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
            >
              <Minus size={16} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Model"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                writeLocal(MODEL_KEY, e.target.value);
              }}
              disabled={!models?.length}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
            >
              {models === null && <option>Loading models…</option>}
              {noModels && <option>No models available</option>}
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {models!.filter((m) => m.group === g).map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              onClick={onOpenSettings}
              aria-label="Model settings"
              title="Model settings"
              className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
            >
              <Settings size={15} />
            </button>
          </div>
          {noModels && (
            <p className="rounded-md bg-danger-soft px-2 py-1.5 text-xs text-danger">
              No model found.{" "}
              <button onClick={onOpenSettings} className="font-medium underline">
                Open Settings
              </button>{" "}
              to add an API key{ollamaReachable ? ", or pull a chat model with Ollama." : ", or start Ollama with a chat model."}
            </p>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="mt-8 flex flex-col items-center gap-2 text-center text-sm text-muted">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Sparkles size={22} />
              </span>
              <p className="font-medium text-foreground">Ask anything about your documents</p>
              <p className="max-w-[260px]">
                I&apos;ll work out which files hold the answer, then cite the pages I used.
              </p>
            </div>
          ) : (
            <ol className="flex flex-col gap-4">
              {messages.map((m, i) => (
                <li key={i} className={m.role === "user" ? "max-w-[85%] self-end" : "max-w-full"}>
                  {m.role === "user" ? (
                    <div className="rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm whitespace-pre-wrap text-white dark:text-black">
                      {m.content}
                    </div>
                  ) : (
                    <AssistantMessage
                      message={m}
                      pending={streaming && i === messages.length - 1}
                      onSave={() => onSaveNote(answerToNote(messages[i - 1]?.content ?? "Assistant answer", m))}
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          className="border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-accent">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder="Ask a question…"
              aria-label="Question"
              className="field-sizing-content max-h-40 min-h-6 flex-1 resize-none bg-transparent text-sm outline-none"
            />
            {streaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop"
                className="rounded-lg bg-foreground p-1.5 text-background"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || !model}
                aria-label="Send"
                className="rounded-lg bg-accent p-1.5 text-white disabled:opacity-40 dark:text-black"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </form>
      </section>

      <button
        onClick={() => onOpenChange(!open)}
        aria-label={open ? "Close assistant" : "Open assistant"}
        aria-expanded={open}
        className={`fixed right-6 bottom-6 z-50 h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg transition hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-95 dark:text-black ${
          open ? "hidden sm:flex" : "flex"
        }`}
      >
        {open ? <X size={22} /> : <Bot size={26} />}
        {!open && streaming && (
          <span className="absolute top-0.5 right-0.5 h-3 w-3 animate-pulse rounded-full border-2 border-surface bg-warning" />
        )}
      </button>
    </>
  );
}

/** A chat answer as a note: the question becomes the title, sources are listed at the end. */
function answerToNote(question: string, answer: Message): { title: string; content: string } {
  const title = question.replace(/\s+/g, " ").trim().slice(0, 120);
  const sources = (answer.sources ?? [])
    .map((s) => `- [${s.n}] ${s.documentName}, ${partLabel(s.documentKind, s.page)}`)
    .join("\n");
  return { title, content: `${answer.content.trim()}${sources ? `\n\n## Sources\n${sources}` : ""}\n` };
}

function AssistantMessage({ message, pending, onSave }: { message: Message; pending: boolean; onSave: () => void }) {
  return (
    <div className="text-sm">
      {message.routed && message.routed.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted">
          <span>Looking in</span>
          {message.routed.map((d) => (
            <span
              key={d.id}
              title={d.reasons.map((r) => REASON_LABEL[r]).join(", ")}
              className="flex max-w-[200px] items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-accent"
            >
              <FileText size={11} className="shrink-0" />
              <span className="truncate">{d.name}</span>
            </span>
          ))}
        </div>
      )}
      {message.content ? (
        <div className="prose-chat">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
      ) : pending ? (
        <span className="flex items-center gap-2 text-muted">
          <Loader2 size={14} className="animate-spin" /> {message.routed ? "Reading…" : "Finding the right files…"}
        </span>
      ) : null}
      {message.error && <p className="mt-1 rounded-md bg-danger-soft px-2 py-1 text-xs text-danger">{message.error}</p>}
      {message.sources && message.sources.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted hover:text-foreground">{message.sources.length} sources</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {message.sources.map((s) => (
              <li key={s.n}>
                <a
                  href={api.fileUrl(s.documentId, s.documentKind === "pdf" ? s.page : undefined)}
                  target="_blank"
                  rel="noreferrer"
                  title={s.snippet}
                  className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-surface-muted"
                >
                  <span className="font-mono text-muted">[{s.n}]</span>
                  <FileText size={12} className="shrink-0 text-muted" />
                  <span className="truncate">{s.documentName}</span>
                  <span className="shrink-0 text-muted">{partLabel(s.documentKind, s.page)}</span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!pending && message.content && !message.error && (
        <button
          onClick={onSave}
          className="mt-1.5 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-surface-muted hover:text-accent"
        >
          <NotebookPen size={12} /> Save to note
        </button>
      )}
    </div>
  );
}
