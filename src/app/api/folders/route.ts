import { randomUUID } from "node:crypto";
import { getFolder, query } from "@/lib/db";
import { cleanName, jsonError, readJson } from "@/lib/http";

export async function POST(req: Request) {
  const body = await readJson<{ name?: unknown; parentId?: unknown }>(req);
  const name = cleanName(body?.name, 100);
  if (!name) return jsonError(400, "Folder name is required (max 100 characters).");

  const parentId = typeof body?.parentId === "string" ? body.parentId : null;
  if (parentId && !(await getFolder(parentId))) return jsonError(404, "Parent folder not found.");

  const id = randomUUID();
  await query("INSERT INTO folders (id, name, parent_id) VALUES ($1, $2, $3)", [id, name, parentId]);
  return Response.json(await getFolder(id), { status: 201 });
}
