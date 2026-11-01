"use client";

/** Trending — the games and Sparks people are playing now, backed by /api/home. */
import { useApi } from "@/hooks/use-api";
import { GameCard } from "../game-card";
import { PageHead } from "./design-cards";
import type { HomeDTO } from "@/lib/types";

export function TrendingView() {
  const { data, loading, error, reload } = useApi<HomeDTO>("/api/home");
  const games = data?.trending ?? [];

  return (
    <section aria-label="Trending">
      <PageHead title="Trending" subtitle="The games and Sparks people are playing now." />
      {loading && <TrendingSkeleton />}
      {error && (
        <div className="page-empty" role="alert">
          Something went wrong
          <br />
          <small>{error}</small>
          <br />
          <button type="button" className="small-action" style={{ marginTop: 12 }} onClick={() => void reload()}>
            Try again
          </button>
        </div>
      )}
      {data &&
        (games.length === 0 ? (
          <div className="empty-note">Nothing is trending right now — check back soon.</div>
        ) : (
          <div className="game-grid">
            {games.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
        ))}
    </section>
  );
}

function TrendingSkeleton() {
  return (
    <div className="game-grid" aria-busy="true" aria-label="Loading trending games">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl bg-secondary" style={{ aspectRatio: "16 / 9" }} />
      ))}
    </div>
  );
}
