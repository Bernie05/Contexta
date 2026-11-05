import { getDocument } from "@/lib/db";
import { jsonError, ndjsonResponse, readJson } from "@/lib/http";
import { listModels, parseModelId } from "@/lib/llm";
import { createSummary } from "@/lib/summary";

/**
 * Summarizes a document into a new file of the same type: { model? }. Streams NDJSON events:
 * {type:"progress"} with a percentage, then {type:"done"} or {type:"error"}.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/documents/[id]/summary">) {
  const { id } = await ctx.params;
  const doc = await getDocument(id);
  if (!doc) return jsonError(404, "Document not found.");
  if (doc.status !== "ready") return jsonError(409, "This document isn't ready yet.");

  const body = await readJson<{ model?: unknown }>(req);
  const { models } = await listModels();
  const model = models.find((m) => m.id === body?.model) ?? models[0];
  if (!model) return jsonError(400, "Add a model in Settings to create summaries.");
  const target = parseModelId(model.id)!;

  return ndjsonResponse(req, "summary", async (send) => {
    const document = await createSummary(doc, target, req.signal, (percent, section) =>
      send({ type: "progress", percent, ...section }),
    );
    send({ type: "done", document });
  });
}
