// Shapes shared by the API and the browser.
import type { DocKind } from "./formats/types";

export type { DocKind };

export type DocStatus = "queued" | "processing" | "ready" | "error";

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface Document {
  id: string;
  name: string;
  kind: DocKind;
  folder_id: string | null;
  size: number;
  page_count: number | null; // pages (PDF) or sections (Word)
  chunk_count: number;
  status: DocStatus;
  error: string | null;
  created_at: string;
}

/** A document picked to answer a question, and why. */
export interface RoutedDoc {
  id: string;
  name: string;
  score: number;
  reasons: ("content" | "name" | "folder")[];
}

export interface SourceRef {
  n: number;
  documentId: string;
  documentName: string;
  documentKind: DocKind;
  page: number;
  score: number;
  snippet: string;
}

export interface ModelOption {
  id: string; // "claude:<model>", "ollama:<model>" or "compat:<providerId>:<model>"
  provider: "claude" | "ollama" | "compat";
  model: string;
  label: string;
  group: string; // heading in the model picker
}

/** Settings as the browser sees them: API keys are never sent back, only whether one is set. */
export interface PublicSettings {
  anthropic: { hasKey: boolean; keyHint: string; fromEnv: boolean };
  ollamaUrl: string;
  providers: PublicProvider[];
}

export interface PublicProvider {
  id: string;
  name: string;
  baseUrl: string;
  hasKey: boolean;
  keyHint: string;
  models: string[];
}

/** For keys: a string sets it, null clears it, undefined keeps the saved one. */
export interface SettingsUpdate {
  anthropicApiKey?: string | null;
  ollamaUrl?: string;
  providers?: { id?: string; name: string; baseUrl: string; apiKey?: string | null; models: string[] }[];
}
