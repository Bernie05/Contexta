import { getFolder } from "@/lib/db";
import { cleanName, jsonError, readJson } from "@/lib/http";
import { MAX_NOTE_CHARS } from "@/lib/formats/note/meta";
import { createDocument } from "@/lib/library";

/** Creates a Markdown note: { title, content?, folderId? }. It's indexed like any document. */
export async function POST(req: Request) {
  const body = await readJson<{ title?: unknown; content?: unknown; folderId?: unknown }>(req);
  const title = cleanName(body?.title);
  if (!title) return jsonError(400, "A note needs a title (max 200 characters).");
  const content = typeof body?.content === "string" ? body.content : "";
  if (content.length > MAX_NOTE_CHARS) return jsonError(400, "Note is too long.");

  const folderId = typeof body?.folderId === "string" ? body.folderId : null;
  if (folderId && !getFolder(folderId)) return jsonError(404, "Folder not found.");

  const doc = await createDocument({ name: title, kind: "note", folderId, bytes: new TextEncoder().encode(content) });
  return Response.json(doc, { status: 201 });
}
