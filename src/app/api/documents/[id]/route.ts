import { getDocument, getFolder, query } from "@/lib/db";
import { cleanName, jsonError, readJson } from "@/lib/http";
import { deleteDocument } from "@/lib/library";

/** Rename and/or move a document. `folderId: null` moves it to the root. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  if (!(await getDocument(id))) return jsonError(404, "Document not found.");

  const body = await readJson<{ name?: unknown; folderId?: unknown }>(req);
  if (!body) return jsonError(400, "Invalid JSON body.");

  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return jsonError(400, "Name is required (max 200 characters).");
    await query("UPDATE documents SET name = $1 WHERE id = $2", [name, id]);
  }

  if (body.folderId !== undefined) {
    const folderId = typeof body.folderId === "string" ? body.folderId : null;
    if (folderId && !(await getFolder(folderId))) return jsonError(404, "Folder not found.");
    await query("UPDATE documents SET folder_id = $1 WHERE id = $2", [folderId, id]);
  }

  return Response.json(await getDocument(id));
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  if (!(await deleteDocument(id))) return jsonError(404, "Document not found.");
  return new Response(null, { status: 204 });
}
