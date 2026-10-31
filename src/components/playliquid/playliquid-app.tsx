"use client";

/**
 * PlayLiquid GameOS — the single-route application shell.
 * All eight product surfaces ride one hash-routed SPA at `/`.
 */
import { useEffect } from "react";
import { usePlayLiquid } from "@/lib/store";
import { HoverPreviewLayer } from "./hover-preview";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { HomeView } from "./views/home";
import { PlayView } from "./views/play";
import { SparksView } from "./views/sparks";
import { DetailsView } from "./views/details";
import { NewTaskView } from "./views/new-task";
import { GameStudioView } from "./views/game-studio";
import { GameBuilderView } from "./views/game-builder";
import { CreatorStudioView } from "./views/creator-studio";

export function PlayLiquidApp() {
  const hydrate = usePlayLiquid((s) => s.hydrate);
  const view = usePlayLiquid((s) => s.view);
  const gameId = usePlayLiquid((s) => s.gameId);
  const sparkIndex = usePlayLiquid((s) => s.sparkIndex);

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
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Topbar />
      <div className="flex flex-1">
        <Sidebar />
        <main id="main" className="min-w-0 flex-1">
          {view === "home" && <HomeView />}
          {view === "play" && <PlayView gameId={gameId} />}
          {view === "sparks" && <SparksView initialIndex={sparkIndex} />}
          {view === "details" && <DetailsView gameId={gameId} />}
          {view === "newtask" && <NewTaskView />}
          {view === "studio" && <GameStudioView />}
          {view === "builder" && <GameBuilderView gameId={gameId} />}
          {view === "creator" && <CreatorStudioView />}
        </main>
      </div>
      <footer className="mt-auto border-t border-border/50 bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:px-6">
          <p className="flex items-center gap-1.5">
            <span className="pl-brand-text font-semibold">PlayLiquid</span> GameOS — create, discover, play.
          </p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="cursor-default hover:text-foreground">About</span>
            <span className="cursor-default hover:text-foreground">Creators</span>
            <span className="cursor-default hover:text-foreground">Developers</span>
            <span className="cursor-default hover:text-foreground">Terms</span>
            <span className="cursor-default hover:text-foreground">Privacy</span>
          </nav>
          <p>© 2026 PlayLiquid</p>
        </div>
      </footer>
      {/* the ONE shared hover-preview player */}
      <HoverPreviewLayer />
    </div>
  );
}
