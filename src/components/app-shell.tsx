"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Menu, Settings, X } from "lucide-react";
import { api, isFileDrag, parseItemKey, readDragItems, type DragItem } from "@/lib/api";
import { formatForFileName, stripExtension, SUPPORTED_LABEL } from "@/lib/formats/catalog";
import type { Document, Folder } from "@/lib/types";
import { errorMessage, groupByParent, pathTo, plural, subtreeIds } from "@/lib/utils";
import { FolderTree } from "./folder-tree";
import { DocumentPane, type ItemAction } from "./document-pane";
import { ChatBot } from "./chat-panel";
import { MoveDialog } from "./move-dialog";
import { NoteEditor } from "./note-editor";
import { SettingsDialog } from "./settings-dialog";
import { ConfirmDialog, PromptDialog } from "./ui";

type Dialog = ItemAction | { kind: "newFolder"; parentId: string | null } | { kind: "bulkMove" | "bulkDelete" } | null;

export function AppShell() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [openId, setCurrentId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [chatPrefill, setChatPrefill] = useState<{ text: string; n: number } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelsVersion, setModelsVersion] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false); // drawer on small screens
  // Note editor: an existing note's id, or a new note (optionally prefilled, e.g. from a chat answer).
  const [noteEditor, setNoteEditor] = useState<{ id?: string; initial?: { title: string; content: string } } | null>(null);
  // Selection belongs to the folder it was made in; opening another folder starts empty.
  const [selection, setSelection] = useState<{ folderId: string | null; keys: Set<string> }>({ folderId: null, keys: new Set() });

  // Loads folders and documents; used on mount, after every change, and while indexing.
  const refresh = useCallback(
    () =>
      api.library().then(
        (lib) => {
          setFolders(lib.folders);
          setDocuments(lib.documents);
        },
        (err) => setNotice({ text: errorMessage(err, "Couldn't load library."), tone: "error" }),
      ),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while anything is still indexing.
  const indexing = documents.some((d) => d.status === "queued" || d.status === "processing");
  useEffect(() => {
    if (!indexing) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [indexing, refresh]);

  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  // If the open folder disappears (deleted), show the root.
  const current = openId ? folderById.get(openId) : undefined;
  const currentId = current?.id ?? null;
  const selected = selection.folderId === currentId ? selection.keys : new Set<string>();
  const selectedItems = [...selected].map(parseItemKey);
  const clearSelection = () => setSelection({ folderId: currentId, keys: new Set() });

  const path = useMemo(() => pathTo(folderById, currentId), [folderById, currentId]);

  const docCounts = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const d of documents) m.set(d.folder_id, (m.get(d.folder_id) ?? 0) + 1);
    return m;
  }, [documents]);

  const folderChildren = useMemo(() => groupByParent(folders), [folders]);
  const subtreeOf = useCallback((id: string) => subtreeIds(folderChildren, id), [folderChildren]);

  function flash(text: string, tone: "info" | "error" = "info") {
    setNotice({ text, tone });
    setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 5000);
  }

  const flashError = (err: unknown, fallback: string) => flash(errorMessage(err, fallback), "error");

  async function upload(files: File[], folderId: string | null) {
    // The server re-checks every file; this just skips obviously unsupported ones early.
    const supported = files.filter((f) => formatForFileName(f.name));
    if (supported.length === 0) return flash(`Only ${SUPPORTED_LABEL} files can be uploaded.`, "error");
    setUploading(true);
    try {
      const res = await api.upload(supported, folderId);
      if (res.rejected.length) flash(res.rejected.map((r) => `${r.name}: ${r.reason}`).join(" "), "error");
      else flash(`Uploaded ${plural(res.created.length, "file")}. Indexing…`);
    } catch (err) {
      flashError(err, "Upload failed.");
    } finally {
      setUploading(false);
      void refresh();
    }
  }

  /** Moves folders and documents into `targetId` (null = top level), skipping ones already there. */
  async function moveItems(items: DragItem[], targetId: string | null) {
    if (targetId && items.some((i) => i.kind === "folder" && subtreeOf(i.id).has(targetId))) {
      throw new Error("Can't move a folder into itself.");
    }
    const moves = items.flatMap((item): Promise<unknown>[] => {
      if (item.kind === "document") {
        const doc = documents.find((d) => d.id === item.id);
        return doc && doc.folder_id !== targetId ? [api.updateDocument(item.id, { folderId: targetId })] : [];
      }
      const folder = folderById.get(item.id);
      return folder && folder.parent_id !== targetId ? [api.updateFolder(item.id, { parentId: targetId })] : [];
    });
    if (moves.length === 0) return;
    try {
      await Promise.all(moves);
    } finally {
      clearSelection();
      await refresh();
    }
  }

  async function handleDrop(e: React.DragEvent, targetId: string | null) {
    if (isFileDrag(e)) return upload(Array.from(e.dataTransfer.files), targetId);
    const items = readDragItems(e);
    if (items.length === 0) return;
    try {
      await moveItems(items, targetId);
    } catch (err) {
      flashError(err, "Move failed.");
    }
  }

  async function handleAction(action: ItemAction) {
    if (action.kind === "newSubfolder") {
      setDialog({ kind: "newFolder", parentId: action.folder.id });
      return;
    }
    if (action.kind === "openNote") {
      setNoteEditor({ id: action.doc.id });
      return;
    }
    if (action.kind === "ask") {
      // Naming the file steers the assistant's file picking toward it.
      setChatPrefill((p) => ({ text: `About "${stripExtension(action.doc.name)}": `, n: (p?.n ?? 0) + 1 }));
      setChatOpen(true);
      return;
    }
    if (action.kind === "reindex") {
      try {
        await api.reindex(action.doc.id);
        await refresh();
      } catch (err) {
        flashError(err, "Re-index failed.");
      }
      return;
    }
    setDialog(action);
  }

  const close = () => setDialog(null);

  // Opening a folder from the drawer also closes it.
  const openFolder = (id: string | null) => {
    setCurrentId(id);
    setSidebarOpen(false);
  };

  // Shared by the desktop column and the mobile drawer.
  const sidebar = (
    <>
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">Folders</span>
        <button
          onClick={() => setDialog({ kind: "newFolder", parentId: currentId })}
          className="rounded-md px-1.5 text-lg leading-none text-muted hover:bg-surface-muted hover:text-foreground"
          aria-label="New folder"
          title="New folder"
        >
          +
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <FolderTree
          folders={folders}
          currentId={currentId}
          docCounts={docCounts}
          onOpen={openFolder}
          onDrop={handleDrop}
          onNewFolder={(parentId) => setDialog({ kind: "newFolder", parentId })}
          onAction={handleAction}
        />
      </div>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Show folders"
          aria-expanded={sidebarOpen}
          className="-ml-1 rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground lg:hidden"
        >
          <Menu size={20} />
        </button>
        <BookOpen size={20} className="text-accent" />
        <span className="font-semibold tracking-tight">Contexta</span>
        <span className="text-xs text-muted">v0.0.1</span>
        <button
          onClick={() => setSettingsOpen(true)}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <Settings size={16} /> <span className="hidden sm:inline">Settings</span>
        </button>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside aria-label="Folders sidebar" className="hidden min-h-0 flex-col border-r border-border bg-surface lg:flex">
          {sidebar}
        </aside>

        <div className="flex min-h-0 flex-col pb-20">
          <DocumentPane
            path={path}
            subfolders={folders.filter((f) => f.parent_id === currentId)}
            documents={documents.filter((d) => d.folder_id === currentId)}
            uploading={uploading}
            selected={selected}
            onSelectionChange={(keys) => setSelection({ folderId: currentId, keys })}
            onBulkMove={() => setDialog({ kind: "bulkMove" })}
            onBulkDelete={() => setDialog({ kind: "bulkDelete" })}
            onOpenFolder={setCurrentId}
            onNewFolder={() => setDialog({ kind: "newFolder", parentId: currentId })}
            onNewNote={() => setNoteEditor({})}
            onUpload={(files) => upload(files, currentId)}
            onDrop={handleDrop}
            onAction={handleAction}
          />
        </div>

      </div>

      <ChatBot
        open={chatOpen}
        onOpenChange={setChatOpen}
        contextFolderId={currentId}
        prefill={chatPrefill}
        modelsVersion={modelsVersion}
        onOpenSettings={() => setSettingsOpen(true)}
        onSaveNote={(initial) => setNoteEditor({ initial })}
      />

      {/* Folder drawer for small screens */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" onKeyDown={(e) => e.key === "Escape" && setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside
            aria-label="Folders sidebar"
            className="relative flex h-full w-72 max-w-[85vw] flex-col bg-surface shadow-xl"
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <BookOpen size={20} className="text-accent" />
              <span className="font-semibold tracking-tight">Contexta</span>
              <button
                autoFocus
                onClick={() => setSidebarOpen(false)}
                aria-label="Close folders"
                className="ml-auto rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      {noteEditor && (
        <NoteEditor
          noteId={noteEditor.id}
          folderId={currentId}
          initial={noteEditor.initial}
          onSaved={() => void refresh()}
          onClose={() => setNoteEditor(null)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setModelsVersion((v) => v + 1);
            flash("Settings saved.");
          }}
        />
      )}

      {notice && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-2 text-sm shadow-lg ${
            notice.tone === "error" ? "bg-danger text-white dark:text-black" : "bg-foreground text-background"
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {dialog?.kind === "newFolder" && (
        <PromptDialog
          title="New folder"
          label={`Inside ${dialog.parentId ? (folderById.get(dialog.parentId)?.name ?? "folder") : "Library"}`}
          submitLabel="Create"
          onSubmit={async (name) => {
            await api.createFolder(name, dialog.parentId);
            await refresh();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "renameFolder" && (
        <PromptDialog
          title="Rename folder"
          label="Name"
          initial={dialog.folder.name}
          submitLabel="Rename"
          onSubmit={async (name) => {
            await api.updateFolder(dialog.folder.id, { name });
            await refresh();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "renameDoc" && (
        <PromptDialog
          title="Rename document"
          label="Name"
          initial={dialog.doc.name}
          submitLabel="Rename"
          onSubmit={async (name) => {
            await api.updateDocument(dialog.doc.id, { name });
            await refresh();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "moveDoc" && (
        <MoveDialog
          itemName={dialog.doc.name}
          folders={folders}
          currentFolderId={dialog.doc.folder_id}
          onMove={async (folderId) => {
            await api.updateDocument(dialog.doc.id, { folderId });
            await refresh();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "moveFolder" && (
        <MoveDialog
          itemName={dialog.folder.name}
          folders={folders}
          currentFolderId={dialog.folder.parent_id}
          excluded={subtreeOf(dialog.folder.id)}
          onMove={async (parentId) => {
            await api.updateFolder(dialog.folder.id, { parentId });
            await refresh();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "bulkMove" && (
        <MoveDialog
          itemName={plural(selectedItems.length, "item")}
          folders={folders}
          currentFolderId={currentId}
          excluded={new Set(selectedItems.filter((i) => i.kind === "folder").flatMap((i) => [...subtreeOf(i.id)]))}
          onMove={(target) => moveItems(selectedItems, target)}
          onClose={close}
        />
      )}
      {dialog?.kind === "bulkDelete" &&
        (() => {
          const folderIds = selectedItems.filter((i) => i.kind === "folder").map((i) => i.id);
          const docIds = selectedItems.filter((i) => i.kind === "document").map((i) => i.id);
          const inside = new Set(folderIds.flatMap((id) => [...subtreeOf(id)]));
          const nestedDocs = documents.filter((d) => d.folder_id && inside.has(d.folder_id)).length;
          const parts = [
            folderIds.length && plural(folderIds.length, "folder"),
            docIds.length && plural(docIds.length, "document"),
          ].filter(Boolean);
          return (
            <ConfirmDialog
              title={`Delete ${plural(selectedItems.length, "item")}?`}
              message={
                <>
                  {parts.join(" and ")}
                  {nestedDocs ? `, plus ${plural(nestedDocs, "document")} inside the folders,` : ""} will be deleted
                  permanently.
                </>
              }
              confirmLabel="Delete"
              onConfirm={async () => {
                try {
                  await Promise.all([...folderIds.map(api.deleteFolder), ...docIds.map(api.deleteDocument)]);
                } finally {
                  clearSelection();
                  await refresh();
                }
              }}
              onClose={close}
            />
          );
        })()}
      {dialog?.kind === "deleteDoc" && (
        <ConfirmDialog
          title="Delete document?"
          message={<>&ldquo;{dialog.doc.name}&rdquo; and its index will be removed permanently.</>}
          confirmLabel="Delete"
          onConfirm={async () => {
            await api.deleteDocument(dialog.doc.id);
            await refresh();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "deleteFolder" &&
        (() => {
          const ids = subtreeOf(dialog.folder.id);
          const docCount = documents.filter((d) => d.folder_id && ids.has(d.folder_id)).length;
          return (
            <ConfirmDialog
              title="Delete folder?"
              message={
                <>
                  &ldquo;{dialog.folder.name}&rdquo;
                  {ids.size > 1 ? `, its ${plural(ids.size - 1, "subfolder")}` : ""}
                  {docCount ? ` and ${plural(docCount, "document")} inside` : ""} will be deleted permanently.
                </>
              }
              confirmLabel="Delete"
              onConfirm={async () => {
                await api.deleteFolder(dialog.folder.id);
                await refresh();
              }}
              onClose={close}
            />
          );
        })()}
    </div>
  );
}
