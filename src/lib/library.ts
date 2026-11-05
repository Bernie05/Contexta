import "server-only";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { documentsInFolders, filePath, folderSubtree, getDocument, query } from "./db";
import { formatOf } from "./formats/catalog";
import { extractorFor } from "./formats/registry";
import type { DocKind, WrittenDocument } from "./formats/types";
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
  await query("INSERT INTO documents (id, name, kind, folder_id, size, status) VALUES ($1, $2, $3, $4, $5, 'queued')", [
    id,
    input.name,
    input.kind,
    input.folderId,
    input.bytes.byteLength,
  ]);
  enqueue(id);
  return (await getDocument(id))!;
}

/** Writes generated text as a file. It's saved as a note if that format can't show the text. */
export async function createWrittenDocument(output: WrittenDocument, kind: DocKind, folderId: string | null): Promise<Document> {
  const file = await extractorFor(kind).write(output);
  const savedKind = file ? kind : "note";
  return createDocument({
    name: savedKind === "note" ? output.title : `${output.title}${formatOf(savedKind).extensions[0]}`,
    kind: savedKind,
    folderId,
    bytes: file ?? (await extractorFor("note").write(output))!,
  });
}

/** Replaces a document's content (and optionally its name), then re-indexes it. */
export async function replaceContent(id: string, bytes: Uint8Array, name?: string): Promise<Document | undefined> {
  const doc = await getDocument(id);
  if (!doc) return undefined;
  await fs.writeFile(filePath(id, doc.kind), bytes);
  await query("UPDATE documents SET name = COALESCE($1, name), size = $2, status = 'queued', error = NULL WHERE id = $3", [
    name ?? null,
    bytes.byteLength,
    id,
  ]);
  enqueue(id);
  return getDocument(id);
}

export async function deleteDocument(id: string): Promise<boolean> {
  const doc = await getDocument(id);
  if (!doc) return false;
  await query("DELETE FROM documents WHERE id = $1", [id]); // cascades to chunks
  await fs.rm(filePath(id, doc.kind), { force: true });
  return true;
}

/** Deletes a folder with its subfolders and every document inside them. */
export async function deleteFolder(id: string): Promise<void> {
  const docs = await documentsInFolders(await folderSubtree(id));
  await query("DELETE FROM folders WHERE id = $1", [id]); // cascades to subfolders, documents, chunks
  await Promise.all(docs.map((d) => fs.rm(filePath(d.id, d.kind), { force: true })));
}
