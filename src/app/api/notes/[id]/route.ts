import fs from "node:fs/promises";
import { connection } from "next/server";
import { filePath, getDocument } from "@/lib/db";
import { cleanName, jsonError, readJson } from "@/lib/http";
import { MAX_NOTE_CHARS } from "@/lib/formats/note/meta";
import { replaceContent } from "@/lib/library";

function findNote(id: string) {
  const doc = getDocument(id);
  return doc?.kind === "note" ? doc : undefined;
}

/** Returns a note's title and Markdown content for the editor. */
export async function GET(_req: Request, ctx: RouteContext<"/api/notes/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const note = findNote(id);
  if (!note) return jsonError(404, "Note not found.");
  const content = await fs.readFile(filePath(id, "note"), "utf8").catch(() => "");
  return Response.json({ ...note, content });
}

/** Saves a note: { title?, content }. The note is re-indexed so the assistant sees the change. */
export async function PUT(req: Request, ctx: RouteContext<"/api/notes/[id]">) {
  const { id } = await ctx.params;
  if (!findNote(id)) return jsonError(404, "Note not found.");

  const body = await readJson<{ title?: unknown; content?: unknown }>(req);
  if (typeof body?.content !== "string") return jsonError(400, "content is required.");
  if (body.content.length > MAX_NOTE_CHARS) return jsonError(400, "Note is too long.");
  const title = body.title === undefined ? undefined : cleanName(body.title);
  if (title === null) return jsonError(400, "A note needs a title (max 200 characters).");

  const doc = await replaceContent(id, new TextEncoder().encode(body.content), title);
  return Response.json(doc);
}
