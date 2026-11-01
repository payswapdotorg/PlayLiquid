"use client";

/** Leaderboards — top players (GET /api/leaderboards) and the most-played games. */
import { useApi } from "@/hooks/use-api";
import { GameCard } from "../game-card";
import { PageHead } from "./design-cards";
import type { LeaderboardsDTO } from "@/lib/types";

const MEDALS = ["🥇", "🥈", "🥉"];

export function LeaderboardsView() {
  const { data, loading, error, reload } = useApi<LeaderboardsDTO>("/api/leaderboards");
  const players = data?.topPlayers ?? [];
  const topGames = data?.topGames ?? [];

  return (
    <section aria-label="Leaderboards">
      <PageHead title="Leaderboards" subtitle="Top players and world records." />
      {loading && (
        <div className="page-empty" aria-busy="true">
          Loading leaderboards…
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
      {data && players.length === 0 && (
        <div className="empty-note">No runs have been scored yet — play a game to claim the top spot.</div>
      )}

      {data && players.length > 0 && (
        <>
          <div className="lb-podium">
            {players.slice(0, 3).map((p, i) => (
              <div className="lb-pod" key={p.player}>
                <div className="medal" aria-hidden>
                  {MEDALS[i]}
                </div>
                <div className="name">{p.player}</div>
                <div className="pts">{p.totalScore.toLocaleString()}</div>
                <small>
                  {p.runs} runs · best in {p.bestGame}
                </small>
              </div>
            ))}
          </div>

          <div className="lb-table" role="table" aria-label="Top players">
            <div className="lb-row head" role="row">
              <span role="columnheader">#</span>
              <span role="columnheader">Player</span>
              <span role="columnheader">Total score</span>
              <span className="best" role="columnheader">
                Best game
              </span>
            </div>
            {players.map((p, i) => (
              <div className="lb-row" role="row" key={p.player}>
                <span className="rank" role="cell">
                  {i + 1}
                </span>
                <span
                  role="cell"
                  style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}
                >
                  <img
                    src={p.avatar}
                    alt=""
                    width={26}
                    height={26}
                    style={{ borderRadius: "50%", objectFit: "cover", flex: "none" }}
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.player}
                  </span>
                </span>
                <span className="pts" role="cell">
                  {p.totalScore.toLocaleString()}
                </span>
                <span className="best" role="cell">
                  {p.bestGame}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {data && topGames.length > 0 && (
        <>
          <div className="section-head">
            <h2>Most played</h2>
          </div>
          <div className="game-grid">
            {topGames.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
