"use client";

/**
 * PlayLiquid GameOS — Interface Reconstruction v2 application shell.
 *
 * Three experiences share the single `/` route (hash-synced SPA):
 *  - the web experience (sidebar + topbar + pages) — home, Sparks, the game
 *    pages and every discovery page;
 *  - the creator workspace (full-screen desktop shell) — New Task, Automations
 *    and the Plugin Marketplace;
 *  - the settings window.
 *
 * The home feed and the game pages (play / details) are the pre-reconstruction
 * implementations and render full-bleed inside the content column.
 */
import { useEffect } from "react";
import { isDeskView, usePlayLiquid } from "@/lib/store";
import { cn } from "@/lib/utils";
import { HoverPreviewLayer } from "./hover-preview";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { HomeView } from "./views/home";
import { PlayView } from "./views/play";
import { SparksView } from "./views/sparks";
import { DetailsView } from "./views/details";
import { ChannelView } from "./views/channel";
import { YouView } from "./views/you";
import { YourGamesView } from "./views/yourgames";
import { TrendingView } from "./views/trending";
import { LiveView } from "./views/live";
import { LeaderboardsView } from "./views/leaderboards";
import { ExploreView } from "./views/explore";
import { DeskShell } from "./desk/desk-shell";
import { SettingsShell } from "./settings";

export function PlayLiquidApp() {
  const hydrate = usePlayLiquid((s) => s.hydrate);

  useEffect(() => {
    hydrate();
    // dark-first theme (persisted)
    try {
      const saved = window.localStorage.getItem("pl-theme");
      const dark = saved ? saved === "dark" : true;
      document.documentElement.classList.toggle("dark", dark);
    } catch {
      document.documentElement.classList.add("dark");
    }
  }, [hydrate]);

  return (
    <div className="app">
      <ExperienceRouter />
      {/* the ONE shared hover-preview player (kept home feed) */}
      <HoverPreviewLayer />
    </div>
  );
}

function ExperienceRouter() {
  const view = usePlayLiquid((s) => s.view);
  const settingsOpen = usePlayLiquid((s) => s.settingsOpen);

  if (settingsOpen) return <SettingsShell />;
  if (isDeskView(view)) return <DeskShell />;
  return <WebShell />;
}

/** Browser experience: fixed 240px sidebar + topbar + routed page. */
function WebShell() {
  const view = usePlayLiquid((s) => s.view);
  const gameId = usePlayLiquid((s) => s.gameId);
  const sparkIndex = usePlayLiquid((s) => s.sparkIndex);

  // the kept pre-reconstruction pages manage their own padding and width
  const bare = view === "home" || view === "play" || view === "details";

  return (
    <div className="web-shell" id="webShell">
      <Sidebar />
      <main className="web-main">
        <Topbar />
        <div className={cn("web-content", bare && "web-content--bare")}>
          {view === "home" && <HomeView />}
          {view === "play" && <PlayView gameId={gameId} />}
          {view === "details" && <DetailsView gameId={gameId} />}
          {view === "sparks" && <SparksView initialIndex={sparkIndex} />}
          {view === "channel" && <ChannelView />}
          {view === "you" && <YouView />}
          {view === "yourgames" && <YourGamesView />}
          {view === "trending" && <TrendingView />}
          {view === "live" && <LiveView />}
          {view === "leaderboards" && <LeaderboardsView />}
          {view === "explore" && <ExploreView />}
        </div>
      </main>
    </div>
  );
}
