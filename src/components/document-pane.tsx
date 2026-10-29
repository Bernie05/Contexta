"use client";

import { useRef } from "react";
import {
  AlertCircle,
  ChevronRight,
  ExternalLink,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  Loader2,
  MessageSquare,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useDropTarget } from "@/hooks/use-drop-target";
import { api, itemKey, parseItemKey, setDragItems, type DragItem } from "@/lib/api";
import { ACCEPT, formatOf, partCount, SUPPORTED_LABEL } from "@/lib/formats/catalog";
import type { DocKind, Document, Folder } from "@/lib/types";
import { formatBytes, toggled } from "@/lib/utils";
import { ActionMenu, Button, type MenuItem } from "./ui";

export type ItemAction =
  | { kind: "newSubfolder" | "renameFolder" | "deleteFolder" | "moveFolder"; folder: Folder }
  | { kind: "renameDoc" | "deleteDoc" | "moveDoc" | "reindex" | "ask" | "openNote"; doc: Document };

/** Menu entries for a folder, shared by the document list and the sidebar tree. */
export function folderMenu(folder: Folder, onAction: (a: ItemAction) => void): MenuItem[] {
  return [
    { label: "New subfolder", icon: <FolderPlus size={14} />, onSelect: () => onAction({ kind: "newSubfolder", folder }) },
    { label: "Rename", icon: <Pencil size={14} />, onSelect: () => onAction({ kind: "renameFolder", folder }) },
    { label: "Move to…", icon: <FolderInput size={14} />, onSelect: () => onAction({ kind: "moveFolder", folder }) },
    { label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => onAction({ kind: "deleteFolder", folder }) },
  ];
}

interface Props {
  path: Folder[]; // root → current
  subfolders: Folder[];
  documents: Document[];
  uploading: boolean;
  selected: Set<string>;
  onSelectionChange: (keys: Set<string>) => void;
  onBulkMove: () => void;
  onBulkDelete: () => void;
  onOpenFolder: (id: string | null) => void;
  onNewFolder: () => void;
  onNewNote: () => void;
  onUpload: (files: File[]) => void;
  onDrop: (e: React.DragEvent, targetId: string | null) => void;
  onAction: (action: ItemAction) => void;
}

export function DocumentPane({
  path,
  subfolders,
  documents,
  uploading,
  selected,
  onSelectionChange,
  onBulkMove,
  onBulkDelete,
  onOpenFolder,
  onNewFolder,
  onNewNote,
  onUpload,
  onDrop,
  onAction,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const currentId = path.at(-1)?.id ?? null;
  const { over: dragOver, dropProps } = useDropTarget((e) => onDrop(e, currentId));
  const empty = subfolders.length === 0 && documents.length === 0;

  const allKeys = [
    ...subfolders.map((f) => itemKey({ kind: "folder", id: f.id })),
    ...documents.map((d) => itemKey({ kind: "document", id: d.id })),
  ];
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const selecting = selected.size > 0;

  const toggle = (key: string) => onSelectionChange(toggled(selected, key));

  // Dragging a selected row carries the whole selection; an unselected row drags alone.
  const dragItemsFor = (item: DragItem): DragItem[] =>
    selected.has(itemKey(item)) ? [...selected].map(parseItemKey) : [item];

  return (
    <section
      aria-label="Documents"
      className="relative flex min-h-0 flex-1 flex-col"
      {...dropProps}
    >
      {selecting ? (
        <header className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft px-5 py-3">
          <button
            onClick={() => onSelectionChange(new Set())}
            aria-label="Clear selection"
            className="rounded-md p-1 text-accent hover:bg-surface"
          >
            <X size={16} />
          </button>
          <span className="flex-1 text-sm font-medium text-accent">{selected.size} selected</span>
          <Button onClick={onBulkMove}>
            <FolderInput size={15} /> Move to…
          </Button>
          <Button variant="danger" onClick={onBulkDelete}>
            <Trash2 size={15} /> Delete
          </Button>
        </header>
      ) : (
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
            <button onClick={() => onOpenFolder(null)} className="text-muted hover:text-foreground">
              Library
            </button>
            {path.map((f, i) => (
              <span key={f.id} className="flex min-w-0 items-center gap-1">
                <ChevronRight size={14} className="shrink-0 text-muted" />
                <button
                  onClick={() => onOpenFolder(f.id)}
                  className={`truncate ${i === path.length - 1 ? "font-medium" : "text-muted hover:text-foreground"}`}
                >
                  {f.name}
                </button>
              </span>
            ))}
          </nav>
          <ActionMenu
            label="Create new"
            trigger={
              <>
                <Plus size={15} /> New
              </>
            }
            items={[
              { label: "Note", icon: <NotebookPen size={14} />, onSelect: onNewNote },
              { label: "Folder", icon: <FolderPlus size={14} />, onSelect: onNewFolder },
            ]}
          />
          <Button variant="primary" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Upload
          </Button>
        </header>
      )}
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onUpload(files);
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {empty ? (
          <button
            onClick={() => fileInput.current?.click()}
            className="mx-2 mt-6 flex w-[calc(100%-1rem)] flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border px-6 py-14 text-center text-muted hover:border-accent hover:text-foreground"
          >
            <Upload size={28} />
            <span className="font-medium text-foreground">Drop files here or click to upload</span>
            <span className="text-sm">{SUPPORTED_LABEL}</span>
            <span className="text-sm">They are indexed automatically so you can ask questions about them.</span>
          </button>
        ) : (
          <>
            <label className="flex items-center gap-3 px-3 py-1.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onSelectionChange(allSelected ? new Set() : new Set(allKeys))}
                className="h-4 w-4 accent-accent"
              />
              Select all
            </label>
            <ul className="flex flex-col">
              {subfolders.map((f) => {
                const key = itemKey({ kind: "folder", id: f.id });
                return (
                  <FolderRow
                    key={f.id}
                    folder={f}
                    checked={selected.has(key)}
                    onToggle={() => toggle(key)}
                    onDragStart={(e) => setDragItems(e, dragItemsFor({ kind: "folder", id: f.id }))}
                    onOpen={() => onOpenFolder(f.id)}
                    onDrop={(e) => onDrop(e, f.id)}
                    onAction={onAction}
                  />
                );
              })}
              {documents.map((d) => {
                const key = itemKey({ kind: "document", id: d.id });
                return (
                  <DocumentRow
                    key={d.id}
                    doc={d}
                    checked={selected.has(key)}
                    onToggle={() => toggle(key)}
                    onDragStart={(e) => setDragItems(e, dragItemsFor({ kind: "document", id: d.id }))}
                    onAction={onAction}
                  />
                );
              })}
            </ul>
          </>
        )}
      </div>

      {dragOver && (
        <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-soft/70 text-sm font-medium text-accent">
          Drop to {path.length ? `add to "${path.at(-1)!.name}"` : "add to Library"}
        </div>
      )}
    </section>
  );
}

function RowCheckbox({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onToggle}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Select ${label}`}
      className="h-4 w-4 shrink-0 accent-accent"
    />
  );
}

function FolderRow({
  folder,
  checked,
  onToggle,
  onDragStart,
  onOpen,
  onDrop,
  onAction,
}: {
  folder: Folder;
  checked: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onOpen: () => void;
  onDrop: (e: React.DragEvent) => void;
  onAction: (a: ItemAction) => void;
}) {
  const { over, dropProps } = useDropTarget(onDrop, { nested: true });
  return (
    <li
      draggable
      onDragStart={onDragStart}
      {...dropProps}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
        over ? "bg-accent-soft ring-1 ring-accent" : checked ? "bg-accent-soft" : "hover:bg-surface-muted"
      }`}
    >
      <RowCheckbox checked={checked} onToggle={onToggle} label={folder.name} />
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm">
        <FolderIcon size={18} className="shrink-0 text-accent" />
        <span className="truncate font-medium">{folder.name}</span>
      </button>
      <ActionMenu label={`Actions for ${folder.name}`} items={folderMenu(folder, onAction)} />
    </li>
  );
}

function DocumentRow({
  doc,
  checked,
  onToggle,
  onDragStart,
  onAction,
}: {
  doc: Document;
  checked: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onAction: (a: ItemAction) => void;
}) {
  const busy = doc.status === "queued" || doc.status === "processing";
  const format = formatOf(doc.kind);
  return (
    <li
      draggable
      onDragStart={onDragStart}
      className={`flex cursor-grab items-center gap-3 rounded-lg px-3 py-2 active:cursor-grabbing ${
        checked ? "bg-accent-soft" : "hover:bg-surface-muted"
      }`}
    >
      <RowCheckbox checked={checked} onToggle={onToggle} label={doc.name} />
      <KindBadge kind={doc.kind} />
      <div className="min-w-0 flex-1">
        {format.editable ? (
          <button onClick={() => onAction({ kind: "openNote", doc })} className="block max-w-full truncate text-left text-sm hover:underline">
            {doc.name}
          </button>
        ) : (
          <a href={api.fileUrl(doc.id)} target="_blank" rel="noreferrer" className="block truncate text-sm hover:underline">
            {doc.name}
          </a>
        )}
        <p className="text-xs text-muted">
          {formatBytes(doc.size)}
          {doc.page_count ? ` · ${partCount(doc.kind, doc.page_count)}` : ""}
          {doc.status === "ready" ? ` · ${doc.chunk_count} chunks` : ""}
        </p>
      </div>
      <StatusBadge doc={doc} />
      <button
        onClick={() => onAction({ kind: "ask", doc })}
        disabled={doc.status !== "ready"}
        title="Ask about this document"
        aria-label={`Ask about ${doc.name}`}
        className="rounded-md p-1 text-muted hover:bg-surface hover:text-accent disabled:opacity-30"
      >
        <MessageSquare size={16} />
      </button>
      <ActionMenu
        label={`Actions for ${doc.name}`}
        items={[
          format.editable
            ? { label: "Edit note", icon: <NotebookPen size={14} />, onSelect: () => onAction({ kind: "openNote", doc }) }
            : {
                label: format.previewInline ? `Open ${format.label}` : "Download",
                icon: <ExternalLink size={14} />,
                onSelect: () => window.open(api.fileUrl(doc.id), "_blank"),
              },
          { label: "Rename", icon: <Pencil size={14} />, onSelect: () => onAction({ kind: "renameDoc", doc }) },
          { label: "Move to…", icon: <FolderInput size={14} />, onSelect: () => onAction({ kind: "moveDoc", doc }) },
          { label: "Re-index", icon: <RefreshCw size={14} />, disabled: busy, onSelect: () => onAction({ kind: "reindex", doc }) },
          { label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => onAction({ kind: "deleteDoc", doc }) },
        ]}
      />
    </li>
  );
}

const KIND_STYLE: Record<DocKind, string> = {
  pdf: "bg-red-500/10 text-red-700 dark:text-red-300",
  docx: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  note: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
};

/** Small file-type tag, e.g. "PDF", "DOCX" or "NOTE". */
function KindBadge({ kind }: { kind: DocKind }) {
  return (
    <span className={`flex h-6 w-11 shrink-0 items-center justify-center rounded text-[10px] font-semibold tracking-wide ${KIND_STYLE[kind]}`}>
      {kind.toUpperCase()}
    </span>
  );
}

function StatusBadge({ doc }: { doc: Document }) {
  if (doc.status === "ready") return null;
  if (doc.status === "error")
    return (
      <span title={doc.error ?? undefined} className="flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger">
        <AlertCircle size={12} /> Failed
      </span>
    );
  return (
    <span className="flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted">
      <Loader2 size={12} className="animate-spin" /> {doc.status === "queued" ? "Queued" : "Indexing"}
    </span>
  );
}
