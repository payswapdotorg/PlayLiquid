"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Heart, MessageSquare, Play, Share2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { postJson, useApi } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CommentDTO, SparkDTO, SparksPageDTO } from "@/lib/types";

const PAGE_SIZE = 5;

/**
 * Sparks — PlayLiquid's game-native short-form feed: full-height snap-scroll
 * vertical 9:16 videos with an engagement rail, comments sheet and instant
 * play-through to the full game.
 */
export function SparksView({ initialIndex = 0 }: { initialIndex?: number }) {
  const navigate = usePlayLiquid((s) => s.navigate);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const [loadedPages, setLoadedPages] = useState<SparkDTO[]>([]);
  const [extraCursor, setExtraCursor] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [commentsFor, setCommentsFor] = useState<SparkDTO | null>(null);
  const likedSparks = usePlayLiquid((s) => s.likedSparks);
  const toggleLikeSpark = usePlayLiquid((s) => s.toggleLikeSpark);
  const followed = usePlayLiquid((s) => s.followedCreators);
  const toggleFollow = usePlayLiquid((s) => s.toggleFollow);
  const { data, loading } = useApi<SparksPageDTO>("/api/sparks");

  // derive the full item list: seed page + appended cursor pages (deduped)
  const items = useMemo(() => {
    const seed = data?.sparks ?? [];
    const seen = new Set<string>();
    const out: SparkDTO[] = [];
    for (const s of [...seed, ...loadedPages]) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
    return out;
  }, [data, loadedPages]);

  // scroll to initial spark
  useEffect(() => {
    if (data && initialIndex > 0 && feedRef.current) {
      const slide = feedRef.current.children[initialIndex] as HTMLElement | undefined;
      slide?.scrollIntoView({ block: "start" });
    }
  }, [data, initialIndex]);

  // the seed page's nextCursor drives the first append (no page-0 refetch)
  const cursor = extraCursor ?? data?.nextCursor ?? null;

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    fetch(`/api/sparks?cursor=${cursor}`)
      .then((r) => r.json() as Promise<SparksPageDTO>)
      .then((page) => {
        setLoadedPages((prev) => [...prev, ...page.sparks]);
        setExtraCursor(page.nextCursor);
      })
      .catch(() => setExtraCursor(null))
      .finally(() => setLoadingMore(false));
  }, [cursor, loadingMore]);

  // active slide via IntersectionObserver
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || items.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            const idx = Array.from(feed.children).indexOf(e.target);
            if (idx >= 0) setActiveIndex(idx);
            if (idx >= items.length - 2) loadMore();
          }
        }
      },
      { threshold: [0.6] },
    );
    Array.from(feed.children).forEach((c) => obs.observe(c));
    return () => obs.disconnect();
  }, [items.length, loadMore]);

  // keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const feed = feedRef.current;
        if (!feed) return;
        const next = feed.children[Math.max(0, Math.min(items.length - 1, activeIndex + (e.key === "ArrowDown" ? 1 : -1)))] as HTMLElement | undefined;
        next?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, items.length]);

  const go = (dir: 1 | -1) => {
    const feed = feedRef.current;
    if (!feed) return;
    const next = feed.children[Math.max(0, Math.min(items.length - 1, activeIndex + dir))] as HTMLElement | undefined;
    next?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading && items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true">
        <Skeleton className="h-[86vh] w-[min(92vw,480px)] rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-3.5rem)] overflow-hidden">
      <div
        ref={feedRef}
        className="sparks-snap h-full overflow-y-auto slim-scrollbar"
        role="feed"
        aria-label="Sparks feed"
      >
        {items.map((spark, i) => (
          <SparkSlide
            key={spark.id}
            spark={spark}
            active={i === activeIndex}
            liked={!!likedSparks[spark.id]}
            following={!!followed[spark.creator.id]}
            onLike={() => {
              toggleLikeSpark(spark.id);
              void postJson(`/api/sparks/${spark.id}/like`, { liked: !likedSparks[spark.id] }).catch(
                () => undefined,
              );
            }}
            onFollow={() => {
              toggleFollow(spark.creator.id);
              void postJson(`/api/creators/${spark.creator.id}/follow`, {
                following: !followed[spark.creator.id],
              }).catch(() => undefined);
            }}
            onComments={() => setCommentsFor(spark)}
            onPlay={() => spark.game && navigate("play", { gameId: spark.game.id })}
            onShare={async () => {
              const link = `${window.location.origin}/#view=sparks`;
              try {
                await navigator.clipboard.writeText(link);
                toast.success("Spark link copied");
              } catch {
                toast.info(`Share: ${link}`);
              }
            }}
          />
        ))}
      </div>

      {/* desktop nav chevrons */}
      <button
        type="button"
        aria-label="Previous Spark"
        onClick={() => go(-1)}
        className="absolute right-6 top-20 hidden cursor-pointer rounded-full bg-black/45 p-2 text-white backdrop-blur transition hover:bg-black/70 md:block"
      >
        <ChevronUp className="size-5" />
      </button>
      <button
        type="button"
        aria-label="Next Spark"
        onClick={() => go(1)}
        className="absolute bottom-24 right-6 hidden cursor-pointer rounded-full bg-black/45 p-2 text-white backdrop-blur transition hover:bg-black/70 md:block"
      >
        <ChevronDown className="size-5" />
      </button>

      <CommentsSheet spark={commentsFor} onClose={() => setCommentsFor(null)} />
    </div>
  );
}

function SparkSlide({
  spark,
  active,
  liked,
  following,
  onLike,
  onFollow,
  onComments,
  onPlay,
  onShare,
}: {
  spark: SparkDTO;
  active: boolean;
  liked: boolean;
  following: boolean;
  onLike(): void;
  onFollow(): void;
  onComments(): void;
  onPlay(): void;
  onShare(): void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      v.currentTime = 0;
      void v.play().catch(() => undefined);
    } else {
      v.pause();
    }
  }, [active]);

  return (
    <section
      aria-label={`Spark by ${spark.creator.name}: ${spark.title}`}
      className="relative flex h-full w-full items-center justify-center py-3"
    >
      <div className="relative h-full w-[min(94vw,430px)] overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          src={spark.videoUrl}
          muted={muted}
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
          onClick={() => setMuted((m) => !m)}
          aria-label={spark.title}
        />
        {/* top gradient + mute state */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent" />
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Unmute" : "Mute"}
          className="absolute left-3 top-3 cursor-pointer rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white backdrop-blur"
        >
          {muted ? "🔇 Muted" : "🔊 Sound on"}
        </button>
        {spark.game && (
          <span className="absolute right-3 top-3 rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur">
            {spark.game.title}
          </span>
        )}

        {/* bottom meta */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4 pr-16">
          <div className="flex items-center gap-2.5">
            <Avatar className="size-9">
              <AvatarImage src={spark.creator.avatarUrl} alt="" />
              <AvatarFallback>{spark.creator.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-semibold text-white">{spark.creator.name}</p>
              <p className="text-xs text-white/70">{formatCount(spark.plays)} plays</p>
            </div>
            <button
              type="button"
              onClick={onFollow}
              className={cn(
                "ml-2 cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition",
                following ? "bg-white/15 text-white" : "bg-white text-black hover:bg-white/85",
              )}
            >
              {following ? "Following" : "Follow"}
            </button>
          </div>
          <p className="mt-2.5 line-clamp-2 text-sm text-white/90">{spark.caption}</p>
          {spark.challenge && (
            <p className="mt-1.5 inline-block rounded-full bg-pl-rose/85 px-2.5 py-1 text-xs font-bold text-white">
              ⚡ {spark.challenge}
            </p>
          )}
        </div>

        {/* engagement rail */}
        <div className="absolute bottom-6 right-3 flex flex-col items-center gap-4">
          <RailButton
            label={formatCount(spark.likes + (liked ? 1 : 0))}
            active={liked}
            onClick={onLike}
            ariaLabel="Like this Spark"
          >
            <Heart className={cn("size-6", liked && "fill-pl-rose text-pl-rose")} />
          </RailButton>
          <RailButton label={formatCount(spark.commentCount)} onClick={onComments} ariaLabel="Comments">
            <MessageSquare className="size-6" />
          </RailButton>
          <RailButton label="Share" onClick={() => void onShare()} ariaLabel="Share this Spark">
            <Share2 className="size-6" />
          </RailButton>
          {spark.game && (
            <RailButton label="Play" onClick={onPlay} ariaLabel={`Play ${spark.game.title}`} highlight>
              <Play className="size-6 fill-current" />
            </RailButton>
          )}
        </div>
      </div>
    </section>
  );
}

function RailButton({
  children,
  label,
  onClick,
  ariaLabel,
  active,
  highlight,
}: {
  children: React.ReactNode;
  label: string;
  onClick(): void;
  ariaLabel: string;
  active?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex cursor-pointer flex-col items-center gap-1 text-white transition active:scale-90"
    >
      <span
        className={cn(
          "flex size-11 items-center justify-center rounded-full backdrop-blur",
          highlight
            ? "pl-brand-gradient text-black"
            : active
              ? "bg-pl-rose/20"
              : "bg-black/45",
        )}
      >
        {children}
      </span>
      <span className="text-[11px] font-semibold drop-shadow">{label}</span>
    </button>
  );
}

function CommentsSheet({ spark, onClose }: { spark: SparkDTO | null; onClose(): void }) {
  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const { data, loading } = useApi<{ comments: CommentDTO[] }>(
    spark ? `/api/sparks/${spark.id}/comments` : null,
  );

  useEffect(() => {
    if (data) setComments(data.comments);
  }, [data]);

  async function submit() {
    if (!spark || !text.trim()) return;
    setPosting(true);
    try {
      const r = await postJson<{ comment: CommentDTO }>(`/api/sparks/${spark.id}/comments`, {
        body: text,
      });
      setComments((prev) => [r.comment, ...prev]);
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to comment");
    } finally {
      setPosting(false);
    }
  }

  return (
    <Sheet open={!!spark} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[70vh] rounded-t-2xl sm:left-1/2 sm:right-auto sm:w-[480px] sm:-translate-x-1/2">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MessageSquare className="size-4" aria-hidden /> Spark comments
          </SheetTitle>
        </SheetHeader>
        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto slim-scrollbar px-4 pb-4">
            {loading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
            <ul className="space-y-4">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <Avatar className="size-8 shrink-0">
                    <AvatarImage src={c.authorAvatar} alt="" />
                    <AvatarFallback>{c.authorName.slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{c.authorName}</span>
                    </p>
                    <p className="mt-0.5 text-sm">{c.body}</p>
                  </div>
                </li>
              ))}
              {!loading && comments.length === 0 && (
                <li className="py-6 text-center text-sm text-muted-foreground">
                  Be the first to comment.
                </li>
              )}
            </ul>
          </div>
          <div className="flex items-end gap-2 border-t border-border/60 p-4">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Add a comment…"
              className="min-h-[44px] flex-1 resize-none"
              aria-label="Add a comment"
            />
            <Button
              size="icon"
              className="rounded-full pl-brand-gradient text-black hover:opacity-90"
              disabled={!text.trim() || posting}
              onClick={() => void submit()}
              aria-label="Post comment"
            >
              <UserPlus className="hidden" aria-hidden />
              <span className="text-lg leading-none">↑</span>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
