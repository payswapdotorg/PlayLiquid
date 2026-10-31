"use client";

/**
 * Web sidebar — ported from the Interface Reconstruction v2 design:
 * brand bar, primary nav, personal nav (You / Your games / New Task),
 * the five studio rows and the Explore nav. Glyph icons are Lucide
 * components; studio avatars keep the mockup's glyph badges.
 */
import {
  CirclePlus,
  Compass,
  Flame,
  Home,
  ListVideo,
  Radio,
  Sparkles,
  Trophy,
  UserRound,
} from "lucide-react";
import { usePlayLiquid } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { ViewName } from "@/lib/types";

const STUDIOS: { name: string; avatar: string; verified?: boolean }[] = [
  { name: "PlayLiquid Labs", avatar: "✦", verified: true },
  { name: "Cloud Nine Arcade", avatar: "☁" },
  { name: "Volcano Interactive", avatar: "🌋", verified: true },
  { name: "Pixel Pioneers", avatar: "♟", verified: true },
  { name: "Starloop Games", avatar: "🌌" },
];

const EXPLORE: { view: ViewName; label: string; icon: typeof Flame }[] = [
  { view: "trending", label: "Trending", icon: Flame },
  { view: "live", label: "Live", icon: Radio },
  { view: "leaderboards", label: "Leaderboards", icon: Trophy },
  { view: "explore", label: "Explore", icon: Compass },
];

function NavButton({
  view,
  label,
  icon: Icon,
  active,
}: {
  view: ViewName;
  label: string;
  icon: typeof Flame;
  active: boolean;
}) {
  const navigate = usePlayLiquid((s) => s.navigate);
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={() => navigate(view)}
      className={cn(active && "active")}
    >
      <span className="nav-icon" aria-hidden>
        <Icon className="size-[18px]" strokeWidth={active ? 2.2 : 1.9} />
      </span>
      <span className="nav-text">{label}</span>
    </button>
  );
}

export function Sidebar() {
  const view = usePlayLiquid((s) => s.view);
  const navigate = usePlayLiquid((s) => s.navigate);

  return (
    <aside className="web-sidebar" aria-label="PlayLiquid navigation">
      <button
        type="button"
        className="web-brandbar"
        title="Go to PlayLiquid Home"
        onClick={() => navigate("home")}
      >
        <span className="drop-logo" aria-hidden />
        <span className="brand-word">PlayLiquid</span>
      </button>

      <nav className="web-nav" aria-label="Primary">
        <NavButton view="home" label="Home" icon={Home} active={view === "home"} />
        <NavButton view="sparks" label="Sparks" icon={Sparkles} active={view === "sparks"} />
      </nav>

      <nav className="web-nav" aria-label="You">
        <NavButton view="you" label="You" icon={UserRound} active={view === "you"} />
        <NavButton view="yourgames" label="Your games" icon={ListVideo} active={view === "yourgames"} />
        <button
          type="button"
          onClick={() => navigate("newtask")}
          aria-label="Open the creator workspace"
        >
          <span className="nav-icon" aria-hidden>
            <CirclePlus className="size-[18px]" strokeWidth={1.9} />
          </span>
          <span className="nav-text">New Task</span>
        </button>
      </nav>

      <div className="nav-caption">Studios</div>
      {STUDIOS.map((s) => (
        <button
          key={s.name}
          type="button"
          className="studio-row"
          onClick={() => navigate("channel", { channel: s.name })}
        >
          <span className="studio-avatar" aria-hidden>
            {s.avatar}
          </span>
          <span className="studio-name">{s.name}</span>
          {s.verified && (
            <span className="verified" title="Verified studio" aria-label="Verified studio">
              ✿
            </span>
          )}
        </button>
      ))}

      <div className="nav-caption">Explore</div>
      <nav className="web-nav" style={{ border: 0 }} aria-label="Explore">
        {EXPLORE.map((item) => (
          <NavButton
            key={item.view}
            view={item.view}
            label={item.label}
            icon={item.icon}
            active={view === item.view}
          />
        ))}
      </nav>
    </aside>
  );
}
