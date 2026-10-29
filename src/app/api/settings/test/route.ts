import { jsonError, readJson } from "@/lib/http";
import { listCompatModels, listOllamaModels, testAnthropicKey } from "@/lib/llm";
import { anthropicKey, findProvider } from "@/lib/settings";
import { errorMessage, isHttpUrl, plural, trimTrailingSlash } from "@/lib/utils";

type TestRequest =
  | { kind: "anthropic"; apiKey?: string }
  | { kind: "ollama"; url: string }
  | { kind: "compat"; baseUrl: string; apiKey?: string; providerId?: string };

/**
 * Checks a provider before saving and returns its models where possible.
 * A missing key falls back to the saved one, so unchanged keys never travel to the browser.
 */
export async function POST(req: Request) {
  const body = await readJson<TestRequest>(req);
  if (!body) return jsonError(400, "Invalid JSON body.");

  try {
    if (body.kind === "anthropic") {
      const key = body.apiKey?.trim() || anthropicKey();
      if (!key) return jsonError(400, "Enter an API key first.");
      await testAnthropicKey(key);
      return Response.json({ ok: true, message: "Key works." });
    }

    if (body.kind === "ollama") {
      const url = trimTrailingSlash(body.url?.trim() ?? "");
      if (!url || !isHttpUrl(url)) return jsonError(400, "Enter a URL starting with http:// or https://");
      const models = await listOllamaModels(url);
      if (models === null) return jsonError(400, "Couldn't reach Ollama at that address. Is it running?");
      return Response.json({ ok: true, message: `Connected. ${plural(models.length, "chat model")} found.`, models });
    }

    if (body.kind === "compat") {
      const baseUrl = body.baseUrl?.trim();
      if (!baseUrl || !isHttpUrl(baseUrl)) return jsonError(400, "Enter a base URL starting with http:// or https://");
      const key = body.apiKey?.trim() || (body.providerId ? (findProvider(body.providerId)?.apiKey ?? "") : "");
      const models = await listCompatModels(baseUrl, key);
      return Response.json({ ok: true, message: `Connected. ${plural(models.length, "model")} available.`, models });
    }

    return jsonError(400, "Unknown provider kind.");
  } catch (err) {
    return jsonError(400, errorMessage(err, "Test failed."));
  }
}
