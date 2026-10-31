"use client";

/** Explore — browse games, studios, Sparks and experiences, per the design. */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { DesignGameCard, PageHead } from "./design-cards";

const FILTERS = ["All worlds", "Games", "Sparks", "Experiences", "Digital twins"];

export function ExploreView() {
  const [active, setActive] = useState(FILTERS[0]);
  return (
    <section aria-label="Explore">
      <PageHead title="Explore" subtitle="Browse games, studios, Sparks and experiences." />
      <div className="filters" role="tablist" aria-label="Explore filters">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={cn("filter", active === f && "active")}
            aria-pressed={active === f}
            onClick={() => setActive(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="game-grid">
        <DesignGameCard cover="c2" title="Neon Breaker" />
        <DesignGameCard cover="c3" title="Crystal Smash" />
        <DesignGameCard cover="c4" title="Aqua Islands" />
        <DesignGameCard cover="c5" title="Skyline Builder" />
      </div>
    </section>
  );
}
