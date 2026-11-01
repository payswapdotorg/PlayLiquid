"use client";

/** Explore — real search across games and Sparks (topbar hands off here). */
import { useState } from "react";
import { Search } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { GameCard } from "../game-card";
import { usePlayLiquid } from "@/lib/store";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHead } from "./design-cards";
import type { GamesPageDTO, SparkDTO, SparksPageDTO } from "@/lib/types";

type ExploreType = "all" | "games" | "sparks";

const TYPES: { id: ExploreType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "games", label: "Games" },
  { id: "sparks", label: "Sparks" },
];

export function ExploreView() {
  const searchQuery = usePlayLiquid((s) => s.searchQuery);
  const setSearchQuery = usePlayLiquid((s) => s.setSearchQuery);
  const [type, setType] = useState<ExploreType>("all");

  // the search box follows the store query (topbar hand-off / back button)
  const [input, setInput] = useState(searchQuery);
  const [prevQuery, setPrevQuery] = useState(searchQuery);
  if (prevQuery !== searchQuery) {
    setPrevQuery(searchQuery);
    setInput(searchQuery);
  }

  const q = searchQuery.trim();
  const gamesApi = useApi<GamesPageDTO>(
    type === "sparks" ? null : `/api/games?cursor=0${q ? `&q=${encodeURIComponent(q)}` : ""}`,
  );
  const sparksApi = useApi<SparksPageDTO>(
    type === "games" ? null : `/api/sparks?cursor=0${q ? `&q=${encodeURIComponent(q)}` : ""}`,
  );
  const games = gamesApi.data?.games ?? [];
  const sparks = sparksApi.data?.sparks ?? [];
  const loading = gamesApi.loading || sparksApi.loading;
  const failed = gamesApi.error || sparksApi.error;

  function submit() {
    setSearchQuery(input.trim());
  }

  return (
    <section aria-label="Explore">
      <PageHead title="Explore" subtitle="Search games, studios and Sparks." />

      <div className="explore-search" role="search">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Search games, studios and Sparks"
          aria-label="Search games, studios and Sparks"
        />
        <button type="button" className="chip active" onClick={submit}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Search className="size-4" strokeWidth={2} aria-hidden />
            Search
          </span>
        </button>
      </div>

      <div className="chip-row" role="tablist" aria-label="Result type">
        {TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={cn("chip", type === t.id && "active")}
            aria-pressed={type === t.id}
            onClick={() => setType(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="game-grid" aria-busy="true" aria-label="Searching">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl bg-secondary" style={{ aspectRatio: "16 / 9" }} />
          ))}
        </div>
      )}

      {failed && !loading && (
        <div className="page-empty" role="alert">
          Something went wrong
          <br />
          <small>{failed}</small>
        </div>
      )}

      {!loading && !failed && (
        <>
          {(type === "all" || type === "games") && (
            <>
              {games.length > 0 ? (
                <div className="game-grid">
                  {games.map((g) => (
                    <GameCard key={g.id} game={g} />
                  ))}
                </div>
              ) : (
                type === "games" && (
                  <div className="empty-note">
                    {q ? `No results for “${q}”` : "Nothing here yet — try a search."}
                  </div>
                )
              )}
            </>
          )}

          {(type === "all" || type === "sparks") && (
            <>
              {type === "all" && sparks.length > 0 && (
                <div className="section-head">
                  <h2>Sparks</h2>
                </div>
              )}
              {sparks.length > 0 ? (
                <div className="flex flex-wrap gap-4">
                  {sparks.map((s) => (
                    <ExploreSparkTile key={s.id} spark={s} />
                  ))}
                </div>
              ) : (
                type === "sparks" && (
                  <div className="empty-note">
                    {q ? `No results for “${q}”` : "Nothing here yet — try a search."}
                  </div>
                )
              )}
            </>
          )}

          {type === "all" && games.length === 0 && sparks.length === 0 && (
            <div className="empty-note">
              {q ? `No results for “${q}”` : "Nothing here yet — try a search."}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** A simple 9:16 Spark tile; opens the linked game or the Sparks feed. */
function ExploreSparkTile({ spark }: { spark: SparkDTO }) {
  const navigate = usePlayLiquid((s) => s.navigate);
  return (
    <button
      type="button"
      onClick={() =>
        spark.game ? navigate("play", { gameId: spark.game.id }) : navigate("sparks")
      }
      aria-label={`Open ${spark.title}`}
      className="group w-[150px] shrink-0 cursor-pointer text-left sm:w-[168px]"
    >
      <div className="channel-short-thumb" style={{ height: 225 }}>
        <video
          src={spark.videoUrl}
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          onMouseEnter={(e) => e.currentTarget.play().catch(() => undefined)}
          onMouseLeave={(e) => {
            e.currentTarget.pause();
            e.currentTarget.currentTime = 0;
          }}
        />
        <span
          className="absolute bottom-2 right-2 z-10 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white"
          aria-hidden
        >
          {formatCount(spark.likes)} ♥
        </span>
      </div>
      <div className="channel-short-info">
        {spark.title}
        <small>
          {spark.creator.name} · {formatCount(spark.plays)} plays
        </small>
      </div>
    </button>
  );
}
