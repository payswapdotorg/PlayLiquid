"use client";

import {
  Boxes,
  FlaskConical,
  FolderGit2,
  Gamepad2,
  Play,
  Plus,
  Rocket,
  Sparkles,
  TestTube2,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GameCard } from "../game-card";
import { useApi } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { formatCount, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StudioDTO } from "@/lib/types";

/** Game Studio — creator dashboard: my games, stats, quick actions. */
export function GameStudioView() {
  const navigate = usePlayLiquid((s) => s.navigate);
  const { data, loading } = useApi<StudioDTO>("/api/studio");

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-8 h-64 rounded-xl" />
      </div>
    );
  }
  if (!data) return null;

  const drafts = data.myGames.filter((g) => g.status === "draft");
  const published = data.myGames.filter((g) => g.status !== "draft");

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:px-6">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Game Studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build worlds, tune avatars, playtest with agents, ship releases.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="rounded-full"
            onClick={() => toast.info("Preview capture studio — records a clip from your next playtest")}
          >
            <FlaskConical className="size-4" /> Capture preview
          </Button>
          <Button
            className="rounded-full pl-brand-gradient text-black hover:opacity-90"
            onClick={() => navigate("newtask")}
          >
            <Plus className="size-4" /> New game
          </Button>
        </div>
      </div>

      {/* stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Gamepad2 className="size-4" />} label="Games" value={String(data.totals.games)} sub={`${drafts.length} drafts`} />
        <StatCard icon={<TrendingUp className="size-4" />} label="Total plays" value={formatCount(data.totals.plays)} sub="all time" />
        <StatCard icon={<Sparkles className="size-4" />} label="Sparks" value={String(data.totals.sparks)} sub={`${formatCount(data.totals.likes)} likes`} />
        <StatCard icon={<Users className="size-4" />} label="Followers" value={formatCount(data.totals.followers)} sub="of your studio" />
      </div>

      {/* quick actions */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QuickAction
          icon={<Boxes className="size-5" />}
          title="Asset library"
          desc="Sprites, tilesets, audio"
          onClick={() => toast.info("Asset library lives inside each build — open a game to browse")}
        />
        <QuickAction
          icon={<Users className="size-5" />}
          title="Avatar Lab"
          desc="Bodies & intelligence"
          onClick={() => toast.info("Avatar Lab opens with a game — avatars are per-build")}
        />
        <QuickAction
          icon={<TestTube2 className="size-5" />}
          title="Research Lab"
          desc="Balance simulations & arena tests"
          onClick={() => toast.info("Research Lab runs bot-vs-bot arena playtests on your builds")}
        />
        <QuickAction
          icon={<FolderGit2 className="size-5" />}
          title="Version control"
          desc="Builds, diffs & PR lifecycle"
          onClick={() => navigate("creator")}
        />
      </div>

      {/* drafts */}
      {drafts.length > 0 && (
        <section aria-label="Draft builds" className="mt-8">
          <h2 className="text-lg font-semibold">Draft builds</h2>
          <p className="text-xs text-muted-foreground">Unpublished — playtest in the Game Builder before release.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {drafts.map((g) => (
              <div key={g.id} className="relative">
                <GameCard game={g} />
                <Button
                  size="sm"
                  className="absolute right-2 top-2 rounded-full pl-brand-gradient text-black"
                  onClick={() => navigate("builder", { gameId: g.id })}
                >
                  Open builder
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* published */}
      <section aria-label="Published games" className="mt-8">
        <h2 className="text-lg font-semibold">Published games</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {published.map((g) => (
            <div key={g.id} className="relative">
              <GameCard game={g} />
              <div className="absolute right-2 top-2 flex gap-1.5">
                <Button
                  size="icon"
                  variant="secondary"
                  className="size-8 rounded-full"
                  aria-label={`Playtest ${g.title}`}
                  onClick={() => navigate("play", { gameId: g.id })}
                >
                  <Play className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  className="size-8 rounded-full"
                  aria-label={`Edit ${g.title} in builder`}
                  onClick={() => navigate("builder", { gameId: g.id })}
                >
                  <Rocket className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* recent community feedback */}
      <section aria-label="Recent feedback" className="mt-8">
        <h2 className="text-lg font-semibold">Community feedback</h2>
        <ul className="mt-3 space-y-3">
          {data.recentComments.map((c) => (
            <li key={c.id} className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/40 p-4">
              <Avatar className="size-9 shrink-0">
                <AvatarImage src={c.authorAvatar} alt="" />
                <AvatarFallback>{c.authorName.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{c.authorName}</span> on{" "}
                  <span className="text-pl-cyan">{c.gameTitle}</span> · {timeAgo(c.createdAt)}
                </p>
                <p className="mt-1 line-clamp-2 text-sm">{c.body}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">♥ {formatCount(c.likes)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/50 p-4">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="text-pl-cyan">{icon}</span> {label}
      </p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function QuickAction({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group cursor-pointer rounded-xl border border-border/70 bg-card/40 p-4 text-left transition-colors hover:border-pl-cyan/50 hover:bg-pl-cyan/5"
    >
      <span className="text-pl-cyan">{icon}</span>
      <p className="mt-2 text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </button>
  );
}
