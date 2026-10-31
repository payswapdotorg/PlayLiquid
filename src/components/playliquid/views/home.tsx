"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Flame, Radio } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { GameCard, GameRail } from "../game-card";
import { SparksShelf } from "../spark-tile";
import { usePlayLiquid } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { GameDTO, GamesPageDTO, HomeDTO, SparkDTO } from "@/lib/types";

const CHIPS = ["All", "Arcade", "Shooter", "Platformer", "Runner", "Puzzle", "Racing"];

/**
 * Home — WebFlix-style interleaved feed adapted to PlayLiquid:
 * hero → continue playing → long rows → Sparks shelf → long rows → Sparks →
 * trending rail → live rail → infinite grid (cursor pages).
 */
export function HomeView() {
  const navigate = usePlayLiquid((s) => s.navigate);
  const { data, loading, error, reload } = useApi<HomeDTO>("/api/home");
  const [category, setCategory] = useState("All");

  // ---- infinite scroll grid (cursor pagination) ----
  const [pages, setPages] = useState<GameDTO[]>([]);
  const [cursor, setCursor] = useState<number | null>(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // reset the grid when the category changes (blessed render-time reset)
  const [prevCategory, setPrevCategory] = useState(category);
  if (prevCategory !== category) {
    setPrevCategory(category);
    setPages([]);
    setCursor(0);
    loadingMoreRef.current = false;
  }

  const loadPage = useCallback(async () => {
    if (cursor === null || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/games?cursor=${cursor}&category=${encodeURIComponent(category)}`,
      );
      const page = (await res.json()) as GamesPageDTO;
      setPages((prev) => [...prev, ...page.games]);
      setCursor(page.nextCursor);
    } catch {
      setCursor(null);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [cursor, category]);

  // kick off the first page as soon as the feed data lands
  useEffect(() => {
    if (data && pages.length === 0 && cursor === 0) void loadPage();
  }, [data, pages.length, cursor, loadPage]);

  // sentinel observer (re-subscribes when the loader identity changes)
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void loadPage();
      },
      { rootMargin: "600px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadPage]);

  const sparksMid = Math.ceil((data?.sparks.length ?? 0) / 2);
  const firstSparks: SparkDTO[] = data?.sparks.slice(0, sparksMid) ?? [];
  const secondSparks: SparkDTO[] = data?.sparks.slice(sparksMid) ?? [];
  const opening = pages.slice(0, 6);
  const mid = pages.slice(6, 9);
  const rest = pages.slice(9);

  return (
    <div className="pb-10">
      {/* category chips */}
      <div className="no-scrollbar sticky top-14 z-30 flex gap-2.5 overflow-x-auto bg-background/85 px-4 py-3 backdrop-blur-md sm:px-6" role="tablist" aria-label="Categories">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={cn(
              "shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              category === c
                ? "bg-foreground text-background"
                : "bg-secondary text-foreground/85 hover:bg-accent",
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {loading && <HomeSkeleton />}

      {error && (
        <div className="px-4 py-16 text-center sm:px-6" role="alert">
          <p className="text-lg font-medium">Something went wrong</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-4 cursor-pointer rounded-full bg-secondary px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        </div>
      )}

      {data && (
        <>
          {/* hero — featured game */}
          {data.featured[0] && category === "All" && <Hero game={data.featured[0]} />}

          {/* continue playing */}
          <GameRail
            title="Continue playing"
            games={data.continuePlaying}
            railLabel="Continue playing rail"
            icon={<Flame className="size-5 text-pl-rose" aria-hidden />}
          />

          {/* interleaved opening: rows 1-2 → sparks → row → sparks */}
          <GameGrid games={opening} />
          {category === "All" && <SparksShelf sparks={firstSparks} />}
          <GameGrid games={mid} className="mt-2" />
          {category === "All" && <SparksShelf sparks={secondSparks} />}

          {/* trending */}
          <GameRail
            title="Trending on PlayLiquid"
            games={data.trending}
            railLabel="Trending rail"
            icon={<Flame className="size-5 text-pl-rose" aria-hidden />}
          />

          {/* live experiences */}
          {data.live.length > 0 && (
            <GameRail
              title="Live experiences"
              games={data.live}
              railLabel="Live rail"
              icon={<Radio className="size-5 text-pl-rose" aria-hidden />}
            />
          )}

          {/* growing infinite grid */}
          {rest.length > 0 && <GameGrid games={rest} className="mt-4" />}
          {cursor !== null && (
            <div ref={sentinelRef} data-testid="infinite-scroll-sentinel" className="h-1" aria-hidden />
          )}
          {loadingMore && (
            <div className="mt-6 grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-3">
                  <Skeleton className="aspect-video w-full rounded-xl" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Hero({ game }: { game: GameDTO }) {
  const navigate = usePlayLiquid((s) => s.navigate);
  return (
    <section
      aria-label="Featured game"
      className="relative mx-4 mt-3 overflow-hidden rounded-2xl sm:mx-6"
    >
      <div className="relative aspect-[21/9] max-h-[420px] w-full sm:aspect-[21/8]">
        <img
          src={game.thumbnailUrl}
          alt={`${game.title} cover art`}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-5 sm:p-8">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-pl-cyan">
              Featured on PlayLiquid
            </p>
            <h1 className="text-2xl font-bold text-foreground drop-shadow sm:text-4xl">{game.title}</h1>
            <p className="mt-1 line-clamp-2 max-w-xl text-sm text-foreground/75">{game.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate("play", { gameId: game.id })}
              className="flex cursor-pointer items-center gap-2 rounded-full pl-brand-gradient px-5 py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
            >
              ▶ Play now
            </button>
            <button
              type="button"
              onClick={() => navigate("details", { gameId: game.id })}
              className="cursor-pointer rounded-full bg-white/10 px-5 py-2.5 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20"
            >
              Game details
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function GameGrid({ games, className }: { games: GameDTO[]; className?: string }) {
  if (games.length === 0) return null;
  return (
    <div className={cn("mt-6", className)}>
      <h2 className="px-4 text-lg font-semibold text-foreground sm:px-6 sm:text-xl">
        Recommended for you
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {games.map((g) => (
          <GameCard key={g.id} game={g} />
        ))}
      </div>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="px-4 pb-8 pt-2 sm:px-6" aria-busy="true" aria-label="Loading home feed">
      <Skeleton className="aspect-[21/9] w-full rounded-2xl" />
      <div className="mt-8 grid grid-cols-1 gap-x-4 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <div className="flex gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="no-scrollbar mt-6 flex gap-4 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[9/16] w-[168px] shrink-0 rounded-xl sm:w-[192px]" />
        ))}
      </div>
    </div>
  );
}
