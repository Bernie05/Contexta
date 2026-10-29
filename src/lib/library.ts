import "server-only";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { db, documentsInFolders, filePath, folderSubtree, getDocument } from "./db";
import type { DocKind } from "./formats/types";
import { enqueue } from "./indexer";
import type { Document } from "./types";

// Every change to a document goes through here, so the database row, the file
// on disk and the search index stay in step.

/** Stores a new document and queues it for indexing. */
export async function createDocument(input: {
  name: string;
  kind: DocKind;
  folderId: string | null;
  bytes: Uint8Array;
}): Promise<Document> {
  const id = randomUUID();
  await fs.writeFile(filePath(id, input.kind), input.bytes);
  db()
    .prepare("INSERT INTO documents (id, name, kind, folder_id, size, status) VALUES (?, ?, ?, ?, ?, 'queued')")
    .run(id, input.name, input.kind, input.folderId, input.bytes.byteLength);
  enqueue(id);
  return getDocument(id)!;
}

/** Replaces a document's content (and optionally its name), then re-indexes it. */
export async function replaceContent(id: string, bytes: Uint8Array, name?: string): Promise<Document | undefined> {
  const doc = getDocument(id);
  if (!doc) return undefined;
  await fs.writeFile(filePath(id, doc.kind), bytes);
  db()
    .prepare("UPDATE documents SET name = COALESCE(?, name), size = ?, status = 'queued', error = NULL WHERE id = ?")
    .run(name ?? null, bytes.byteLength, id);
  enqueue(id);
  return getDocument(id);
}

export async function deleteDocument(id: string): Promise<boolean> {
  const doc = getDocument(id);
  if (!doc) return false;
  db().prepare("DELETE FROM documents WHERE id = ?").run(id); // cascades to chunks
  await fs.rm(filePath(id, doc.kind), { force: true });
  return true;
}

/** Deletes a folder with its subfolders and every document inside them. */
export async function deleteFolder(id: string): Promise<void> {
  const docs = documentsInFolders(folderSubtree(id));
  db().prepare("DELETE FROM folders WHERE id = ?").run(id); // cascades to subfolders, documents, chunks
  await Promise.all(docs.map((d) => fs.rm(filePath(d.id, d.kind), { force: true })));
}
