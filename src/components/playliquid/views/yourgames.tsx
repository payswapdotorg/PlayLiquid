"use client";

/** Your games — drafts and published games from your studio (GET /api/studio). */
import { useApi } from "@/hooks/use-api";
import { GameCard } from "../game-card";
import { PageHead } from "./design-cards";
import type { GameDTO, StudioDTO } from "@/lib/types";

/** Drafts first, then published — each group freshest first. */
function sortMyGames(games: GameDTO[]): GameDTO[] {
  return [...games].sort((a, b) => {
    const draftDiff = Number(b.status === "draft") - Number(a.status === "draft");
    if (draftDiff !== 0) return draftDiff;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function YourGamesView() {
  const { data, loading, error, reload } = useApi<StudioDTO>("/api/studio");
  const games = data ? sortMyGames(data.myGames) : [];

  return (
    <section aria-label="Your games">
      <PageHead
        kicker="Your library"
        title="Your games"
        subtitle="Drafts and published games from your studio."
      />
      {loading && (
        <div className="game-grid" aria-busy="true" aria-label="Loading your games">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl bg-secondary" style={{ aspectRatio: "16 / 9" }} />
          ))}
        </div>
      )}
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
            You haven&apos;t created any games yet.
            <br />
            <small>Open New Task to build your first world.</small>
          </div>
        ) : (
          <div className="game-grid">
            {games.map((g) => (
              <GameCard key={g.id} game={g} openBuild={g.status === "draft"} />
            ))}
          </div>
        ))}
    </section>
  );
}
