import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type {
  ModelEntryDTO,
  ModelInputFormatDTO,
  ModelProviderDTO,
  ProviderApiFormat,
} from "@/lib/types";

/**
 * Model settings — the ZCode model-provider settings contract, adapted:
 * preset providers (Z.ai, BigModel — the two ZCode preset specs) plus
 * user-created custom providers, each with a model list carrying the full
 * ZCode model-config metadata (context window, input modalities,
 * capabilities, reasoning levels ordered low → high, max output tokens).
 * API keys never leave the server: the DTO exposes `hasApiKey` only.
 */

const API_FORMATS: ProviderApiFormat[] = [
  "anthropic-messages",
  "openai-chat-completions",
  "openai-responses",
];

function inputFormat(overrides: Partial<ModelInputFormatDTO> = {}): ModelInputFormatDTO {
  return { text: true, image: false, video: false, audio: false, pdf: false, ...overrides };
}

function model(
  id: string,
  displayName: string,
  contextWindow: number,
  maxOutputTokens: number,
  extras: Partial<Omit<ModelEntryDTO, "id" | "displayName" | "contextWindow" | "maxOutputTokens">> = {},
): ModelEntryDTO {
  return {
    id,
    displayName,
    enabled: true,
    contextWindow,
    maxOutputTokens,
    inputFormat: inputFormat(),
    supportsToolCall: true,
    supportsJsonSchemaOutput: true,
    supportsNativeWebSearch: false,
    supportsMidConversationSystem: true,
    requiresMfjsToolSchema: false,
    reasoningLevels: [],
    ...extras,
  };
}

/** ZCode preset provider specs (PRESET_PROVIDER_SPECS): Z.ai + BigModel. */
const PRESETS: {
  key: string;
  name: string;
  baseUrl: string;
  apiFormat: ProviderApiFormat;
  models: ModelEntryDTO[];
}[] = [
  {
    key: "zai",
    name: "Z.ai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    apiFormat: "openai-chat-completions",
    models: [
      model("glm-4.6", "GLM-4.6", 200000, 128000, {
        inputFormat: inputFormat({ image: true }),
        supportsNativeWebSearch: true,
        reasoningLevels: ["low", "medium", "high"],
      }),
      model("glm-4.5-air", "GLM-4.5 Air", 128000, 4096, {
        reasoningLevels: ["low", "medium", "high"],
      }),
      model("glm-4.5v", "GLM-4.5V", 64000, 8192, {
        inputFormat: inputFormat({ image: true, video: true }),
        reasoningLevels: ["low", "medium", "high"],
      }),
    ],
  },
  {
    key: "bigmodel",
    name: "BigModel",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiFormat: "openai-chat-completions",
    models: [
      model("glm-4.6", "GLM-4.6", 200000, 128000, {
        inputFormat: inputFormat({ image: true }),
        reasoningLevels: ["low", "medium", "high"],
      }),
      model("glm-4-flash", "GLM-4-Flash", 128000, 4096),
      model("glm-4v-plus", "GLM-4V-Plus", 8192, 1024, {
        inputFormat: inputFormat({ image: true, video: true }),
        supportsToolCall: false,
      }),
    ],
  },
];

/** Create-add template catalog offered by "Add provider" (ZCode provider catalog). */
const PROVIDER_TEMPLATES: {
  key: string;
  name: string;
  baseUrl: string;
  apiFormat: ProviderApiFormat;
}[] = [
  { key: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", apiFormat: "anthropic-messages" },
  { key: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiFormat: "openai-chat-completions" },
  { key: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiFormat: "openai-chat-completions" },
  { key: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", apiFormat: "openai-chat-completions" },
  { key: "moonshot", name: "Moonshot AI", baseUrl: "https://api.moonshot.cn/v1", apiFormat: "openai-chat-completions" },
];

function toDTO(row: {
  id: string;
  key: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  apiKey: string;
  enabled: boolean;
  preset: boolean;
  modelsJson: string;
}): ModelProviderDTO {
  let models: ModelEntryDTO[] = [];
  try {
    const parsed = JSON.parse(row.modelsJson) as unknown;
    if (Array.isArray(parsed)) models = parsed as ModelEntryDTO[];
  } catch {
    /* corrupted payload — treat as empty; the UI can re-add models */
  }
  const apiFormat = (API_FORMATS as string[]).includes(row.apiFormat)
    ? (row.apiFormat as ProviderApiFormat)
    : "openai-chat-completions";
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    baseUrl: row.baseUrl,
    apiFormat,
    hasApiKey: row.apiKey.trim().length > 0,
    enabled: row.enabled,
    preset: row.preset,
    models,
  };
}

/** Idempotent lazy seed: the two ZCode preset providers appear on first load. */
async function ensurePresets() {
  for (const preset of PRESETS) {
    await db.modelProvider.upsert({
      where: { key: preset.key },
      create: {
        key: preset.key,
        name: preset.name,
        baseUrl: preset.baseUrl,
        apiFormat: preset.apiFormat,
        preset: true,
        enabled: true,
        modelsJson: JSON.stringify(preset.models),
      },
      update: {}, // user edits win — the seed never clobbers configuration
    });
  }
}

export async function GET() {
  await ensurePresets();
  const rows = await db.modelProvider.findMany({ orderBy: [{ preset: "desc" }, { createdAt: "asc" }] });
  return NextResponse.json({ providers: rows.map(toDTO) });
}

/** Add a custom provider — from the template catalog or a blank custom endpoint. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    template?: string;
    name?: string;
    baseUrl?: string;
    apiFormat?: string;
  };

  let name = (body.name ?? "").trim();
  let baseUrl = (body.baseUrl ?? "").trim();
  let apiFormat = body.apiFormat ?? "openai-chat-completions";
  let key = `custom-${Date.now().toString(36)}`;

  if (body.template) {
    const tpl = PROVIDER_TEMPLATES.find((t) => t.key === body.template);
    if (!tpl) return NextResponse.json({ error: "Unknown template" }, { status: 400 });
    name = name || tpl.name;
    baseUrl = baseUrl || tpl.baseUrl;
    apiFormat = tpl.apiFormat;
    key = `custom-${tpl.key}`;
    // avoid key collisions when the same template is added twice
    const exists = await db.modelProvider.findUnique({ where: { key } });
    if (exists) key = `${key}-${Date.now().toString(36)}`;
  }

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!/^https?:\/\/.+/.test(baseUrl)) {
    return NextResponse.json({ error: "A valid Base URL is required" }, { status: 400 });
  }
  if (!(API_FORMATS as string[]).includes(apiFormat)) {
    return NextResponse.json({ error: "Invalid API format" }, { status: 400 });
  }

  const row = await db.modelProvider.create({
    data: { key, name, baseUrl, apiFormat, preset: false, enabled: false, modelsJson: "[]" },
  });
  return NextResponse.json({ provider: toDTO(row) }, { status: 201 });
}

/** Update a provider (form fields and/or the model list). */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiFormat?: string;
    apiKey?: string;
    enabled?: boolean;
    models?: ModelEntryDTO[];
  };
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const existing = await db.modelProvider.findUnique({ where: { id: body.id } });
  if (!existing) return NextResponse.json({ error: "Provider not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 48);
  if (typeof body.baseUrl === "string") {
    if (!/^https?:\/\/.+/.test(body.baseUrl.trim())) {
      return NextResponse.json({ error: "Invalid Base URL" }, { status: 400 });
    }
    data.baseUrl = body.baseUrl.trim();
  }
  if (typeof body.apiFormat === "string") {
    if (!(API_FORMATS as string[]).includes(body.apiFormat)) {
      return NextResponse.json({ error: "Invalid API format" }, { status: 400 });
    }
    data.apiFormat = body.apiFormat;
  }
  // empty string clears the key; undefined keeps the stored one
  if (typeof body.apiKey === "string") data.apiKey = body.apiKey.trim().slice(0, 256);
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (Array.isArray(body.models)) {
    const models = body.models
      .filter((m) => m && typeof m.id === "string" && m.id.trim())
      .map((m) => ({
        id: m.id.trim().slice(0, 96),
        displayName: (m.displayName || m.id).trim().slice(0, 48),
        enabled: !!m.enabled,
        contextWindow: Math.max(1, Math.round(Number(m.contextWindow) || 0)) || 8192,
        maxOutputTokens: Math.max(1, Math.round(Number(m.maxOutputTokens) || 0)) || 4096,
        inputFormat: {
          text: true,
          image: !!m.inputFormat?.image,
          video: !!m.inputFormat?.video,
          audio: !!m.inputFormat?.audio,
          pdf: !!m.inputFormat?.pdf,
        },
        supportsToolCall: !!m.supportsToolCall,
        supportsJsonSchemaOutput: !!m.supportsJsonSchemaOutput,
        supportsNativeWebSearch: !!m.supportsNativeWebSearch,
        supportsMidConversationSystem: !!m.supportsMidConversationSystem,
        requiresMfjsToolSchema: !!m.requiresMfjsToolSchema,
        reasoningLevels: (Array.isArray(m.reasoningLevels) ? m.reasoningLevels : [])
          .filter((l) => typeof l === "string" && l.trim())
          .map((l) => l.trim().slice(0, 24)),
      }));
    data.modelsJson = JSON.stringify(models);
  }

  const row = await db.modelProvider.update({ where: { id: body.id }, data });
  return NextResponse.json({ provider: toDTO(row) });
}

/** Delete a custom provider (presets can only be disabled, matching ZCode). */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const existing = await db.modelProvider.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  if (existing.preset) {
    return NextResponse.json({ error: "Preset providers cannot be deleted" }, { status: 400 });
  }
  await db.modelProvider.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
