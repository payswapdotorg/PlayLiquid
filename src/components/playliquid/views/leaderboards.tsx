"use client";

/** Leaderboards — top players and world records, per the design. */
import { PageHead } from "./design-cards";

const RANKS: { n: string; player: string; score: string }[] = [
  { n: "1", player: "🥇 Sky Runner", score: "42,980" },
  { n: "2", player: "👾 Pixel Nomad", score: "38,400" },
  { n: "3", player: "🟠 Arcade Junkie", score: "35,280" },
];

export function LeaderboardsView() {
  return (
    <section aria-label="Leaderboards">
      <PageHead title="Leaderboards" subtitle="Top players and world records." />
      <div className="rail-card">
        {RANKS.map((r) => (
          <div className="rank" key={r.n}>
            <span className="rank-number">{r.n}</span>
            <span>{r.player}</span>
            <b>{r.score}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
