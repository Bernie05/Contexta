// Browser-side helpers for the Contexta API.
import type { Document, Folder, ModelOption, PublicSettings, RoutedDoc, SettingsUpdate, SourceRef } from "./types";
import { readNdjson } from "./utils";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  library: () => request<{ folders: Folder[]; documents: Document[] }>("/api/library"),
  models: () => request<{ models: ModelOption[]; claudeConfigured: boolean; ollamaReachable: boolean }>("/api/models"),

  createFolder: (name: string, parentId: string | null) => request<Folder>("/api/folders", json("POST", { name, parentId })),
  updateFolder: (id: string, patch: { name?: string; parentId?: string | null }) =>
    request<Folder>(`/api/folders/${id}`, json("PATCH", patch)),
  deleteFolder: (id: string) => request<void>(`/api/folders/${id}`, { method: "DELETE" }),

  upload: (files: File[], folderId: string | null) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (folderId) form.append("folderId", folderId);
    return request<{ created: Document[]; rejected: { name: string; reason: string }[] }>("/api/documents", {
      method: "POST",
      body: form,
    });
  },
  updateDocument: (id: string, patch: { name?: string; folderId?: string | null }) =>
    request<Document>(`/api/documents/${id}`, json("PATCH", patch)),
  createNote: (note: { title: string; content: string; folderId: string | null }) =>
    request<Document>("/api/notes", json("POST", note)),
  getNote: (id: string) => request<Document & { content: string }>(`/api/notes/${id}`),
  saveNote: (id: string, note: { title: string; content: string }) => request<Document>(`/api/notes/${id}`, json("PUT", note)),
  deleteDocument: (id: string) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),
  reindex: (id: string) => request<Document>(`/api/documents/${id}/reindex`, { method: "POST" }),
  settings: () => request<PublicSettings>("/api/settings"),
  saveSettings: (update: SettingsUpdate) => request<PublicSettings>("/api/settings", json("PUT", update)),
  testProvider: (
    body:
      | { kind: "anthropic"; apiKey?: string }
      | { kind: "ollama"; url: string }
      | { kind: "compat"; baseUrl: string; apiKey?: string; providerId?: string },
  ) => request<{ ok: true; message: string; models?: string[] }>("/api/settings/test", json("POST", body)),
  /** `page` jumps the browser's PDF viewer to that page; other formats ignore it. */
  fileUrl: (id: string, page?: number) => `/api/documents/${id}/file${page ? `#page=${page}` : ""}`,
};

export type ChatEvent =
  | { type: "routing"; documents: RoutedDoc[] }
  | { type: "sources"; sources: SourceRef[] }
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; error: string };

export async function* chatStream(
  body: { model: string; folderId: string | null; messages: { role: "user" | "assistant"; content: string }[] },
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch("/api/chat", { ...json("POST", body), signal });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `Chat failed (${res.status})`);
  }
  yield* readNdjson<ChatEvent>(res.body);
}

// Drag payload for moving folders and documents inside the app (one item, or the whole selection).
export const DRAG_MIME = "application/x-contexta-items";
export type DragItem = { kind: "folder" | "document"; id: string };

export function setDragItems(e: React.DragEvent, items: DragItem[]) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(items));
  e.dataTransfer.effectAllowed = "move";
}

export function readDragItems(e: React.DragEvent): DragItem[] {
  const raw = e.dataTransfer.getData(DRAG_MIME);
  if (!raw) return [];
  try {
    const items = JSON.parse(raw) as DragItem[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

/** Selection keys look like "folder:<id>" or "document:<id>". */
export const itemKey = (item: DragItem) => `${item.kind}:${item.id}`;
export function parseItemKey(key: string): DragItem {
  const i = key.indexOf(":");
  return { kind: key.slice(0, i) as DragItem["kind"], id: key.slice(i + 1) };
}

export const isInternalDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_MIME);
export const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
