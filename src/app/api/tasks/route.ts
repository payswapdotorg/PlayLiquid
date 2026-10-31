import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { toGameDTO } from "@/lib/serialize";

const ENGINES = ["breaker", "stardrift", "leap", "runner"] as const;

/** Spare cover art pool for freshly generated drafts. */
const SPARE_COVERS = ["/covers/chrono-realms.jpg", "/covers/mystic-grove.jpg", "/covers/quantum-chess.jpg"];

interface GeneratedSpec {
  title: string;
  engine: (typeof ENGINES)[number];
  category: string;
  description: string;
  longDescription: string;
  tags: string[];
  theme: {
    palette: { bg: number[]; accent: number[]; accent2: number[]; ball: number[]; platform: number[] };
    speed: number;
    difficulty: number;
    label: string;
  };
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "untitled-game"
  );
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function clampChannel(v: unknown, fallback: number): number {
  const n = Array.isArray(v) ? v[0] : v;
  return Math.max(0, Math.min(255, Math.round(Number(n) || fallback)));
}

function normalizeTheme(t: Record<string, unknown>, engine: string): GeneratedSpec["theme"] {
  const pal = (t.palette ?? {}) as Record<string, unknown>;
  const themePresets: Record<string, GeneratedSpec["theme"]> = {
    breaker: { palette: { bg: [7, 0, 18], accent: [0, 240, 255], accent2: [255, 0, 212], ball: [255, 255, 255], platform: [0, 240, 255] }, speed: 1, difficulty: 1, label: "Custom" },
    stardrift: { palette: { bg: [10, 6, 24], accent: [0, 229, 255], accent2: [138, 125, 255], ball: [240, 248, 255], platform: [122, 110, 150] }, speed: 1, difficulty: 1, label: "Custom" },
    leap: { palette: { bg: [20, 6, 10], accent: [255, 68, 0], accent2: [255, 120, 40], ball: [255, 210, 70], platform: [90, 60, 55] }, speed: 1, difficulty: 1, label: "Custom" },
    runner: { palette: { bg: [10, 0, 24], accent: [255, 45, 149], accent2: [0, 255, 231], ball: [0, 255, 231], platform: [60, 40, 90] }, speed: 1.15, difficulty: 1.1, label: "Custom" },
  };
  const base = themePresets[engine] ?? themePresets.breaker;
  return {
    palette: {
      bg: Array.isArray(pal.bg) ? pal.bg.map((c) => clampChannel(c, 10)) : base.palette.bg,
      accent: Array.isArray(pal.accent) ? pal.accent.map((c) => clampChannel(c, 120)) : base.palette.accent,
      accent2: Array.isArray(pal.accent2) ? pal.accent2.map((c) => clampChannel(c, 120)) : base.palette.accent2,
      ball: Array.isArray(pal.ball) ? pal.ball.map((c) => clampChannel(c, 200)) : base.palette.ball,
      platform: Array.isArray(pal.platform) ? pal.platform.map((c) => clampChannel(c, 120)) : base.palette.platform,
    },
    speed: Math.max(0.6, Math.min(1.6, Number(t.speed) || base.speed)),
    difficulty: Math.max(0.6, Math.min(1.6, Number(t.difficulty) || base.difficulty)),
    label: typeof t.label === "string" ? t.label.slice(0, 24) : "Custom",
  };
}

async function generateSpec(prompt: string, mode: string): Promise<{ spec: GeneratedSpec; model: string }> {
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: [
      {
        role: "assistant",
        content: `You are the Game Architect agent inside PlayLiquid GameOS — a game creation platform. Your job: turn the user's game idea into a playable instant-arcade game spec.

PlayLiquid runs four game engines:
- "breaker" — brick-breaker/arkanoid with paddle, ball, energy bricks
- "stardrift" — vertical space shooter with ship, asteroids, bullets
- "leap" — vertical platformer, bouncing upward, rising danger below
- "runner" — 3-lane endless runner dodging obstacles

Respond with ONLY a JSON object, no markdown, with exactly this shape:
{
  "title": "punchy game name, max 28 chars",
  "engine": "breaker" | "stardrift" | "leap" | "runner",
  "category": "Arcade" | "Shooter" | "Platformer" | "Runner" | "Puzzle" | "Racing" | "Adventure" | "Strategy",
  "description": "one-sentence hook, max 140 chars",
  "longDescription": "2 short paragraphs describing gameplay, scoring and one standout feature",
  "tags": ["4-6 lowercase tags"],
  "theme": {
    "palette": { "bg": [r,g,b], "accent": [r,g,b], "accent2": [r,g,b], "ball": [r,g,b], "platform": [r,g,b] },
    "speed": 0.6-1.6,
    "difficulty": 0.6-1.6,
    "label": "theme name, max 12 chars"
  }
}
Palette guidance: bg dark (sum < 120) unless the concept is bright/cheerly; accent + accent2 are the two main neon/mood colors; ball is the player color (bright); platform is obstacles/paddle color. Pick colors that match the user's concept emotionally.`,
      },
      { role: "user", content: `Mode: ${mode}\nGame idea: ${prompt}` },
    ],
    thinking: { type: "disabled" },
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = extractJson(raw) as Record<string, unknown>;
  const engine = ENGINES.includes(parsed.engine as (typeof ENGINES)[number])
    ? (parsed.engine as (typeof ENGINES)[number])
    : "breaker";
  const spec: GeneratedSpec = {
    title: String(parsed.title ?? "Untitled Draft").slice(0, 40),
    engine,
    category: String(parsed.category ?? "Arcade").slice(0, 20),
    description: String(parsed.description ?? "A new PlayLiquid instant game.").slice(0, 200),
    longDescription: String(parsed.longDescription ?? parsed.description ?? "").slice(0, 1200),
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6).map((t) => String(t).slice(0, 20)) : [],
    theme: normalizeTheme((parsed.theme ?? {}) as Record<string, unknown>, engine),
  };
  return { spec, model: completion.model ?? "GLM-4.6" };
}

function templateSpec(prompt: string): GeneratedSpec {
  const p = prompt.toLowerCase();
  const engine = p.includes("shoot") || p.includes("space") || p.includes("ship")
    ? "stardrift"
    : p.includes("run") || p.includes("race") || p.includes("dash") || p.includes("cyber")
      ? "runner"
      : p.includes("jump") || p.includes("leap") || p.includes("climb") || p.includes("platform")
        ? "leap"
        : "breaker";
  const words = prompt.split(/\s+/).filter((w) => w.length > 3).slice(0, 2).map((w) => w.replace(/[^a-z0-9]/gi, ""));
  const title = (words.join(" ") || "Liquid Draft").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    title: title.slice(0, 28),
    engine,
    category: engine === "stardrift" ? "Shooter" : engine === "runner" ? "Runner" : engine === "leap" ? "Platformer" : "Arcade",
    description: `A fresh ${engine} experience drafted from your idea on PlayLiquid GameOS.`,
    longDescription: `This draft was scaffolded from your prompt: "${prompt.slice(0, 160)}"\n\nOpen it in the Game Builder to tune the theme, speed and difficulty, playtest live, then publish to the feed.`,
    tags: ["draft", engine, "playtest"],
    theme: normalizeTheme({}, engine),
  };
}

function scenesFor(title: string, category: string) {
  return JSON.stringify({
    scenes: [
      { id: "sc-1", name: "Title / Menu", entities: 6, kind: "ui" },
      { id: "sc-2", name: `${title} — Arena`, entities: 24, kind: "playfield" },
      { id: "sc-3", name: "Game Over / Results", entities: 9, kind: "ui" },
    ],
    assets: [
      { id: "as-1", name: "player-sprite.png", kind: "sprite", size: "12 KB" },
      { id: "as-2", name: `${category.toLowerCase()}-tileset.png`, kind: "tileset", size: "48 KB" },
      { id: "as-3", name: "impact-sfx.wav", kind: "audio", size: "31 KB" },
      { id: "as-4", name: "bg-parallax.png", kind: "background", size: "210 KB" },
      { id: "as-5", name: "trail-particles.png", kind: "particles", size: "8 KB" },
    ],
    avatars: [
      { id: "av-1", name: "Player One", body: "Runner frame A", intelligence: "Human-controlled" },
      { id: "av-2", name: "Rival Bot", body: "Runner frame B", intelligence: "Chases high score · medium" },
    ],
  });
}

export async function GET() {
  const tasks = await db.task.findMany({
    include: { game: { select: { title: true, slug: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      prompt: t.prompt,
      model: t.model,
      mode: t.mode,
      agent: t.agent,
      status: t.status,
      gameId: t.gameId,
      gameTitle: t.game?.title ?? null,
      gameSlug: t.game?.slug ?? null,
      summary: (() => {
        try {
          return (JSON.parse(t.resultJson) as { summary?: string }).summary ?? null;
        } catch {
          return null;
        }
      })(),
      createdAt: t.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    model?: string;
    mode?: string;
    agent?: string;
  };
  const prompt = (body.prompt ?? "").trim();
  if (prompt.length < 8) {
    return NextResponse.json({ error: "Describe your game in at least a few words." }, { status: 400 });
  }

  const me = await db.creator.findFirst({ where: { isMe: true } });
  if (!me) return NextResponse.json({ error: "Studio not found" }, { status: 500 });

  const mode = body.mode ?? "Create";
  const task = await db.task.create({
    data: {
      prompt: prompt.slice(0, 2000),
      model: body.model ?? "GLM-4.6",
      mode,
      agent: body.agent ?? "Game Architect",
      status: "running",
    },
  });

  let spec: GeneratedSpec;
  let modelUsed = body.model ?? "GLM-4.6";
  let usedFallback = false;
  try {
    const gen = await generateSpec(prompt, mode);
    spec = gen.spec;
    modelUsed = gen.model;
  } catch {
    spec = templateSpec(prompt);
    usedFallback = true;
  }

  // unique slug
  let slug = slugify(spec.title);
  const clash = await db.game.findFirst({ where: { slug } });
  if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  // engine-matched preview from the closest seeded game
  const engineRef = await db.game.findFirst({ where: { engine: spec.engine, status: "published" } });
  const coverIdx = (await db.game.count()) % SPARE_COVERS.length;

  const game = await db.game.create({
    data: {
      slug,
      title: spec.title,
      description: spec.description,
      longDescription: spec.longDescription,
      thumbnailUrl: SPARE_COVERS[coverIdx],
      previewUrl: engineRef?.previewUrl ?? "/previews/neon-breaker.mp4",
      engine: spec.engine,
      themeJson: JSON.stringify(spec.theme),
      scenesJson: scenesFor(spec.title, spec.category),
      creatorId: me.id,
      category: spec.category,
      tags: spec.tags.join(", "),
      status: "draft",
      version: "0.1.0-draft",
      controllers: "Keyboard, Touch",
    },
  });

  await db.task.update({
    where: { id: task.id },
    data: {
      status: "completed",
      gameId: game.id,
      resultJson: JSON.stringify({
        summary: `${usedFallback ? "Scaffolded" : "Designed"} "${spec.title}" — a ${spec.category.toLowerCase()} built on the ${spec.engine} engine. Open in Game Builder to playtest and publish.`,
      }),
    },
  });

  return NextResponse.json({
    task: { id: task.id, status: "completed" },
    game: toGameDTO({ ...game, creator: me, sessions: [], _count: { comments: 0 } }),
    modelUsed,
    usedFallback,
  });
}
