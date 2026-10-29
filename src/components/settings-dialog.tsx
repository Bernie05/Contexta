"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, Trash2, X, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { PublicSettings, SettingsUpdate } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { Button, DialogFooter, Modal, TextInput } from "./ui";

// Services that speak the OpenAI-compatible chat API. Users can also add a custom one.
const PRESETS = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { name: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { name: "LM Studio (local)", baseUrl: "http://localhost:1234/v1" },
  { name: "Custom", baseUrl: "" },
];

type Status = { ok: boolean; message: string } | null;

interface ProviderDraft {
  key: string; // React key
  id?: string; // saved provider id
  name: string;
  baseUrl: string;
  apiKey: string; // new key typed by the user; empty keeps the saved one
  clearKey: boolean;
  hasKey: boolean;
  keyHint: string;
  models: string[];
  available: string[] | null; // from "Fetch models"
  filter: string;
  manual: string;
  status: Status;
  busy: boolean;
}

let draftCounter = 0;
const newKey = () => `p${++draftCounter}`;

export function SettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [loaded, setLoaded] = useState<PublicSettings | null>(null);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [clearAnthropic, setClearAnthropic] = useState(false);
  const [anthropicStatus, setAnthropicStatus] = useState<Status>(null);
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [ollamaStatus, setOllamaStatus] = useState<Status>(null);
  const [providers, setProviders] = useState<ProviderDraft[]>([]);
  const [preset, setPreset] = useState(PRESETS[0].name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.settings().then(
      (s) => {
        setLoaded(s);
        setOllamaUrl(s.ollamaUrl);
        setProviders(
          s.providers.map((p) => ({
            key: newKey(),
            id: p.id,
            name: p.name,
            baseUrl: p.baseUrl,
            apiKey: "",
            clearKey: false,
            hasKey: p.hasKey,
            keyHint: p.keyHint,
            models: p.models,
            available: null,
            filter: "",
            manual: "",
            status: null,
            busy: false,
          })),
        );
      },
      (err) => setError(errorMessage(err, "Couldn't load settings.")),
    );
  }, []);

  const patch = (key: string, fn: (p: ProviderDraft) => Partial<ProviderDraft>) =>
    setProviders((ps) => ps.map((p) => (p.key === key ? { ...p, ...fn(p) } : p)));

  async function runTest<T>(fn: () => Promise<T>, onOk: (r: T) => void, setStatus: (s: Status) => void) {
    setStatus(null);
    try {
      onOk(await fn());
    } catch (err) {
      setStatus({ ok: false, message: errorMessage(err, "Test failed.") });
    }
  }

  async function fetchModels(p: ProviderDraft) {
    patch(p.key, () => ({ busy: true, status: null }));
    try {
      const r = await api.testProvider({ kind: "compat", baseUrl: p.baseUrl, apiKey: p.apiKey || undefined, providerId: p.id });
      patch(p.key, () => ({ busy: false, available: r.models ?? [], status: { ok: true, message: r.message } }));
    } catch (err) {
      patch(p.key, () => ({ busy: false, status: { ok: false, message: errorMessage(err, "Failed.") } }));
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    const update: SettingsUpdate = {
      ollamaUrl,
      anthropicApiKey: clearAnthropic ? null : anthropicKey.trim() || undefined,
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        apiKey: p.clearKey ? null : p.apiKey.trim() || undefined,
        models: p.models,
      })),
    };
    try {
      await api.saveSettings(update);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save settings."));
      setSaving(false);
    }
  }

  return (
    <Modal title="Settings · AI models" onClose={onClose} size="md">
      {!loaded && !error ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="-mx-5 min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-1">
            <p className="text-sm text-muted">
              Keys are stored in this computer&apos;s local database and are never sent back to the browser. Every
              model you set up here appears in the assistant&apos;s model picker.
            </p>

            {/* Claude */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Claude (Anthropic)</h3>
              <KeyInput
                label="API key"
                value={anthropicKey}
                onChange={(v) => {
                  setAnthropicKey(v);
                  setClearAnthropic(false);
                }}
                saved={
                  clearAnthropic
                    ? "Key will be removed when you save"
                    : loaded?.anthropic.hasKey
                      ? `Saved key ${loaded.anthropic.keyHint}`
                      : loaded?.anthropic.fromEnv
                        ? "Using ANTHROPIC_API_KEY from .env.local"
                        : "No key set"
                }
                canClear={Boolean(loaded?.anthropic.hasKey) && !clearAnthropic}
                onClear={() => {
                  setClearAnthropic(true);
                  setAnthropicKey("");
                }}
                placeholder="sk-ant-…"
              />
              <div className="flex items-center gap-2">
                <Button
                  onClick={() =>
                    runTest(
                      () => api.testProvider({ kind: "anthropic", apiKey: anthropicKey || undefined }),
                      (r) => setAnthropicStatus({ ok: true, message: r.message }),
                      setAnthropicStatus,
                    )
                  }
                >
                  Test key
                </Button>
                <StatusLine status={anthropicStatus} />
              </div>
            </section>

            {/* Ollama */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Ollama (local, free)</h3>
              <TextInput
                label="Server URL"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                placeholder="http://localhost:11434"
              />
              <div className="flex items-center gap-2">
                <Button
                  onClick={() =>
                    runTest(
                      () => api.testProvider({ kind: "ollama", url: ollamaUrl }),
                      (r) => setOllamaStatus({ ok: true, message: r.message + (r.models?.length ? ` (${r.models.join(", ")})` : "") }),
                      setOllamaStatus,
                    )
                  }
                >
                  Test connection
                </Button>
                <StatusLine status={ollamaStatus} />
              </div>
            </section>

            {/* OpenAI-compatible providers */}
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Other providers</h3>
                <p className="text-xs text-muted">Any service with an OpenAI-compatible API: OpenAI, Gemini, Groq, OpenRouter and more.</p>
              </div>

              {providers.map((p) => (
                <div key={p.key} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <input
                      aria-label="Provider name"
                      value={p.name}
                      onChange={(e) => patch(p.key, () => ({ name: e.target.value }))}
                      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium outline-none hover:border-border focus:border-accent"
                    />
                    <button
                      onClick={() => setProviders((ps) => ps.filter((x) => x.key !== p.key))}
                      aria-label={`Remove ${p.name}`}
                      className="rounded-md p-1 text-muted hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <TextInput
                    label="Base URL"
                    value={p.baseUrl}
                    onChange={(e) => patch(p.key, () => ({ baseUrl: e.target.value }))}
                    placeholder="https://…/v1"
                  />
                  <KeyInput
                    label="API key"
                    value={p.apiKey}
                    onChange={(v) => patch(p.key, () => ({ apiKey: v, clearKey: false }))}
                    saved={p.clearKey ? "Key will be removed when you save" : p.hasKey ? `Saved key ${p.keyHint}` : "No key set"}
                    canClear={p.hasKey && !p.clearKey}
                    onClear={() => patch(p.key, () => ({ clearKey: true, apiKey: "" }))}
                    placeholder="Paste API key (not needed for local servers)"
                  />

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">Models in the picker</span>
                      <Button className="ml-auto" disabled={p.busy || !p.baseUrl} onClick={() => fetchModels(p)}>
                        {p.busy && <Loader2 size={14} className="animate-spin" />} Fetch models
                      </Button>
                    </div>
                    <StatusLine status={p.status} />
                    <div className="flex flex-wrap gap-1">
                      {p.models.length === 0 && <span className="text-xs text-muted">None yet. Fetch the list or add a model id below.</span>}
                      {p.models.map((m) => (
                        <span key={m} className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                          {m}
                          <button
                            onClick={() => patch(p.key, (d) => ({ models: d.models.filter((x) => x !== m) }))}
                            aria-label={`Remove model ${m}`}
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                    {p.available && p.available.length > 0 && (
                      <div className="rounded-md border border-border">
                        <input
                          value={p.filter}
                          onChange={(e) => patch(p.key, () => ({ filter: e.target.value }))}
                          placeholder={`Filter ${p.available.length} models…`}
                          aria-label="Filter models"
                          className="w-full border-b border-border bg-transparent px-2 py-1.5 text-xs outline-none"
                        />
                        <ul className="max-h-40 overflow-y-auto py-1">
                          {p.available
                            .filter((m) => m.toLowerCase().includes(p.filter.toLowerCase()))
                            .map((m) => (
                              <li key={m}>
                                <label className="flex cursor-pointer items-center gap-2 px-2 py-0.5 text-xs hover:bg-surface-muted">
                                  <input
                                    type="checkbox"
                                    className="accent-accent"
                                    checked={p.models.includes(m)}
                                    onChange={(e) =>
                                      patch(p.key, (d) => ({
                                        models: e.target.checked ? [...d.models, m] : d.models.filter((x) => x !== m),
                                      }))
                                    }
                                  />
                                  {m}
                                </label>
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const id = p.manual.trim();
                        if (id) patch(p.key, (d) => ({ manual: "", models: d.models.includes(id) ? d.models : [...d.models, id] }));
                      }}
                    >
                      <input
                        value={p.manual}
                        onChange={(e) => patch(p.key, () => ({ manual: e.target.value }))}
                        placeholder="Add a model id, e.g. gpt-4o-mini"
                        aria-label="Model id"
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
                      />
                      <Button type="submit" disabled={!p.manual.trim()}>
                        Add
                      </Button>
                    </form>
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-2">
                <select
                  aria-label="Provider preset"
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                >
                  {PRESETS.map((x) => (
                    <option key={x.name}>{x.name}</option>
                  ))}
                </select>
                <Button
                  onClick={() => {
                    const pr = PRESETS.find((x) => x.name === preset)!;
                    setProviders((ps) => [
                      ...ps,
                      {
                        key: newKey(),
                        name: pr.name === "Custom" ? "My provider" : pr.name,
                        baseUrl: pr.baseUrl,
                        apiKey: "",
                        clearKey: false,
                        hasKey: false,
                        keyHint: "",
                        models: [],
                        available: null,
                        filter: "",
                        manual: "",
                        status: null,
                        busy: false,
                      },
                    ]);
                  }}
                >
                  <Plus size={15} /> Add provider
                </Button>
              </div>
            </section>
          </div>

          <DialogFooter
            className="mt-4 border-t border-border pt-4"
            error={error}
            busy={saving}
            actionLabel="Save"
            disabled={!loaded}
            onCancel={onClose}
            onAction={save}
          />
        </>
      )}
    </Modal>
  );
}

function KeyInput({
  label,
  value,
  onChange,
  saved,
  canClear,
  onClear,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  saved: string;
  canClear: boolean;
  onClear: () => void;
  placeholder: string;
}) {
  return (
    <div>
      <TextInput
        label={label}
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        <span>{saved}</span>
        {canClear && (
          <button onClick={onClear} className="text-danger hover:underline">
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <span className={`flex items-center gap-1 text-xs ${status.ok ? "text-accent" : "text-danger"}`}>
      {status.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {status.message}
    </span>
  );
}
