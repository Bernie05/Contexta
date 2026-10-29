import { db, getDocument, getFolder } from "@/lib/db";
import { cleanName, jsonError, readJson } from "@/lib/http";
import { deleteDocument } from "@/lib/library";

/** Rename and/or move a document. `folderId: null` moves it to the root. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  if (!getDocument(id)) return jsonError(404, "Document not found.");

  const body = await readJson<{ name?: unknown; folderId?: unknown }>(req);
  if (!body) return jsonError(400, "Invalid JSON body.");

  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return jsonError(400, "Name is required (max 200 characters).");
    db().prepare("UPDATE documents SET name = ? WHERE id = ?").run(name, id);
  }

  if (body.folderId !== undefined) {
    const folderId = typeof body.folderId === "string" ? body.folderId : null;
    if (folderId && !getFolder(folderId)) return jsonError(404, "Folder not found.");
    db().prepare("UPDATE documents SET folder_id = ? WHERE id = ?").run(folderId, id);
  }

  return Response.json(getDocument(id));
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  if (!(await deleteDocument(id))) return jsonError(404, "Document not found.");
  return new Response(null, { status: 204 });
}
