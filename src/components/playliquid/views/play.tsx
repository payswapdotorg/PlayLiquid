"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookmarkPlus,
  Gamepad2,
  Heart,
  MessageSquare,
  Send,
  Share2,
  Trophy,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { GameCard } from "../game-card";
import { GameEngine } from "../mini-games/game-engine";
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

/**
 * Play — WebFlix watch-page adapted to games: the live player surface,
 * metadata, action row, creator follow, description, comments, related rail.
 */
export function PlayView({ gameId }: { gameId: string | null }) {
  const navigate = usePlayLiquid((s) => s.navigate);
  const { data, loading, error, reload } = useApi<GameApiDTO>(gameId ? `/api/games/${gameId}` : null);

  const liked = !!usePlayLiquid((s) => (gameId ? s.likedGames[gameId] : false));
  const disliked = !!usePlayLiquid((s) => (gameId ? s.dislikedGames[gameId] : false));
  const saved = !!usePlayLiquid((s) => (gameId ? s.savedGames[gameId] : false));
  const following = !!usePlayLiquid((s) =>
    data ? s.followedCreators[data.game.creator.id] : false,
  );
  const toggleLike = usePlayLiquid((s) => s.toggleLikeGame);
  const toggleDislike = usePlayLiquid((s) => s.toggleDislikeGame);
  const toggleSave = usePlayLiquid((s) => s.toggleSave);
  const toggleFollow = usePlayLiquid((s) => s.toggleFollow);

  const [likes, setLikes] = useState(0);
  const [followers, setFollowers] = useState(0);
  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [leaderboard, setLeaderboard] = useState<ScoreDTO[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentPosting, setCommentPosting] = useState(false);
  const [restartKey, setRestartKey] = useState(0);
  const [bestRun, setBestRun] = useState<number | null>(null);
  const [submittedScore, setSubmittedScore] = useState(false);
  const lastScoreRef = useRef(0);
  const progressRef = useRef(0);
  const sessionStartedRef = useRef(false);

  useEffect(() => {
    if (data) {
      setLikes(data.game.likes);
      setFollowers(data.game.creator.followers);
      setComments(data.comments);
      setLeaderboard(data.leaderboard);
      setBestRun(data.game.lastScore ?? null);
      setSubmittedScore(false);
      sessionStartedRef.current = false;
    }
  }, [data]);

  // record a play session once per visit
  useEffect(() => {
    if (data && gameId && !sessionStartedRef.current) {
      sessionStartedRef.current = true;
      void postJson(`/api/games/${gameId}/play`, {}).catch(() => undefined);
    }
  }, [data, gameId]);

  // persist progress on unmount
  useEffect(
    () => () => {
      if (gameId && lastScoreRef.current > 0) {
        void fetch(`/api/games/${gameId}/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ progress: progressRef.current, score: lastScoreRef.current }),
          keepalive: true,
        }).catch(() => undefined);
      }
    },
    [gameId],
  );

  const onGameOver = useCallback(
    (score: number) => {
      lastScoreRef.current = Math.max(lastScoreRef.current, score);
      setBestRun((b) => Math.max(b ?? 0, score));
      if (gameId && score > 0 && !submittedScore) {
        setSubmittedScore(true);
        void postJson<{ leaderboard: ScoreDTO[] }>(`/api/games/${gameId}/scores`, {
          score,
          player: "You",
        })
          .then((r) => {
            setLeaderboard(r.leaderboard);
            toast.success(`Score ${score.toLocaleString()} submitted to the leaderboard`);
          })
          .catch(() => toast.error("Could not submit score"));
      }
    },
    [gameId, submittedScore],
  );

  async function postComment() {
    if (!gameId || !commentText.trim()) return;
    setCommentPosting(true);
    try {
      const r = await postJson<{ comment: CommentDTO }>(`/api/games/${gameId}/comments`, {
        body: commentText,
      });
      setComments((prev) => [r.comment, ...prev]);
      setCommentText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to post comment");
    } finally {
      setCommentPosting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6" aria-busy="true">
        <Skeleton className="aspect-video w-full rounded-xl" />
        <Skeleton className="mt-4 h-7 w-2/3" />
        <Skeleton className="mt-2 h-4 w-1/3" />
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
      {/* player surface */}
      <div className="relative">
        <GameEngine
          key={g.id}
          engine={g.engine}
          theme={g.theme}
          restartKey={restartKey}
          onScore={(sc) => {
            lastScoreRef.current = Math.max(lastScoreRef.current, sc);
          }}
          onProgress={(p) => {
            progressRef.current = p;
          }}
          onGameOver={onGameOver}
        />
        <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white/90 backdrop-blur">
          <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-pl-rose" />
          Live build v{g.version} · {g.theme.label ?? "Default"} theme
        </div>
      </div>

      {/* title + meta */}
      <h1 className="mt-4 text-xl font-bold text-foreground sm:text-2xl">{g.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatPlays(g.plays)} · ★ {g.rating.toFixed(1)} · {g.category}
        {g.multiplayer ? ` · ${g.multiplayer}` : ""}
      </p>

      {/* action row */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            toggleLike(g.id);
            setLikes((l) => l + (liked ? -1 : 1));
            if (!liked) void postJson(`/api/games/${g.id}/like`, { liked: true }).catch(() => undefined);
            else void postJson(`/api/games/${g.id}/like`, { liked: false }).catch(() => undefined);
          }}
          aria-pressed={liked}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
            liked ? "bg-pl-rose/15 text-pl-rose" : "bg-secondary text-foreground hover:bg-accent",
          )}
        >
          <Heart className={cn("size-4", liked && "fill-pl-rose")} /> {formatCount(likes)}
        </button>
        <button
          type="button"
          onClick={() => toggleDislike(g.id)}
          aria-pressed={disliked}
          className={cn(
            "cursor-pointer rounded-full px-4 py-2 text-sm font-medium transition-colors",
            disliked ? "bg-secondary text-pl-cyan" : "bg-secondary text-foreground hover:bg-accent",
          )}
          aria-label="Not for me"
        >
          👎
        </button>
        <button
          type="button"
          onClick={async () => {
            const link = `${window.location.origin}/#view=play&game=${g.id}`;
            try {
              await navigator.clipboard.writeText(link);
              toast.success("Link copied to clipboard");
            } catch {
              toast.info(`Share: ${link}`);
            }
          }}
          className="flex cursor-pointer items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
        >
          <Share2 className="size-4" /> Share
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !saved;
            toggleSave(g.id);
            toast.success(next ? "Saved to Library" : "Removed from Library");
            // server-side Library persistence (optimistic)
            void postJson(`/api/games/${g.id}/save`, { saved: next }).catch(() => {
              toast.error("Could not update your Library");
            });
          }}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
            saved ? "bg-pl-cyan/15 text-pl-cyan" : "bg-secondary text-foreground hover:bg-accent",
          )}
        >
          <BookmarkPlus className="size-4" /> {saved ? "Saved" : "Save"}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRestartKey((k) => k + 1);
              setSubmittedScore(false);
            }}
            className="cursor-pointer rounded-full bg-secondary px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            ↻ Restart
          </button>
        </div>
      </div>

      {/* creator card */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-4">
        <Avatar className="size-11">
          <AvatarImage src={g.creator.avatarUrl} alt="" />
          <AvatarFallback>{g.creator.name.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {g.creator.name}
            {g.creator.verified && (
              <svg viewBox="0 0 24 24" className="size-3.5 fill-pl-cyan" aria-label="Verified studio">
                <path d="M12 2l2.39 2.09 3.1-.52 1.13 2.94 2.94 1.13-.52 3.1L23 12l-1.96 2.26.52 3.1-2.94 1.13-1.13 2.94-3.1-.52L12 22l-2.39-2.09-3.1.52-1.13-2.94-2.94-1.13.52-3.1L1 12l2.39-2.26-.52-3.1 2.94-1.13L4.94 3.57l3.1.52L12 2zm-1 13.5l6-6-1.41-1.41L11 12.67 8.41 10.09 7 11.5l4 4z" />
              </svg>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatCount(followers)} followers · {g.creator.handle}
          </p>
        </div>
        <Button
          onClick={() => {
            toggleFollow(g.creator.id);
            setFollowers((f) => f + (following ? -1 : 1));
            void postJson(`/api/creators/${g.creator.id}/follow`, { following: !following }).catch(
              () => undefined,
            );
          }}
          className={cn(
            "ml-auto rounded-full px-5",
            following ? "bg-secondary text-foreground hover:bg-accent" : "pl-brand-gradient text-black hover:opacity-90",
          )}
        >
          {following ? "Following" : "Follow"}
        </Button>
      </div>

      {/* best run */}
      {bestRun !== null && bestRun > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-pl-cyan/25 bg-pl-cyan/5 px-4 py-3 text-sm">
          <Trophy className="size-4 text-pl-cyan" aria-hidden />
          <span className="font-semibold text-foreground">Your best run:</span>
          <span className="font-mono tabular-nums text-pl-cyan">{bestRun.toLocaleString()}</span>
          <span className="text-muted-foreground">— beat it and reclaim the crown.</span>
        </div>
      )}

      {/* description */}
      <div className="mt-4 rounded-xl bg-secondary/50 p-4">
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
          {g.longDescription || g.description}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {g.tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-background/60 px-2.5 py-1 text-xs text-pl-cyan"
            >
              #{t}
            </span>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Gamepad2 className="size-3.5" aria-hidden /> {g.controllers}
          {g.multiplayer ? (
            <>
              <Users className="ml-2 size-3.5" aria-hidden /> {g.multiplayer}
            </>
          ) : null}
        </p>
      </div>

      {/* leaderboard + comments */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section aria-label="Comments">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <MessageSquare className="size-5 text-muted-foreground" aria-hidden />
            {comments.length} comments
          </h2>
          <div className="mt-4 flex gap-3">
            <Avatar className="size-9 shrink-0">
              <AvatarImage src="/avatars/playliquid-labs.jpg" alt="" />
              <AvatarFallback>Y</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <Textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Share tips, scores or feedback…"
                className="min-h-[70px] border-border/70 bg-secondary/40"
                aria-label="Write a comment"
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setCommentText("")}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="rounded-full pl-brand-gradient text-black hover:opacity-90"
                  disabled={!commentText.trim() || commentPosting}
                  onClick={() => void postComment()}
                >
                  <Send className="size-3.5" /> Comment
                </Button>
              </div>
            </div>
          </div>
          <ul className="mt-4 space-y-5">
            {comments.map((c) => (
              <li key={c.id} className="flex gap-3">
                <Avatar className="size-9 shrink-0">
                  <AvatarImage src={c.authorAvatar} alt="" />
                  <AvatarFallback>{c.authorName.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{c.authorName}</span> ·{" "}
                    {timeAgo(c.createdAt)}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{c.body}</p>
                  <p className="mt-1.5 text-xs text-muted-foreground">♥ {formatCount(c.likes)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <aside aria-label="Leaderboard" className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-card/50 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Trophy className="size-4 text-pl-cyan" aria-hidden /> Leaderboard
            </h3>
            <ol className="mt-3 space-y-2.5">
              {leaderboard.slice(0, 10).map((s, i) => (
                <li key={s.id} className="flex items-center gap-3 text-sm">
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                      i === 0
                        ? "bg-amber-400/20 text-amber-400"
                        : i === 1
                          ? "bg-zinc-300/20 text-zinc-300"
                          : i === 2
                            ? "bg-orange-400/20 text-orange-400"
                            : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                  <Avatar className="size-6">
                    <AvatarImage src={s.avatar} alt="" />
                    <AvatarFallback>{s.player.slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate">{s.player}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {s.score.toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-xl border border-border/70 bg-card/50 p-4">
            <h3 className="text-sm font-semibold">Recent updates</h3>
            <ul className="mt-3 space-y-3">
              {data.updates.slice(0, 3).map((u) => (
                <li key={u.id}>
                  <p className="text-sm font-medium">
                    <span className="rounded bg-pl-cyan/10 px-1.5 py-0.5 font-mono text-[11px] text-pl-cyan">
                      v{u.version}
                    </span>{" "}
                    {u.title}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{u.body}</p>
                </li>
              ))}
              {data.updates.length === 0 && (
                <li className="text-xs text-muted-foreground">No updates yet.</li>
              )}
            </ul>
          </div>
        </aside>
      </div>

      {/* related rail */}
      <section aria-label="Related games" className="mt-8">
        <h2 className="text-lg font-semibold">More like {g.title}</h2>
        <div className="no-scrollbar mt-3 flex gap-4 overflow-x-auto pb-2">
          {data.related.map((r) => (
            <GameCard key={r.id} game={r} variant="rail" />
          ))}
        </div>
      </section>
    </div>
  );
}
