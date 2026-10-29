import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { isHttpUrl, trimTrailingSlash } from "./utils";
import type { PublicSettings, SettingsUpdate } from "./types";

/** A provider that speaks the OpenAI-compatible chat API (OpenAI, Gemini, Groq, OpenRouter, LM Studio…). */
export interface CompatProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export interface Settings {
  anthropicApiKey: string;
  ollamaUrl: string;
  providers: CompatProvider[];
}

const DEFAULTS: Settings = { anthropicApiKey: "", ollamaUrl: "", providers: [] };

// Keys are stored in the local SQLite file (data/ is git-ignored). The app is single-user and local.
export function getSettings(): Settings {
  const row = db().prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
  if (!row) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(row.value) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings: Settings) {
  db()
    .prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(settings));
}

/** Effective values: saved settings win, environment variables are the fallback. */
export function anthropicKey(): string {
  return getSettings().anthropicApiKey || process.env.ANTHROPIC_API_KEY || "";
}

export function ollamaUrl(): string {
  return trimTrailingSlash(getSettings().ollamaUrl || process.env.OLLAMA_URL || "http://localhost:11434");
}

const hint = (key: string) => (key ? `••••${key.slice(-4)}` : "");

export function publicSettings(): PublicSettings {
  const s = getSettings();
  return {
    anthropic: {
      hasKey: Boolean(s.anthropicApiKey),
      keyHint: hint(s.anthropicApiKey),
      fromEnv: !s.anthropicApiKey && Boolean(process.env.ANTHROPIC_API_KEY),
    },
    ollamaUrl: ollamaUrl(),
    providers: s.providers.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      hasKey: Boolean(p.apiKey),
      keyHint: hint(p.apiKey),
      models: p.models,
    })),
  };
}

/** Applies an update from the settings form. Throws with a user-facing message on invalid input. */
export function updateSettings(update: SettingsUpdate): PublicSettings {
  const current = getSettings();
  const next: Settings = { ...current };

  if (update.anthropicApiKey !== undefined) next.anthropicApiKey = (update.anthropicApiKey ?? "").trim();

  if (update.ollamaUrl !== undefined) {
    const url = update.ollamaUrl.trim();
    if (url && !isHttpUrl(url)) throw new Error("Ollama URL must start with http:// or https://");
    next.ollamaUrl = url;
  }

  if (update.providers !== undefined) {
    next.providers = update.providers.map((p) => {
      const name = p.name?.trim();
      const baseUrl = trimTrailingSlash(p.baseUrl?.trim() ?? "");
      if (!name) throw new Error("Every provider needs a name.");
      if (!baseUrl || !isHttpUrl(baseUrl)) throw new Error(`"${name}" needs a base URL starting with http:// or https://`);
      const existing = p.id ? current.providers.find((c) => c.id === p.id) : undefined;
      const apiKey = p.apiKey === undefined ? (existing?.apiKey ?? "") : (p.apiKey ?? "").trim();
      const models = [...new Set((p.models ?? []).map((m) => m.trim()).filter(Boolean))];
      return { id: existing?.id ?? randomUUID(), name, baseUrl, apiKey, models };
    });
  }

  save(next);
  return publicSettings();
}

export function findProvider(id: string): CompatProvider | undefined {
  return getSettings().providers.find((p) => p.id === id);
}
