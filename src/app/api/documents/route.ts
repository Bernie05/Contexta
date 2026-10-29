import { getFolder } from "@/lib/db";
import { detectFormat } from "@/lib/formats/registry";
import { cleanName, jsonError } from "@/lib/http";
import { createDocument } from "@/lib/library";

const MAX_BYTES = 50 * 1024 * 1024;

/** Multipart upload: one or more `files`, optional `folderId`. Indexing starts in the background. */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Expected multipart/form-data.");
  }

  const folderIdRaw = form.get("folderId");
  const folderId = typeof folderIdRaw === "string" && folderIdRaw ? folderIdRaw : null;
  if (folderId && !getFolder(folderId)) return jsonError(404, "Folder not found.");

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return jsonError(400, "No files uploaded.");

  const created = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      rejected.push({ name: file.name, reason: "Larger than 50 MB." });
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    // The extension picks the format; its signature bytes must confirm it.
    const format = detectFormat(file.name, bytes);
    if ("reason" in format) {
      rejected.push({ name: file.name, reason: format.reason });
      continue;
    }
    const name = cleanName(file.name) ?? `Untitled${format.meta.extensions[0]}`;
    created.push(await createDocument({ name, kind: format.meta.kind, folderId, bytes }));
  }

  return Response.json({ created, rejected }, { status: created.length ? 201 : 400 });
}
