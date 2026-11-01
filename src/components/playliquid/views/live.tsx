"use client";

/** Live — live worlds, creators and community sessions, backed by /api/home. */
import { useApi } from "@/hooks/use-api";
import { GameCard } from "../game-card";
import { PageHead } from "./design-cards";
import type { HomeDTO } from "@/lib/types";

export function LiveView() {
  const { data, loading, error, reload } = useApi<HomeDTO>("/api/home");
  const games = data?.live ?? [];

  return (
    <section aria-label="Live">
      <PageHead title="Live" subtitle="Live worlds, creators and community sessions." />
      {loading && <LiveSkeleton />}
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
          <div className="page-empty">
            No live experiences right now.
            <br />
            <small>When studios go live, their sessions appear here.</small>
          </div>
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

function LiveSkeleton() {
  return (
    <div className="game-grid" aria-busy="true" aria-label="Loading live experiences">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl bg-secondary" style={{ aspectRatio: "16 / 9" }} />
      ))}
    </div>
  );
}
