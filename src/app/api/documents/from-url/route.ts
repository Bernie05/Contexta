import { getFolder } from "@/lib/db";
import { URL_IMPORT_KINDS, type DocKind } from "@/lib/formats/catalog";
import { jsonError, readJson } from "@/lib/http";
import { UrlError } from "@/lib/url-fetch";
import { importUrl } from "@/lib/web-import";

/** Saves a web page or PDF link as a new document: { url, kind, folderId? }. Indexing starts in the background. */
export async function POST(req: Request) {
  const body = await readJson<{ url?: unknown; kind?: unknown; folderId?: unknown }>(req);
  if (typeof body?.url !== "string" || !body.url.trim()) return jsonError(400, "Enter a link.");
  if (!URL_IMPORT_KINDS.includes(body.kind as DocKind)) return jsonError(400, "Pick a file type.");

  const folderId = typeof body.folderId === "string" ? body.folderId : null;
  if (folderId && !(await getFolder(folderId))) return jsonError(404, "Folder not found.");

  try {
    return Response.json(await importUrl(body.url, body.kind as DocKind, folderId), { status: 201 });
  } catch (err) {
    if (err instanceof UrlError) return jsonError(400, err.message);
    console.error("[from-url]", err);
    return jsonError(500, "Couldn't save that page.");
  }
}
