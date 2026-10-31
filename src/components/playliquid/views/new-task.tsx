"use client";

import { useState } from "react";
import { Bot, Brain, ChevronDown, Cpu, FolderOpen, Loader2, Paperclip, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { postJson, useApi } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TaskDTO } from "@/lib/types";

const MODELS = [
  { id: "GLM-4.6", label: "GLM-4.6", hint: "Balanced flagship · recommended" },
  { id: "GLM-4.5-Air", label: "GLM-4.5 Air", hint: "Fast drafts" },
  { id: "GLM-4-Flash", label: "GLM-4 Flash", hint: "Speed-first" },
];
const MODES = ["Create", "Iterate", "Remix", "Prototype"];
const AGENTS = [
  { id: "Game Architect", icon: Bot, hint: "Designs game systems & balance" },
  { id: "World Builder", icon: Sparkles, hint: "Scenes, levels & atmosphere" },
  { id: "Avatar Smith", icon: Brain, hint: "Characters & intelligence" },
];

/**
 * New Task — ZCode-style task creation adapted for game generation.
 * Describe a game → agent designs it → opens the draft in Game Builder.
 */
export function NewTaskView() {
  const navigate = usePlayLiquid((s) => s.navigate);
  const { data: tasks, reload } = useApi<{ tasks: TaskDTO[] }>("/api/tasks");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(MODELS[0]);
  const [modelOpen, setModelOpen] = useState(false);
  const [mode, setMode] = useState("Create");
  const [agent, setAgent] = useState(AGENTS[0]);
  const [workspace, setWorkspace] = useState("PlayLiquid Labs · Main");
  const [creating, setCreating] = useState(false);

  async function createTask() {
    if (prompt.trim().length < 8) {
      toast.error("Describe your game in a few more words first");
      return;
    }
    setCreating(true);
    try {
      const r = await postJson<{ game: { id: string; title: string }; usedFallback: boolean }>(
        "/api/tasks",
        { prompt, model: model.id, mode, agent: agent.id },
      );
      toast.success(
        r.usedFallback
          ? `"${r.game.title}" scaffolded (agent fallback) — opening Game Builder`
          : `"${r.game.title}" designed by ${agent.id} — opening Game Builder`,
      );
      void reload();
      navigate("builder", { gameId: r.game.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Task failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-12 pt-6 sm:px-6 lg:grid-cols-[1fr_320px]">
      <section aria-label="New task">
        <h1 className="text-2xl font-bold">New Task</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe the game you want — the {agent.id} agent designs it on a live engine, then hands
          you the build.
        </p>

        {/* prompt */}
        <div className="mt-5 rounded-2xl border border-border/70 bg-card/50 p-4">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. A neon underwater brick-breaker where the ball gets faster every 5 hits, with bubble power-ups…"
            className="min-h-[140px] resize-none border-0 bg-transparent p-1 text-base focus-visible:ring-0"
            aria-label="Describe your game"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <button
              type="button"
              className="flex cursor-pointer items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
              onClick={() => toast.info("Attachments land in the Game Builder context panel")}
            >
              <Paperclip className="size-3.5" /> Attach context
            </button>
            <span className="text-xs text-muted-foreground">{prompt.length}/2000</span>
            <Button
              className="ml-auto rounded-full pl-brand-gradient px-6 text-black hover:opacity-90"
              disabled={creating || prompt.trim().length < 8}
              onClick={() => void createTask()}
            >
              {creating ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Designing…
                </>
              ) : (
                <>
                  <Wand2 className="size-4" /> Create Task
                </>
              )}
            </Button>
          </div>
        </div>

        {/* mode chips */}
        <h2 className="mt-6 text-sm font-semibold text-muted-foreground">Task mode</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "cursor-pointer rounded-full px-4 py-2 text-sm font-medium transition-colors",
                mode === m ? "bg-foreground text-background" : "bg-secondary hover:bg-accent",
              )}
            >
              {m}
            </button>
          ))}
        </div>

        {/* agent selection */}
        <h2 className="mt-6 text-sm font-semibold text-muted-foreground">Agent</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {AGENTS.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAgent(a)}
                aria-pressed={agent.id === a.id}
                className={cn(
                  "cursor-pointer rounded-xl border p-3 text-left transition-colors",
                  agent.id === a.id
                    ? "border-pl-cyan/60 bg-pl-cyan/5"
                    : "border-border/70 hover:border-foreground/25",
                )}
              >
                <Icon className={cn("size-5", agent.id === a.id ? "text-pl-cyan" : "text-muted-foreground")} />
                <p className="mt-2 text-sm font-semibold">{a.id}</p>
                <p className="text-xs text-muted-foreground">{a.hint}</p>
              </button>
            );
          })}
        </div>

        {/* model + workspace */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground">Model</h2>
            <div className="relative mt-2">
              <button
                type="button"
                onClick={() => setModelOpen((o) => !o)}
                aria-expanded={modelOpen}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-left"
              >
                <Cpu className="size-4 text-pl-cyan" />
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{model.label}</span>
                  <span className="block text-xs text-muted-foreground">{model.hint}</span>
                </span>
                <ChevronDown className={cn("size-4 transition-transform", modelOpen && "rotate-180")} />
              </button>
              {modelOpen && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setModel(m);
                        setModelOpen(false);
                      }}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-sm hover:bg-accent",
                        m.id === model.id && "bg-accent/60",
                      )}
                    >
                      <Cpu className="size-4 text-pl-cyan" />
                      <span>
                        <span className="block font-medium">{m.label}</span>
                        <span className="block text-xs text-muted-foreground">{m.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground">Workspace</h2>
            <button
              type="button"
              onClick={() => toast.info("Workspace switcher — your other workspaces live in Settings")}
              className="mt-2 flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-left"
            >
              <FolderOpen className="size-4 text-pl-cyan" />
              <span className="flex-1">
                <span className="block text-sm font-semibold">{workspace}</span>
                <span className="block text-xs text-muted-foreground">4 projects · 12 games</span>
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* task history sidebar */}
      <aside aria-label="Task history" className="lg:sticky lg:top-20 lg:self-start">
        <h2 className="text-sm font-semibold text-muted-foreground">Recent tasks</h2>
        <div className="mt-2 max-h-96 space-y-2 overflow-y-auto slim-scrollbar pr-1">
          {(tasks?.tasks ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => t.gameId && navigate("builder", { gameId: t.gameId })}
              className="w-full cursor-pointer rounded-xl border border-border/70 bg-card/40 p-3 text-left transition-colors hover:border-foreground/25"
            >
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={cn(
                  "size-1.5 rounded-full",
                  t.status === "completed" ? "bg-emerald-400" : "bg-amber-400",
                )} />
                {t.mode} · {t.model} · {timeAgo(t.createdAt)}
              </p>
              <p className="mt-1 line-clamp-2 text-sm font-medium">{t.prompt}</p>
              {t.gameTitle && (
                <p className="mt-1 text-xs text-pl-cyan">→ {t.gameTitle}</p>
              )}
            </button>
          ))}
          {(tasks?.tasks.length ?? 0) === 0 && (
            <p className="rounded-xl border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
              No tasks yet — describe a game to start your first build.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
