import "server-only";
import { errorMessage } from "./utils";

/** Streams `run`'s events as NDJSON. A failure becomes a final {type:"error"} event. */
export function ndjsonResponse(req: Request, label: string, run: (send: (event: object) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        await run(send);
      } catch (err) {
        if (req.signal.aborted) return;
        console.error(`[${label}]`, err);
        send({ type: "error", error: errorMessage(err) });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by a client disconnect
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

export function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** Trims a user-supplied name and rejects empty or oversized ones. */
export function cleanName(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= max ? name : null;
}
