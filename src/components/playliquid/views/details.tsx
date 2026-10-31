"use client";

import { useState } from "react";
import { BookmarkPlus, Gamepad2, History, Share2, Star, Trophy, Users, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GameCard } from "../game-card";
import { useApi, postJson } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { formatCount, formatPlays, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CommentDTO, GameDetailDTO, GameDTO, ScoreDTO, UpdateDTO } from "@/lib/types";

interface GameApiDTO {
  game: GameDetailDTO;
  related: GameDTO[];
  leaderboard: ScoreDTO[];
  updates: UpdateDTO[];
  comments: CommentDTO[];
}

/** Game Details — trailer hero, ratings, overview, updates, leaderboard. */
export function DetailsView({ gameId }: { gameId: string | null }) {
  const navigate = usePlayLiquid((s) => s.navigate);
  const { data, loading, error } = useApi<GameApiDTO>(gameId ? `/api/games/${gameId}` : null);
  const saved = !!usePlayLiquid((s) => (gameId ? s.savedGames[gameId] : false));
  const toggleSave = usePlayLiquid((s) => s.toggleSave);
  const following = !!usePlayLiquid((s) => (data ? s.followedCreators[data.game.creator.id] : false));
  const toggleFollow = usePlayLiquid((s) => s.toggleFollow);
  const [muted, setMuted] = useState(true);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6" aria-busy="true">
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <Skeleton className="mt-4 h-8 w-1/2" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-4 py-20 text-center" role="alert">
        <p className="text-lg font-medium">Game not found</p>
        <Button variant="secondary" className="mt-4 rounded-full" onClick={() => navigate("home")}>
          Back to Home
        </Button>
      </div>
    );
  }

  const g = data.game;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-4 sm:px-6">
      {/* trailer */}
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video
          src={g.previewUrl}
          poster={g.thumbnailUrl}
          muted={muted}
          autoPlay
          loop
          playsInline
          className="aspect-video w-full object-cover"
          aria-label={`${g.title} gameplay trailer`}
        />
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Unmute trailer" : "Mute trailer"}
          className="absolute right-3 top-3 cursor-pointer rounded-full bg-black/55 p-2.5 text-white backdrop-blur transition hover:bg-black/75"
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
        <span className="absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur">
          Official gameplay preview · v{g.version}
        </span>
      </div>

      {/* header */}
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold sm:text-3xl">{g.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden />
              <strong className="text-foreground">{g.rating.toFixed(1)}</strong> ({formatCount(Math.round(g.plays / 8))} ratings)
            </span>
            <span>{formatPlays(g.plays)}</span>
            <span>{g.category}</span>
            <span>~{g.durationMin} min run</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            className="rounded-full pl-brand-gradient px-7 text-black hover:opacity-90"
            onClick={() => navigate("play", { gameId: g.id })}
          >
            <Gamepad2 className="size-4" /> Play now
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="rounded-full"
            onClick={() => {
              toggleSave(g.id);
              toast.success(saved ? "Removed from Library" : "Saved to Library");
            }}
          >
            <BookmarkPlus className={cn("size-4", saved && "text-pl-cyan")} /> {saved ? "Saved" : "Save"}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="rounded-full"
            onClick={async () => {
              const link = `${window.location.origin}/#view=details&game=${g.id}`;
              try {
                await navigator.clipboard.writeText(link);
                toast.success("Link copied");
              } catch {
                toast.info(`Share: ${link}`);
              }
            }}
          >
            <Share2 className="size-4" /> Share
          </Button>
        </div>
      </div>

      {/* creator */}
      <div className="mt-4 flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-4">
        <Avatar className="size-11">
          <AvatarImage src={g.creator.avatarUrl} alt="" />
          <AvatarFallback>{g.creator.name.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-semibold">{g.creator.name}</p>
          <p className="text-xs text-muted-foreground">{formatCount(g.creator.followers)} followers</p>
        </div>
        <Button
          className={cn(
            "ml-auto rounded-full",
            following ? "bg-secondary hover:bg-accent" : "pl-brand-gradient text-black hover:opacity-90",
          )}
          onClick={() => {
            toggleFollow(g.creator.id);
            void postJson(`/api/creators/${g.creator.id}/follow`, { following: !following }).catch(
              () => undefined,
            );
          }}
        >
          {following ? "Following" : "Follow studio"}
        </Button>
      </div>

      {/* tabs */}
      <Tabs defaultValue="overview" className="mt-6">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-secondary/50 p-1 no-scrollbar">
          <TabsTrigger value="overview" className="rounded-lg px-4 py-2">Overview</TabsTrigger>
          <TabsTrigger value="updates" className="rounded-lg px-4 py-2">Updates</TabsTrigger>
          <TabsTrigger value="leaderboard" className="rounded-lg px-4 py-2">Leaderboard</TabsTrigger>
          <TabsTrigger value="community" className="rounded-lg px-4 py-2">Community</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
            <div className="rounded-xl bg-secondary/40 p-5">
              <p className="whitespace-pre-line text-sm leading-relaxed">{g.longDescription || g.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {g.tags.map((t) => (
                  <span key={t} className="rounded-full bg-background/60 px-2.5 py-1 text-xs text-pl-cyan">
                    #{t}
                  </span>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-border/70 p-4 text-sm">
                <h3 className="mb-3 font-semibold">Gameplay details</h3>
                <dl className="space-y-2 text-muted-foreground">
                  <div className="flex justify-between gap-2"><dt>Engine</dt><dd className="text-foreground capitalize">{g.engine}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Theme</dt><dd className="text-foreground">{g.theme.label ?? "Default"}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Version</dt><dd className="font-mono text-foreground">{g.version}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Players</dt><dd className="flex items-center gap-1 text-foreground"><Users className="size-3.5" aria-hidden /> {g.multiplayer || "Single player"}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Input</dt><dd className="text-foreground">{g.controllers}</dd></div>
                </dl>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="updates" className="mt-4">
          <ol className="space-y-4">
            {data.updates.map((u) => (
              <li key={u.id} className="rounded-xl border border-border/70 p-4">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span className="rounded bg-pl-cyan/10 px-2 py-0.5 font-mono text-xs text-pl-cyan">v{u.version}</span>
                  {u.title}
                  <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <History className="size-3.5" aria-hidden /> {timeAgo(u.createdAt)}
                  </span>
                </p>
                <p className="mt-2 text-sm leading-relaxed text-foreground/85">{u.body}</p>
              </li>
            ))}
            {data.updates.length === 0 && (
              <li className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
                No updates published yet.
              </li>
            )}
          </ol>
        </TabsContent>

        <TabsContent value="leaderboard" className="mt-4">
          <div className="overflow-hidden rounded-xl border border-border/70">
            <table className="w-full text-sm">
              <caption className="sr-only">Top scores for {g.title}</caption>
              <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3">#</th>
                  <th scope="col" className="px-4 py-3">Player</th>
                  <th scope="col" className="px-4 py-3 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((s, i) => (
                  <tr key={s.id} className="border-t border-border/50">
                    <td className="px-4 py-3 font-mono">{i + 1}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <Avatar className="size-6">
                          <AvatarImage src={s.avatar} alt="" />
                          <AvatarFallback>{s.player.slice(0, 1)}</AvatarFallback>
                        </Avatar>
                        {s.player}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{s.score.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Trophy className="size-3.5" aria-hidden /> Play the game to submit your score to the board.
          </p>
        </TabsContent>

        <TabsContent value="community" className="mt-4">
          <ul className="space-y-4">
            {data.comments.slice(0, 12).map((c: CommentDTO) => (
              <li key={c.id} className="flex gap-3">
                <Avatar className="size-9 shrink-0">
                  <AvatarImage src={c.authorAvatar} alt="" />
                  <AvatarFallback>{c.authorName.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{c.authorName}</span> · {timeAgo(c.createdAt)}
                  </p>
                  <p className="mt-1 text-sm">{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>

      {/* recommended */}
      <section aria-label="Recommended games" className="mt-8">
        <h2 className="text-lg font-semibold">You might also like</h2>
        <div className="no-scrollbar mt-3 flex gap-4 overflow-x-auto pb-2">
          {data.related.map((r) => (
            <GameCard key={r.id} game={r} variant="rail" />
          ))}
        </div>
      </section>
    </div>
  );
}
