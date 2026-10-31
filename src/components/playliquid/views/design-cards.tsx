"use client";

/**
 * Shared helpers for the reconstruction discovery pages: the design's
 * game-card structure and a title→record resolver so cards that name a
 * real PlayLiquid game deep-link into the kept game page.
 */
import { useApi } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { GameDTO, GamesPageDTO } from "@/lib/types";

/** Resolve a design card title to the real game record (link target). */
export function useTitleGame() {
  const { data } = useApi<GamesPageDTO>("/api/games?cursor=0&category=All");
  const byTitle = (title: string): GameDTO | undefined =>
    data?.games.find((g) => g.title.toLowerCase() === title.toLowerCase());
  return { byTitle };
}

export interface DesignCardProps {
  cover: string; // "c2" | "c3" | …
  title: string;
  meta?: [string] | [string, string];
}

/** The design's .game-card. Clickable when the title resolves to a real game. */
export function DesignGameCard({ cover, title, meta }: DesignCardProps) {
  const navigate = usePlayLiquid((s) => s.navigate);
  const { byTitle } = useTitleGame();
  const game = byTitle(title);

  const inner = (
    <>
      <div className={cn("cover", cover)} aria-hidden />
      <div className="game-info">
        <strong>{title}</strong>
        {meta && (
          <div className="game-meta">
            <span>{meta[0]}</span>
            {meta[1] && <span>{meta[1]}</span>}
          </div>
        )}
      </div>
    </>
  );

  if (!game) {
    // title has no real record behind it — render the design card statically
    return (
      <div className="game-card" data-static title={title}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="game-card"
      title={`Open the ${title} game page`}
      onClick={() => navigate("play", { gameId: game.id })}
    >
      {inner}
    </button>
  );
}

/** Standard page head used by the discovery pages. */
export function PageHead({
  kicker,
  title,
  subtitle,
}: {
  kicker?: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="page-head">
      <div>
        {kicker && <div className="kicker">{kicker}</div>}
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
