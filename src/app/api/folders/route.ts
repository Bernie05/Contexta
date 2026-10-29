import { randomUUID } from "node:crypto";
import { db, getFolder } from "@/lib/db";
import { cleanName, jsonError, readJson } from "@/lib/http";

export async function POST(req: Request) {
  const body = await readJson<{ name?: unknown; parentId?: unknown }>(req);
  const name = cleanName(body?.name, 100);
  if (!name) return jsonError(400, "Folder name is required (max 100 characters).");

  const parentId = typeof body?.parentId === "string" ? body.parentId : null;
  if (parentId && !getFolder(parentId)) return jsonError(404, "Parent folder not found.");

  const id = randomUUID();
  db().prepare("INSERT INTO folders (id, name, parent_id) VALUES (?, ?, ?)").run(id, name, parentId);
  return Response.json(getFolder(id), { status: 201 });
}
