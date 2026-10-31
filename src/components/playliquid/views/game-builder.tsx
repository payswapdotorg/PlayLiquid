"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Boxes,
  Eye,
  FolderGit2,
  Layers,
  Loader2,
  Play,
  Rocket,
  Save,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GameEngine } from "../mini-games/game-engine";
import { postJson, useApi } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { GameDetailDTO, GameTheme } from "@/lib/types";

interface GameApiDTO {
  game: GameDetailDTO;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Game Builder — the production workspace: scene tree on the left, the LIVE
 * build canvas (attract-mode) in the center, and the Build Agent chat on the
 * right whose patches apply to the running game in real time.
 */
export function GameBuilderView({ gameId }: { gameId: string | null }) {
  const navigate = usePlayLiquid((s) => s.navigate);
  const { data, loading } = useApi<GameApiDTO>(gameId ? `/api/games/${gameId}` : null);
  const [theme, setTheme] = useState<GameTheme | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rightTab, setRightTab] = useState<"agent" | "assets" | "avatars">("agent");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (data) {
      setTheme(data.game.theme?.palette ? data.game.theme : fallbackTheme());
      setChat([
        {
          role: "assistant",
          content: `Hey — I'm your Build Agent. The ${data.game.engine} build is live on the canvas in attract mode. Ask me to retune colors, speed or difficulty and I'll patch it in real time.`,
        },
      ]);
      setDirty(false);
    }
  }, [data]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, thinking]);

  function applyPatch(patch: {
    palette?: Partial<GameTheme["palette"]>;
    speed?: number;
    difficulty?: number;
    label?: string;
  }) {
    setTheme((t) => {
      if (!t) return t;
      const next: GameTheme = {
        ...t,
        palette: { ...t.palette, ...(patch.palette ?? {}) },
        speed: patch.speed ?? t.speed,
        difficulty: patch.difficulty ?? t.difficulty,
        label: patch.label ?? t.label,
      };
      return next;
    });
    setDirty(true);
  }

  async function send() {
    if (!input.trim() || !data || thinking) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    setChat((c) => [...c, userMsg]);
    setInput("");
    setThinking(true);
    try {
      const r = await postJson<{
        reply: string;
        patch: { palette?: Partial<GameTheme["palette"]>; speed?: number; difficulty?: number; label?: string } | null;
      }>("/api/agent", { gameId: data.game.id, message: userMsg.content, history: chat.slice(-6) });
      setChat((c) => [...c, { role: "assistant", content: r.reply }]);
      if (r.patch) {
        applyPatch(r.patch);
        toast.success("Patch applied to the live build");
      }
    } catch (e) {
      setChat((c) => [
        ...c,
        { role: "assistant", content: e instanceof Error ? e.message : "Agent unavailable — try again." },
      ]);
    } finally {
      setThinking(false);
    }
  }

  async function saveBuild() {
    if (!data || !theme) return;
    setSaving(true);
    try {
      await postJson(`/api/games/${data.game.id}/theme`, {
        themeJson: JSON.stringify(theme),
        version: data.game.status === "draft" ? "0.2.0-draft" : undefined,
      });
      setDirty(false);
      toast.success("Build saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!data) return;
    try {
      // a real publish: persist the theme, promote the draft and release v1.0.0
      await postJson(`/api/games/${data.game.id}/theme`, {
        themeJson: theme ? JSON.stringify(theme) : undefined,
        version: "1.0.0",
        status: "published",
      });
      toast.success(`${data.game.title} v1.0.0 published to the feed`);
      navigate("studio");
    } catch {
      toast.error("Publish failed");
    }
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6" aria-busy="true">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-4 h-[70vh] rounded-2xl" />
      </div>
    );
  }
  if (!data || !theme) return null;

  const g = data.game;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-10 pt-4 sm:px-6">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold sm:text-2xl">{g.title}</h1>
          <p className="text-xs text-muted-foreground">
            {g.engine} engine · {theme.label} theme · {g.status === "draft" ? `DRAFT v${g.version}` : `v${g.version}`}
            {dirty && <span className="ml-2 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-400">unsaved</span>}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" className="rounded-full" onClick={() => navigate("play", { gameId: g.id })}>
            <Play className="size-4" /> Playtest
          </Button>
          <Button variant="secondary" className="rounded-full" onClick={() => void saveBuild()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save build
          </Button>
          <Button className="rounded-full pl-brand-gradient text-black hover:opacity-90" onClick={() => void publish()}>
            <Rocket className="size-4" /> {g.status === "draft" ? "Publish" : "Release"}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[260px_1fr_360px]">
        {/* left: world tree */}
        <aside className="hidden rounded-2xl border border-border/70 bg-card/40 p-4 xl:block" aria-label="World structure">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Layers className="size-4 text-pl-cyan" /> World
          </h2>
          <ul className="mt-3 space-y-1.5">
            {g.scenes.scenes.map((sc) => (
              <li key={sc.id}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                >
                  <span className="truncate">{sc.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{sc.entities} ent</span>
                </button>
              </li>
            ))}
          </ul>
          <h2 className="mt-5 flex items-center gap-2 text-sm font-semibold">
            <FolderGit2 className="size-4 text-pl-cyan" /> Builds
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li className="flex items-center justify-between rounded-lg bg-pl-cyan/5 px-3 py-2">
              <span className="font-mono text-xs">{g.status === "draft" ? "0.1.0-draft" : g.version}</span>
              <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-400">current</span>
            </li>
            {g.status !== "draft" && (
              <li className="flex items-center justify-between rounded-lg px-3 py-2 text-muted-foreground">
                <span className="font-mono text-xs">{bumpDown(g.version)}</span>
                <span className="text-[10px] uppercase">prev</span>
              </li>
            )}
          </ul>
        </aside>

        {/* center: live build canvas */}
        <section aria-label="Live build canvas">
          <div className="rounded-2xl border border-border/70 bg-card/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Eye className="size-3.5" /> Live canvas · attract mode (the build plays itself — open Playtest for manual control)
              </p>
              <span className="rounded-full bg-black/50 px-2.5 py-1 font-mono text-[10px] text-white/80">
                {theme.label} · spd {theme.speed.toFixed(2)} · diff {theme.difficulty.toFixed(2)}
              </span>
            </div>
            <GameEngine key={`${theme.label}-${g.id}`} engine={g.engine} theme={theme} auto />
            {/* manual theme controls */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  Speed <span className="font-mono">{theme.speed.toFixed(2)}×</span>
                </span>
                <input
                  type="range"
                  min={0.6}
                  max={1.6}
                  step={0.05}
                  value={theme.speed}
                  onChange={(e) => {
                    applyPatch({ speed: Number(e.target.value) });
                  }}
                  className="w-full accent-[var(--pl-cyan)]"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  Difficulty <span className="font-mono">{theme.difficulty.toFixed(2)}×</span>
                </span>
                <input
                  type="range"
                  min={0.6}
                  max={1.6}
                  step={0.05}
                  value={theme.difficulty}
                  onChange={(e) => {
                    applyPatch({ difficulty: Number(e.target.value) });
                  }}
                  className="w-full accent-[var(--pl-cyan)]"
                />
              </label>
            </div>
          </div>
        </section>

        {/* right: agent / assets / avatars */}
        <aside className="flex flex-col rounded-2xl border border-border/70 bg-card/40" aria-label="Build assistant">
          <div className="flex gap-1 border-b border-border/60 p-2">
            {(
              [
                { id: "agent", label: "Build Agent", icon: Bot },
                { id: "assets", label: "Assets", icon: Boxes },
                { id: "avatars", label: "Avatars", icon: Users },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setRightTab(t.id)}
                className={cn(
                  "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors",
                  rightTab === t.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                <t.icon className="size-3.5" /> {t.label}
              </button>
            ))}
          </div>

          {rightTab === "agent" && (
            <div className="flex min-h-[420px] flex-1 flex-col">
              <div className="flex-1 space-y-3 overflow-y-auto slim-scrollbar p-4">
                {chat.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                      m.role === "user"
                        ? "ml-auto bg-pl-cyan/15 text-foreground"
                        : "bg-secondary/70 text-foreground/90",
                    )}
                  >
                    {m.content}
                  </div>
                ))}
                {thinking && (
                  <div className="flex w-fit items-center gap-2 rounded-2xl bg-secondary/70 px-3.5 py-2.5 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Tuning the build…
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="border-t border-border/60 p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    placeholder='Try "make it feel colder — icy blues" or "speed 1.3, easier difficulty"'
                    className="max-h-28 min-h-[44px] flex-1 resize-none rounded-xl border border-border/70 bg-background/60 px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-pl-cyan"
                    aria-label="Message the build agent"
                  />
                  <Button
                    size="icon"
                    className="size-11 shrink-0 rounded-xl pl-brand-gradient text-black hover:opacity-90"
                    disabled={!input.trim() || thinking}
                    onClick={() => void send()}
                    aria-label="Send to agent"
                  >
                    <Send className="size-4" />
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["Colder colors", "Faster + harder", "Sunset vibes", "Softer difficulty"].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setInput(q)}
                      className="cursor-pointer rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {rightTab === "assets" && (
            <ul className="grid flex-1 gap-2 p-4">
              {g.scenes.assets.map((a) => (
                <li key={a.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-pl-cyan/10 text-pl-cyan">
                    <Boxes className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.name}</span>
                    <span className="block text-xs text-muted-foreground">{a.kind}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{a.size}</span>
                </li>
              ))}
            </ul>
          )}

          {rightTab === "avatars" && (
            <ul className="space-y-2 p-4">
              {g.scenes.avatars.map((a) => (
                <li key={a.id} className="rounded-xl border border-border/60 bg-background/40 p-3">
                  <p className="text-sm font-semibold">{a.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">Body:</span> {a.body}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">Intelligence:</span> {a.intelligence}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function bumpDown(version: string): string {
  const parts = version.replace(/-.*$/, "").split(".");
  const minor = Math.max(0, Number(parts[1] ?? 1) - 1);
  return `${parts[0]}.${minor}.${parts[2] ?? 0}`;
}

function fallbackTheme(): GameTheme {
  return {
    palette: {
      bg: [10, 6, 24],
      accent: [0, 229, 255],
      accent2: [138, 125, 255],
      ball: [240, 248, 255],
      platform: [122, 110, 150],
    },
    speed: 1,
    difficulty: 1,
    label: "Default",
  };
}
