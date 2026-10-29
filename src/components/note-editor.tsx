"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useAsyncAction } from "@/hooks/use-async-action";
import { api } from "@/lib/api";
import type { Document } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { Button, Modal, TextInput } from "./ui";

/**
 * Markdown note editor. Saving re-indexes the note, so the assistant can answer
 * from it like any other document. `noteId` omitted = a new note in `folderId`.
 */
export function NoteEditor({
  noteId,
  folderId,
  initial,
  onSaved,
  onClose,
}: {
  noteId?: string;
  folderId: string | null;
  /** Starting title and content for a new note (e.g. a saved chat answer). */
  initial?: { title: string; content: string };
  onSaved: (doc: Document) => void;
  onClose: () => void;
}) {
  const [id, setId] = useState(noteId);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [saved, setSaved] = useState({ title: initial ? "" : title, content: initial ? "" : content });
  const [loading, setLoading] = useState(Boolean(noteId));
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [justSaved, setJustSaved] = useState(false);
  const { busy, error, run } = useAsyncAction();
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!noteId) return;
    api.getNote(noteId).then(
      (n) => {
        setTitle(n.name);
        setContent(n.content);
        setSaved({ title: n.name, content: n.content });
        setLoading(false);
      },
      (err) => {
        setLoadError(errorMessage(err, "Couldn't open the note."));
        setLoading(false);
      },
    );
  }, [noteId]);

  const dirty = title !== saved.title || content !== saved.content;

  async function save() {
    const t = title.trim();
    if (!t || busy) return;
    const ok = await run(async () => {
      const doc = id ? await api.saveNote(id, { title: t, content }) : await api.createNote({ title: t, content, folderId });
      setId(doc.id);
      setSaved({ title: t, content });
      setTitle(t);
      onSaved(doc);
    });
    if (ok) {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    }
  }

  function close() {
    if (dirty && !window.confirm("Discard unsaved changes to this note?")) return;
    onClose();
  }

  return (
    <Modal title={id ? "Edit note" : "New note"} onClose={close} size="lg">
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Opening note…
        </div>
      ) : loadError ? (
        <p className="text-sm text-danger">{loadError}</p>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col gap-3"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              void save();
            }
          }}
        >
          <TextInput
            aria-label="Note title"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus={!title}
            className="text-base font-medium"
          />

          <div role="tablist" className="flex gap-1 text-sm">
            {(["write", "preview"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 capitalize ${tab === t ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-muted"}`}
              >
                {t}
              </button>
            ))}
            <span className="ml-auto self-center text-xs text-muted">Markdown supported · Ctrl+S to save</span>
          </div>

          {tab === "write" ? (
            <textarea
              aria-label="Note content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              autoFocus={Boolean(title)}
              placeholder={"Write your notes here…\n\n# Headings start new sections\n- Lists, **bold**, links and tables work too"}
              className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-background p-3 font-mono text-sm leading-relaxed outline-none focus:border-accent"
            />
          ) : (
            <div className="prose-chat min-h-0 flex-1 overflow-y-auto rounded-lg border border-border p-4 text-sm">
              {content.trim() ? <ReactMarkdown>{content}</ReactMarkdown> : <p className="text-muted">Nothing to preview yet.</p>}
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            {justSaved && (
              <span className="mr-auto flex items-center gap-1 text-xs text-accent">
                <CheckCircle2 size={13} /> Saved. The assistant can use it once indexing finishes.
              </span>
            )}
            {!justSaved && dirty && <span className="mr-auto text-xs text-muted">Unsaved changes</span>}
            <Button onClick={close}>Close</Button>
            <Button variant="primary" onClick={save} disabled={busy || !title.trim() || (!dirty && Boolean(id))}>
              {busy && <Loader2 size={14} className="animate-spin" />} Save
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
