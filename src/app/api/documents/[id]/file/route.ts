import fs from "node:fs/promises";
import { connection } from "next/server";
import { filePath, getDocument } from "@/lib/db";
import { formatOf } from "@/lib/formats/catalog";
import { jsonError } from "@/lib/http";

/**
 * Serves the stored file. PDFs open inline in the browser's viewer (supports #page=N);
 * formats the browser can't display, like Word, download instead.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]/file">) {
  await connection();
  const { id } = await ctx.params;
  const doc = getDocument(id);
  if (!doc) return jsonError(404, "Document not found.");

  const bytes = await fs.readFile(filePath(id, doc.kind)).catch(() => null);
  if (!bytes) return jsonError(404, "File missing on disk.");

  const format = formatOf(doc.kind);
  const disposition = format.previewInline ? "inline" : "attachment";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": format.contentType,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
