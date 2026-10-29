import { db, folderSubtree, getFolder } from "@/lib/db";
import { cleanName, jsonError, readJson } from "@/lib/http";
import { deleteFolder } from "@/lib/library";

/** Rename and/or move a folder. `parentId: null` moves it to the root. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/folders/[id]">) {
  const { id } = await ctx.params;
  if (!getFolder(id)) return jsonError(404, "Folder not found.");

  const body = await readJson<{ name?: unknown; parentId?: unknown }>(req);
  if (!body) return jsonError(400, "Invalid JSON body.");

  if (body.name !== undefined) {
    const name = cleanName(body.name, 100);
    if (!name) return jsonError(400, "Folder name is required (max 100 characters).");
    db().prepare("UPDATE folders SET name = ? WHERE id = ?").run(name, id);
  }

  if (body.parentId !== undefined) {
    const parentId = typeof body.parentId === "string" ? body.parentId : null;
    if (parentId) {
      if (!getFolder(parentId)) return jsonError(404, "Target folder not found.");
      // A folder can't move into itself or one of its own subfolders.
      if (folderSubtree(id).includes(parentId)) return jsonError(400, "Can't move a folder into itself.");
    }
    db().prepare("UPDATE folders SET parent_id = ? WHERE id = ?").run(parentId, id);
  }

  return Response.json(getFolder(id));
}

/** Deletes the folder, its subfolders and every document inside them. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/folders/[id]">) {
  const { id } = await ctx.params;
  if (!getFolder(id)) return jsonError(404, "Folder not found.");

  await deleteFolder(id);

  return new Response(null, { status: 204 });
}
