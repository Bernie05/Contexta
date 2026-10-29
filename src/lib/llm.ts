import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey, findProvider, getSettings, ollamaUrl, type CompatProvider } from "./settings";
import type { ModelOption } from "./types";
import { readLines, readNdjson, trimTrailingSlash } from "./utils";

export type Provider = ModelOption["provider"];

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const CLAUDE_MODELS: { model: string; label: string }[] = [
  { model: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { model: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { model: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];

// Models that accept the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export async function listModels(): Promise<{ models: ModelOption[]; claudeConfigured: boolean; ollamaReachable: boolean }> {
  const claudeConfigured = Boolean(anthropicKey());
  const models: ModelOption[] = claudeConfigured
    ? CLAUDE_MODELS.map((m) => ({ id: `claude:${m.model}`, provider: "claude", group: "Claude API", ...m }))
    : [];

  const ollama = await listOllamaModels(ollamaUrl());
  for (const name of ollama ?? []) {
    models.push({ id: `ollama:${name}`, provider: "ollama", model: name, label: name, group: "Ollama (local)" });
  }

  for (const p of getSettings().providers) {
    for (const m of p.models) {
      models.push({ id: `compat:${p.id}:${m}`, provider: "compat", model: m, label: m, group: p.name });
    }
  }

  return { models, claudeConfigured, ollamaReachable: ollama !== null };
}

/** Chat-capable models on an Ollama server, or null when it can't be reached. */
export async function listOllamaModels(baseUrl: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: { name: string }[] };
    // Embedding-only models can't chat.
    return (data.models ?? []).map((m) => m.name).filter((n) => !/embed/i.test(n));
  } catch {
    return null;
  }
}

/** Lists a provider's models via the OpenAI-compatible GET /models. Throws a user-facing error. */
export async function listCompatModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${trimTrailingSlash(baseUrl)}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!res) throw new Error("Couldn't reach the provider. Check the base URL.");
  if (res.status === 401 || res.status === 403) throw new Error("The provider rejected the API key.");
  if (!res.ok) throw new Error(`The provider returned ${res.status}.`);
  const data = (await res.json().catch(() => null)) as { data?: { id: string }[] } | null;
  // Gemini lists ids as "models/<name>" but chats with the bare name.
  return (data?.data ?? []).map((m) => m.id.replace(/^models\//, "")).sort();
}

/** Checks an Anthropic key with a cheap models request. Throws a user-facing error. */
export async function testAnthropicKey(apiKey: string): Promise<void> {
  try {
    await new Anthropic({ apiKey }).models.list({ limit: 1 });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Anthropic rejected the API key.");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("Couldn't reach the Anthropic API.");
    throw err;
  }
}

/** Parses "claude:<model>", "ollama:<model>" or "compat:<providerId>:<model>". */
export function parseModelId(id: string): { provider: Provider; model: string; providerId?: string } | null {
  const i = id.indexOf(":");
  if (i < 0) return null;
  const provider = id.slice(0, i);
  const rest = id.slice(i + 1);
  if (provider === "claude" || provider === "ollama") return rest ? { provider, model: rest } : null;
  if (provider === "compat") {
    const j = rest.indexOf(":");
    if (j < 0) return null;
    const providerId = rest.slice(0, j);
    const model = rest.slice(j + 1);
    return providerId && model ? { provider, model, providerId } : null;
  }
  return null;
}

/** Streams answer text. Throws on provider errors; the caller reports them to the client. */
export async function* streamAnswer(
  target: { provider: Provider; model: string; providerId?: string },
  system: string,
  messages: ChatTurn[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  if (target.provider === "claude") yield* streamClaude(target.model, system, messages, signal);
  else if (target.provider === "ollama") yield* streamOllama(target.model, system, messages, signal);
  else {
    const provider = target.providerId ? findProvider(target.providerId) : undefined;
    if (!provider) throw new Error("That provider was removed in Settings. Pick another model.");
    yield* streamCompat(provider, target.model, system, messages, signal);
  }
}

// One client per key, so a key changed in Settings takes effect on the next question.
let anthropic: { key: string; client: Anthropic } | undefined;

async function* streamClaude(model: string, system: string, messages: ChatTurn[], signal: AbortSignal) {
  const key = anthropicKey();
  if (!key) throw new Error("Add your Anthropic API key in Settings to use Claude.");
  if (anthropic?.key !== key) anthropic = { key, client: new Anthropic({ apiKey: key }) };

  const useFallback = FALLBACK_MODELS.has(model);
  const stream = anthropic.client.beta.messages.stream(
    {
      model,
      max_tokens: 16000,
      system,
      messages,
      output_config: { effort: "medium" },
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    },
    { signal },
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }

  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    yield "\n\n_The model declined to answer this request._";
  } else if (final.stop_reason === "max_tokens") {
    yield "\n\n_Answer was cut off at the token limit._";
  }
}

/** POSTs a streaming chat request and returns the body, or throws a readable error naming the provider. */
async function postForStream(label: string, url: string, body: object, signal: AbortSignal, apiKey?: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${label} returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  return res.body;
}

/** Both Ollama and OpenAI-compatible APIs take the system prompt as the first message. */
const withSystem = (system: string, messages: ChatTurn[]) => [{ role: "system", content: system }, ...messages];

async function* streamOllama(model: string, system: string, messages: ChatTurn[], signal: AbortSignal) {
  const body = await postForStream(
    "Ollama",
    `${ollamaUrl()}/api/chat`,
    { model, stream: true, messages: withSystem(system, messages) },
    signal,
  );
  // Ollama streams newline-delimited JSON objects.
  for await (const msg of readNdjson<{ message?: { content?: string }; error?: string }>(body)) {
    if (msg.error) throw new Error(`Ollama: ${msg.error}`);
    if (msg.message?.content) yield msg.message.content;
  }
}

async function* streamCompat(provider: CompatProvider, model: string, system: string, messages: ChatTurn[], signal: AbortSignal) {
  const body = await postForStream(
    provider.name,
    `${provider.baseUrl}/chat/completions`,
    { model, stream: true, messages: withSystem(system, messages) },
    signal,
    provider.apiKey,
  );
  // Server-sent events: "data: {json}" lines, ending with "data: [DONE]".
  for await (const line of readLines(body)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
    if (chunk.error) throw new Error(`${provider.name}: ${chunk.error.message ?? "unknown error"}`);
    const text = chunk.choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}
