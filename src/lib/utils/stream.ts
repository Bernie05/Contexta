// Readers for streamed HTTP bodies, used by the browser (chat) and the server (LLM providers).

type ByteStream = ReadableStream<Uint8Array<ArrayBuffer>>;

/** Yields each non-empty, trimmed line of a text stream as it arrives. */
export async function* readLines(body: ByteStream): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield line;
      }
    }
    if (buffer.trim()) yield buffer.trim();
  } finally {
    reader.releaseLock();
  }
}

/** Yields each object of a newline-delimited JSON stream. */
export async function* readNdjson<T>(body: ByteStream): AsyncGenerator<T> {
  for await (const line of readLines(body)) yield JSON.parse(line) as T;
}
