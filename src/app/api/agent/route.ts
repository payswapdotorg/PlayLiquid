import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";

/**
 * Game Builder agent — conversational theme/live-param tuning for a game.
 * Returns a reply + optional theme patch applied live to the builder canvas.
 */
interface ThemePatch {
  palette?: Partial<{
    bg: number[];
    accent: number[];
    accent2: number[];
    ball: number[];
    platform: number[];
  }>;
  speed?: number;
  difficulty?: number;
  label?: string;
}

function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function clamp255(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : null;
}

function normalizeRgbArray(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length < 3) return undefined;
  const out = v.slice(0, 3).map(clamp255);
  return out.every((c) => c !== null) ? (out as number[]) : undefined;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    gameId?: string;
    message?: string;
    history?: { role: "user" | "assistant"; content: string }[];
  };
  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "Message required" }, { status: 400 });

  const game = body.gameId ? await db.game.findFirst({ where: { OR: [{ id: body.gameId }, { slug: body.gameId }] } }) : null;
  const gameTitle = game?.title ?? "the draft";
  const theme = (() => {
    try {
      return JSON.parse(game?.themeJson ?? "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  })();

  let reply = "";
  let patch: ThemePatch | null = null;

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "assistant",
          content: `You are the Build Agent inside PlayLiquid Game Builder, helping tune the game "${gameTitle}". Current theme JSON: ${JSON.stringify(theme)}.

You can change the game's LOOK and FEEL: palette colors (bg, accent, accent2, ball, platform — RGB arrays), speed (0.6-1.6), difficulty (0.6-1.6), and the theme label.

When the user asks for a visual or balance change you CAN make, reply with a JSON object:
{"reply": "one or two friendly sentences explaining what you changed", "patch": {"palette": {"accent": [r,g,b], ...}, "speed": 1.2, "difficulty": 0.9, "label": "Name"}}

Only include the parts of the patch you want to change. Colors must be RGB arrays [r,g,b] with values 0-255. bg should usually stay dark. speed/difficulty between 0.6 and 1.6.

If the user asks something conversational (no change needed), reply with plain text only — no JSON.`,
        },
        ...(body.history ?? []).slice(-6),
        { role: "user", content: message },
      ],
      thinking: { type: "disabled" },
    });
    reply = completion.choices[0]?.message?.content ?? "";

    const parsed = extractJson(reply);
    if (parsed && typeof parsed.reply === "string") {
      reply = parsed.reply;
      if (parsed.patch && typeof parsed.patch === "object") {
        const raw = parsed.patch as Record<string, unknown>;
        const p: ThemePatch = {};
        const pal = (raw.palette ?? {}) as Record<string, unknown>;
        for (const key of ["bg", "accent", "accent2", "ball", "platform"] as const) {
          const rgb = normalizeRgbArray(pal[key]);
          if (rgb) (p.palette ??= {})[key] = rgb;
        }
        const speed = Number(raw.speed);
        const diff = Number(raw.difficulty);
        if (Number.isFinite(speed)) p.speed = Math.max(0.6, Math.min(1.6, speed));
        if (Number.isFinite(diff)) p.difficulty = Math.max(0.6, Math.min(1.6, diff));
        if (typeof raw.label === "string") p.label = raw.label.slice(0, 16);
        if (Object.keys(p).length > 0) patch = p;
      }
    }
  } catch {
    reply =
      "The agent connection dropped for a moment — your build is untouched. Try the request again, or tweak the theme sliders directly in the Build panel.";
  }

  return NextResponse.json({ reply, patch });
}
