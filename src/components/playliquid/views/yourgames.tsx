"use client";

/** Your games — library grid, per the design. Cards link to the game page. */
import { DesignGameCard, PageHead } from "./design-cards";

export function YourGamesView() {
  return (
    <section aria-label="Your games">
      <PageHead
        kicker="Your library"
        title="Your games"
        subtitle="Games and Sparks you've created, saved or played."
      />
      <div className="game-grid">
        <DesignGameCard
          cover="c2"
          title="Neon Breaker"
          meta={["Recently played", "1.3M plays"]}
        />
      </div>
    </section>
  );
}
