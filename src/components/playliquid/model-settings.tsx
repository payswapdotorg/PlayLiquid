"use client";

/**
 * Model settings — restored from zai-org/zcode (packages/ui/src/settings/
 * model-provider-section), adapted to the PlayLiquid web app:
 *  - provider groups: "Providers" (the two ZCode presets — Z.ai, BigModel)
 *    and "Custom providers", plus "Add provider" from the template catalog
 *    (Anthropic, OpenAI, OpenRouter, DeepSeek, Moonshot, custom endpoint);
 *  - provider form: name, API key (masked, reveal toggle — the key itself
 *    never leaves the server), Base URL, API format (anthropic-messages /
 *    openai-chat-completions / openai-responses), enabled switch, a real
 *    connectivity test (POST /api/models/[id]/test) and delete (custom only);
 *  - model list with ZCode's full model-config metadata: display name,
 *    model ID, context window, max output tokens, input types
 *    (text/image/video/audio/pdf), capabilities (tool calls, structured
 *    output, native web search, mid-conversation system messages, MFJS tool
 *    schema) and reasoning levels ordered low → high.
 * Persisted through GET/POST/PUT/DELETE /api/models.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import type {
  ModelEntryDTO,
  ModelInputFormatDTO,
  ModelProviderDTO,
  ModelProvidersDTO,
  ModelTestResultDTO,
  ProviderApiFormat,
} from "@/lib/types";

const API_FORMATS: { value: ProviderApiFormat; label: string }[] = [
  { value: "anthropic-messages", label: "Anthropic messages (/v1/messages)" },
  { value: "openai-chat-completions", label: "Chat completions (/chat/completions)" },
  { value: "openai-responses", label: "Responses (/responses)" },
];

/** ZCode provider catalog — templates offered by "Add provider". */
const TEMPLATES: { key: string; name: string; baseUrl: string; format: ProviderApiFormat }[] = [
  { key: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", format: "anthropic-messages" },
  { key: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", format: "openai-chat-completions" },
  { key: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", format: "openai-chat-completions" },
  { key: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", format: "openai-chat-completions" },
  { key: "moonshot", name: "Moonshot AI", baseUrl: "https://api.moonshot.cn/v1", format: "openai-chat-completions" },
];

const INPUT_KINDS: { key: keyof ModelInputFormatDTO; label: string }[] = [
  { key: "text", label: "Text" },
  { key: "image", label: "Image" },
  { key: "video", label: "Video" },
  { key: "audio", label: "Audio" },
  { key: "pdf", label: "PDF" },
];

const CAPABILITIES: { key: keyof ModelEntryDTO; label: string }[] = [
  { key: "supportsToolCall", label: "Tool calls" },
  { key: "supportsJsonSchemaOutput", label: "Structured output" },
  { key: "supportsNativeWebSearch", label: "Native web search" },
  { key: "supportsMidConversationSystem", label: "Mid-conversation system messages" },
  { key: "requiresMfjsToolSchema", label: "MFJS tool schema" },
];

interface ProviderDraft {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: ProviderApiFormat;
  enabled: boolean;
  preset: boolean;
  hasApiKey: boolean;
  apiKey: string;
  apiKeyTouched: boolean;
  models: ModelEntryDTO[];
}

function toDraft(p: ModelProviderDTO): ProviderDraft {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    apiFormat: p.apiFormat,
    enabled: p.enabled,
    preset: p.preset,
    hasApiKey: p.hasApiKey,
    apiKey: "",
    apiKeyTouched: false,
    models: p.models.map((m) => ({ ...m, inputFormat: { ...m.inputFormat } })),
  };
}

/** JSON request helper for the non-POST verbs (postJson only issues POST). */
async function sendJson<T>(url: string, method: "PUT" | "POST" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export function ModelSettingsPanel() {
  const { data, loading, reload } = useApi<ModelProvidersDTO>("/api/models");
  const providers = data?.providers ?? null;

  // selection — defaults to the first provider once the list arrives
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFor, setSelectedFor] = useState<ModelProviderDTO[] | null>(null);
  if (providers && selectedFor !== providers) {
    setSelectedFor(providers);
    if (!providers.some((p) => p.id === selectedId)) {
      setSelectedId(providers[0]?.id ?? null);
    }
  }

  // provider draft (edits apply locally; Save persists via PUT). draftEpoch
  // bumps after a successful save so the draft re-syncs from the reloaded
  // provider — e.g. the API-key row flips to its "saved on the server" state.
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [draftEpoch, setDraftEpoch] = useState(0);
  const [syncedEpoch, setSyncedEpoch] = useState(0);
  const selected = providers?.find((p) => p.id === selectedId) ?? null;
  if (selected && (draftFor !== selected.id || syncedEpoch !== draftEpoch)) {
    setDraftFor(selected.id);
    setSyncedEpoch(draftEpoch);
    setDraft(toDraft(selected));
  }

  // add-provider popover
  const [addOpen, setAddOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const addRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!addOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!addRef.current?.contains(e.target as Node)) setAddOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [addOpen]);

  // saving / testing / deleting
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ModelTestResultDTO | null>(null);

  function patchDraft(patch: Partial<ProviderDraft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  async function saveProvider() {
    if (!draft || saving) return;
    const invalid = draft.models.filter((m) => !m.id.trim());
    if (invalid.length > 0) {
      toast.error(
        invalid.length === 1
          ? `"${invalid[0].displayName || "New model"}" has no Model ID — set it or delete the row`
          : `${invalid.length} models have no Model ID — set them or delete those rows`,
      );
      return;
    }
    setSaving(true);
    try {
      await sendJson("/api/models", "PUT", {
        id: draft.id,
        name: draft.name,
        baseUrl: draft.baseUrl,
        apiFormat: draft.apiFormat,
        enabled: draft.enabled,
        ...(draft.apiKeyTouched ? { apiKey: draft.apiKey } : {}),
        models: draft.models,
      });
      await reload();
      setDraftEpoch((e) => e + 1);
      toast.success("Model settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the provider");
    } finally {
      setSaving(false);
    }
  }

  async function testProvider() {
    if (!draft || testing) return;
    if (draft.hasApiKey || draft.apiKeyTouched) {
      setTesting(true);
      setTestResult(null);
      try {
        // test the saved configuration — same behavior as ZCode
        const res = await sendJson<ModelTestResultDTO>(`/api/models/${draft.id}/test`, "POST");
        setTestResult(res);
      } catch (err) {
        setTestResult({
          ok: false,
          message: err instanceof Error ? err.message : "The test request failed",
          status: null,
        });
      } finally {
        setTesting(false);
      }
    } else {
      setTestResult({ ok: false, message: "Set an API key to test this provider", status: null });
    }
  }

  async function deleteProvider() {
    if (!draft) return;
    try {
      await sendJson(`/api/models?id=${encodeURIComponent(draft.id)}`, "DELETE");
      setSelectedId(null);
      setDraft(null);
      setDraftFor(null);
      await reload();
      toast("Provider removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the provider");
    }
  }

  async function addProvider(template: string | null) {
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          template
            ? { template }
            : { name: customName.trim() || undefined, baseUrl: customUrl.trim() || undefined },
        ),
      });
      const json = (await res.json().catch(() => ({}))) as { provider?: ModelProviderDTO; error?: string };
      if (!res.ok || !json.provider) throw new Error(json.error ?? "Could not add the provider");
      setAddOpen(false);
      setCustomName("");
      setCustomUrl("");
      await reload();
      setSelectedId(json.provider.id);
      toast.success(`"${json.provider.name}" added — configure its API key and models`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the provider");
    }
  }

  /* ---- model list helpers ---- */

  function patchModel(index: number, patch: Partial<ModelEntryDTO>) {
    setDraft((d) => {
      if (!d) return d;
      const models = d.models.map((m, i) => (i === index ? { ...m, ...patch } : m));
      return { ...d, models };
    });
  }

  function addModel() {
    setDraft((d) => {
      if (!d) return d;
      const models: ModelEntryDTO[] = [
        ...d.models,
        {
          id: "",
          displayName: "New model",
          enabled: true,
          contextWindow: 128000,
          maxOutputTokens: 4096,
          inputFormat: { text: true, image: false, video: false, audio: false, pdf: false },
          supportsToolCall: true,
          supportsJsonSchemaOutput: true,
          supportsNativeWebSearch: false,
          supportsMidConversationSystem: true,
          requiresMfjsToolSchema: false,
          reasoningLevels: [],
        },
      ];
      return { ...d, models };
    });
  }

  function removeModel(index: number) {
    setDraft((d) => (d ? { ...d, models: d.models.filter((_, i) => i !== index) } : d));
  }

  function moveModel(index: number, dir: -1 | 1) {
    setDraft((d) => {
      if (!d) return d;
      const target = index + dir;
      if (target < 0 || target >= d.models.length) return d;
      const models = [...d.models];
      [models[index], models[target]] = [models[target], models[index]];
      return { ...d, models };
    });
  }

  const presets = providers?.filter((p) => p.preset) ?? [];
  const customs = providers?.filter((p) => !p.preset) ?? [];

  return (
    <div className="ms-panel" id="modelSettingsPanel" aria-label="Model settings">
      <aside className="ms-nav" aria-label="Providers">
        <div className="ms-nav-group">Providers</div>
        {loading && <div className="ms-nav-empty">Loading…</div>}
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={cn(selectedId === p.id && "active")}
            onClick={() => setSelectedId(p.id)}
          >
            <span className={cn("ms-dot", p.enabled && p.hasApiKey && "on")} aria-hidden />
            {p.name}
          </button>
        ))}
        {customs.length > 0 && <div className="ms-nav-group">Custom providers</div>}
        {customs.map((p) => (
          <button
            key={p.id}
            type="button"
            className={cn(selectedId === p.id && "active")}
            onClick={() => setSelectedId(p.id)}
          >
            <span className={cn("ms-dot", p.enabled && p.hasApiKey && "on")} aria-hidden />
            {p.name}
          </button>
        ))}
        <div className="ms-add-wrap" ref={addRef}>
          <button type="button" className="ms-add" onClick={() => setAddOpen((o) => !o)}>
            <Plus className="size-[13px]" strokeWidth={2.2} /> Add provider
          </button>
          {addOpen && (
            <div className="ms-add-menu" role="menu">
              <div className="ms-add-title">Provider catalog</div>
              {TEMPLATES.map((t) => (
                <button key={t.key} type="button" role="menuitem" onClick={() => void addProvider(t.key)}>
                  <b>{t.name}</b>
                  <span>{t.baseUrl}</span>
                </button>
              ))}
              <div className="ms-add-title">Custom endpoint</div>
              <input
                className="ms-add-input"
                placeholder="Name (e.g. My gateway)"
                aria-label="Custom provider name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
              <input
                className="ms-add-input"
                placeholder="https://api.example.com/v1"
                aria-label="Custom provider base URL"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
              />
              <button
                type="button"
                role="menuitem"
                className="ms-add-custom"
                onClick={() => void addProvider(null)}
              >
                Add custom endpoint
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="ms-detail">
        {!draft ? (
          <div className="ms-empty">
            <div className="ms-empty-icon" aria-hidden>
              ⬡
            </div>
            <h3>Model settings</h3>
            <p>
              Select a provider to configure its API key, endpoint and models — or add a custom
              provider. Model metadata follows the ZCode model-config contract: context window,
              input types, capabilities and reasoning levels.
            </p>
          </div>
        ) : (
          <>
            <div className="ms-head">
              <h2>{draft.name}</h2>
              <span className={cn("ms-badge", draft.preset ? "preset" : "custom")}>
                {draft.preset ? "Preset" : "Custom"}
              </span>
              <span className={cn("ms-state", draft.enabled ? "on" : "off")}>
                {draft.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>

            <div className="setting-card">
              <div className="setting-row">
                <div className="setting-text">
                  <b>Name</b>
                  <p>The provider label shown across the app.</p>
                </div>
                <input
                  className="setting-control text ms-input"
                  aria-label="Provider name"
                  value={draft.name}
                  onChange={(e) => patchDraft({ name: e.target.value })}
                />
              </div>
              <ApiKeyRow
                hasApiKey={draft.hasApiKey}
                value={draft.apiKey}
                onChange={(v) => patchDraft({ apiKey: v, apiKeyTouched: true })}
              />
              <div className="setting-row">
                <div className="setting-text">
                  <b>Base URL</b>
                  <p>API endpoint root, e.g. https://api.example.com/v1</p>
                </div>
                <input
                  className="setting-control text ms-input"
                  aria-label="Base URL"
                  value={draft.baseUrl}
                  onChange={(e) => patchDraft({ baseUrl: e.target.value })}
                />
              </div>
              <div className="setting-row">
                <div className="setting-text">
                  <b>API format</b>
                  <p>The wire format used for requests to this provider.</p>
                </div>
                <select
                  className="setting-control"
                  aria-label="API format"
                  value={draft.apiFormat}
                  onChange={(e) => patchDraft({ apiFormat: e.target.value as ProviderApiFormat })}
                >
                  {API_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="setting-row">
                <div className="setting-text">
                  <b>Enabled</b>
                  <p>Disabled providers are hidden from model pickers.</p>
                </div>
                <button
                  type="button"
                  className={cn("switch", draft.enabled && "on")}
                  aria-label="Enable provider"
                  aria-pressed={draft.enabled}
                  onClick={() => patchDraft({ enabled: !draft.enabled })}
                />
              </div>
              <div className="setting-row">
                <div className="setting-text">
                  <b>Connection</b>
                  <p>
                    Sends a real authenticated request to the provider&apos;s model-list endpoint
                    using the saved key.
                  </p>
                  {testResult && (
                    <p className={cn("ms-test-msg", testResult.ok ? "ok" : "fail")} role="status">
                      {testResult.ok ? "✓ " : "✕ "}
                      {testResult.message}
                    </p>
                  )}
                </div>
                <div className="ms-row-actions">
                  <button
                    type="button"
                    className="save-btn"
                    disabled={testing}
                    onClick={() => void testProvider()}
                  >
                    {testing ? "Testing…" : "Test connection"}
                  </button>
                  {!draft.preset && (
                    <button
                      type="button"
                      className="ms-danger"
                      onClick={() => void deleteProvider()}
                    >
                      <Trash2 className="size-[13px]" strokeWidth={2} /> Delete
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="setting-card ms-models-card">
              <div className="ms-models-head">
                <div className="setting-text">
                  <b>Model list</b>
                  <p>
                    {draft.models.length} model{draft.models.length === 1 ? "" : "s"} — context
                    window, capabilities and reasoning levels follow the ZCode model-config
                    contract.
                  </p>
                </div>
                <button type="button" className="save-btn" onClick={addModel}>
                  <Plus className="size-[12px]" strokeWidth={2.4} /> Add model
                </button>
              </div>
              {draft.models.length === 0 ? (
                <p className="ms-models-empty">
                  No models are configured. Add a model to use it in chat.
                </p>
              ) : (
                draft.models.map((m, i) => (
                  <ModelEditor
                    key={`${i}-${m.id}`}
                    model={m}
                    index={i}
                    count={draft.models.length}
                    onPatch={(patch) => patchModel(i, patch)}
                    onRemove={() => removeModel(i)}
                    onMove={(dir) => moveModel(i, dir)}
                  />
                ))
              )}
            </div>

            <div className="ms-save-row">
              <button
                type="button"
                className="save-btn"
                disabled={saving}
                onClick={() => void saveProvider()}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ApiKeyRow({
  hasApiKey,
  value,
  onChange,
}: {
  hasApiKey: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="setting-row">
      <div className="setting-text">
        <b>API key</b>
        <p>
          {hasApiKey
            ? "A key is saved on the server — it is never sent back to the page. Enter a new key to replace it."
            : "Set an API key to enable this provider."}
        </p>
      </div>
      <div className="ms-key-wrap">
        <input
          className="setting-control text ms-input"
          type={reveal ? "text" : "password"}
          placeholder={hasApiKey ? "•••••••••••• (saved)" : "Enter API key"}
          aria-label="API key"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          className="ms-key-reveal"
          aria-label={reveal ? "Hide API key" : "Show API key"}
          title={reveal ? "Hide" : "Show"}
          onClick={() => setReveal((r) => !r)}
        >
          {reveal ? <EyeOff className="size-4" strokeWidth={1.9} /> : <Eye className="size-4" strokeWidth={1.9} />}
        </button>
      </div>
    </div>
  );
}

function ModelEditor({
  model,
  index,
  count,
  onPatch,
  onRemove,
  onMove,
}: {
  model: ModelEntryDTO;
  index: number;
  count: number;
  onPatch: (patch: Partial<ModelEntryDTO>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  const [levelInput, setLevelInput] = useState("");

  function toggleInput(kind: keyof ModelInputFormatDTO) {
    if (kind === "text") return; // text input is required (ZCode contract)
    onPatch({ inputFormat: { ...model.inputFormat, [kind]: !model.inputFormat[kind] } });
  }

  function toggleCapability(key: keyof ModelEntryDTO) {
    onPatch({ [key]: !model[key] } as Partial<ModelEntryDTO>);
  }

  function addLevel() {
    const value = levelInput.trim();
    if (!value) return;
    if (model.reasoningLevels.includes(value)) {
      toast.error("Reasoning levels cannot be duplicated");
      return;
    }
    onPatch({ reasoningLevels: [...model.reasoningLevels, value] });
    setLevelInput("");
  }

  return (
    <div className={cn("ms-model", open && "open")}>
      <div className="ms-model-row">
        <button
          type="button"
          className="ms-model-main"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <b>{model.displayName || model.id || "New model"}</b>
          <span className="ms-model-id">{model.id || "model id not set"}</span>
          {model.contextWindow > 0 && (
            <span className="ms-ctx-badge">
              {model.contextWindow >= 1000 ? `${Math.round(model.contextWindow / 1000)}K ctx` : `${model.contextWindow} ctx`}
            </span>
          )}
          {model.reasoningLevels.length > 0 && (
            <span className="ms-ctx-badge reasoning">{model.reasoningLevels.length} levels</span>
          )}
        </button>
        <div className="ms-model-order">
          <button
            type="button"
            aria-label="Move model up"
            title="Move up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ChevronUp className="size-[14px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Move model down"
            title="Move down"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ChevronDown className="size-[14px]" strokeWidth={2} />
          </button>
        </div>
        <button
          type="button"
          className={cn("switch", model.enabled && "on")}
          aria-label="Enable model"
          aria-pressed={model.enabled}
          onClick={() => onPatch({ enabled: !model.enabled })}
        />
        <button
          type="button"
          className="ms-model-remove"
          aria-label="Delete model"
          title="Delete model"
          onClick={onRemove}
        >
          <X className="size-[14px]" strokeWidth={2.2} />
        </button>
      </div>

      {open && (
        <div className="ms-model-body">
          <div className="ms-field-grid">
            <label>
              <span>Display name</span>
              <input
                className="ms-input"
                aria-label="Display name"
                value={model.displayName}
                onChange={(e) => onPatch({ displayName: e.target.value })}
              />
            </label>
            <label>
              <span>Model ID</span>
              <input
                className="ms-input"
                aria-label="Model ID"
                placeholder="e.g. glm-4.6"
                value={model.id}
                onChange={(e) => onPatch({ id: e.target.value })}
              />
            </label>
            <label>
              <span>Context window</span>
              <input
                className="ms-input"
                type="number"
                min={1}
                aria-label="Context window"
                value={model.contextWindow}
                onChange={(e) => onPatch({ contextWindow: Number(e.target.value) || 0 })}
              />
            </label>
            <label>
              <span>Max output tokens</span>
              <input
                className="ms-input"
                type="number"
                min={1}
                aria-label="Max output tokens"
                value={model.maxOutputTokens}
                onChange={(e) => onPatch({ maxOutputTokens: Number(e.target.value) || 0 })}
              />
            </label>
          </div>

          <div className="ms-chip-row">
            <span className="ms-chip-label">Input types</span>
            <div className="ms-chips">
              {INPUT_KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  className={cn("ms-chip", model.inputFormat[k.key] && "on")}
                  aria-pressed={model.inputFormat[k.key]}
                  disabled={k.key === "text"}
                  title={k.key === "text" ? "Text input is required" : undefined}
                  onClick={() => toggleInput(k.key)}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ms-chip-row">
            <span className="ms-chip-label">Capabilities</span>
            <div className="ms-chips">
              {CAPABILITIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={cn("ms-chip", model[c.key] && "on")}
                  aria-pressed={model[c.key] as boolean}
                  onClick={() => toggleCapability(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ms-levels">
            <span className="ms-chip-label">Reasoning levels (low to high)</span>
            {model.reasoningLevels.length === 0 ? (
              <p className="ms-levels-empty">No reasoning levels — the model has a single effort.</p>
            ) : (
              <ol className="ms-level-list">
                {model.reasoningLevels.map((level, li) => (
                  <li key={level + li}>
                    <span className="ms-level-name">{level}</span>
                    <button
                      type="button"
                      aria-label={`Delete reasoning level ${level}`}
                      title="Delete reasoning level"
                      onClick={() =>
                        onPatch({
                          reasoningLevels: model.reasoningLevels.filter((_, x) => x !== li),
                        })
                      }
                    >
                      <X className="size-[12px]" strokeWidth={2.4} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <div className="ms-level-add">
              <input
                className="ms-input"
                placeholder="e.g. high"
                aria-label="Add reasoning level"
                value={levelInput}
                onChange={(e) => setLevelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLevel();
                  }
                }}
              />
              <button type="button" className="save-btn" onClick={addLevel}>
                Add level
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
