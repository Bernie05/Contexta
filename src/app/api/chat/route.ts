import { formatOf } from "@/lib/formats/catalog";
import { jsonError, ndjsonResponse, readJson } from "@/lib/http";
import { parseModelId, streamAnswer, type ChatTurn } from "@/lib/llm";
import { retrieve, type Source } from "@/lib/retrieval";

const HISTORY_TURNS = 6;
const MAX_QUESTION_CHARS = 4000;

interface ChatRequest {
  model?: unknown;
  /** The folder the user has open; a hint for picking documents. */
  folderId?: unknown;
  messages?: ChatTurn[];
}

const SYSTEM = `You are Contexta, an assistant that answers questions about the user's documents (PDF and Word files).
Answer using only the numbered excerpts provided with the question. Cite the excerpts you use inline as [1], [2] and so on.
If the excerpts don't contain the answer, say so plainly instead of guessing. Keep answers concise and use Markdown where it helps.`;

function buildContext(sources: Source[]): string {
  return sources
    .map((s) => `[${s.n}] ${s.documentName}, ${formatOf(s.documentKind).part.singular} ${s.page}\n${s.text}`)
    .join("\n\n");
}

/**
 * Streams NDJSON events: {type:"routing"} (documents picked), {type:"sources"},
 * then {type:"text"} deltas, then {type:"done"} or {type:"error"}.
 */
export async function POST(req: Request) {
  const body = await readJson<ChatRequest>(req);
  const parsed = typeof body?.model === "string" ? parseModelId(body.model) : null;
  if (!parsed) return jsonError(400, "Pick a model.");

  const history = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-HISTORY_TURNS);
  const question = history.at(-1);
  if (!question || question.role !== "user") return jsonError(400, "The last message must be a question.");
  if (question.content.length > MAX_QUESTION_CHARS) return jsonError(400, "Question is too long.");

  const folderId = typeof body?.folderId === "string" ? body.folderId : null;

  return ndjsonResponse(req, "chat", async (send) => {
    // The previous question gives follow-ups ("and the battery?") their context.
    const previousQuestion = history.slice(0, -1).findLast((m) => m.role === "user")?.content;
    const { documents, sources } = await retrieve(question.content, folderId, previousQuestion);
    send({ type: "routing", documents });
    send({ type: "sources", sources: sources.map(({ text, ...s }) => ({ ...s, snippet: text.slice(0, 280) })) });

    if (sources.length === 0) {
      send({ type: "text", text: "There are no indexed documents yet. Upload a PDF or Word file, or wait for indexing to finish." });
      send({ type: "done" });
      return;
    }

    // Earlier turns stay as plain text; only the newest question carries the excerpts.
    const messages: ChatTurn[] = [
      ...history.slice(0, -1),
      { role: "user", content: `Excerpts:\n\n${buildContext(sources)}\n\nQuestion: ${question.content}` },
    ];
    // Anthropic requires the conversation to start with a user turn.
    while (messages.length > 1 && messages[0].role !== "user") messages.shift();

    for await (const text of streamAnswer(parsed, SYSTEM, messages, req.signal)) {
      send({ type: "text", text });
    }
    send({ type: "done" });
  });
}
