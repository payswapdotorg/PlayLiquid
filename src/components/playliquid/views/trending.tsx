"use client";

/** Trending — the games and Sparks people are playing now, per the design. */
import { DesignGameCard, PageHead } from "./design-cards";

export function TrendingView() {
  return (
    <section aria-label="Trending">
      <PageHead title="Trending" subtitle="The games and Sparks people are playing now." />
      <div className="game-grid">
        <DesignGameCard cover="c2" title="Neon Breaker" meta={["Arcade", "1.3M plays"]} />
        <DesignGameCard cover="c3" title="Crystal Smash" />
        <DesignGameCard cover="c4" title="Lava Leap" />
      </div>
    </section>
  );
}
