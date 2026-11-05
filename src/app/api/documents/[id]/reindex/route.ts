import { getDocument, query } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { enqueue } from "@/lib/indexer";

export async function POST(_req: Request, ctx: RouteContext<"/api/documents/[id]/reindex">) {
  const { id } = await ctx.params;
  const doc = await getDocument(id);
  if (!doc) return jsonError(404, "Document not found.");
  if (doc.status === "processing" || doc.status === "queued") return jsonError(409, "Already indexing.");

  await query("UPDATE documents SET status = 'queued', error = NULL WHERE id = $1", [id]);
  enqueue(id);
  return Response.json(await getDocument(id));
}
