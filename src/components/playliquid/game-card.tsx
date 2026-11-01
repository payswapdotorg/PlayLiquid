"use client";

import { BookmarkPlus, Flame, Gamepad2, ListPlus, MoreVertical, Radio, Share2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHoverPreview } from "./hover-preview";
import { postJson } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { formatCount, formatPlays } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GameDTO } from "@/lib/types";

type GameCardProps = {
  game: GameDTO;
  variant?: "grid" | "rail";
  className?: string;
  /** Draft games open the Game Builder instead of the play page. */
  openBuild?: boolean;
};

/** PlayLiquid game card: cover + metadata + status, with real hover preview. */
export function GameCard({ game, variant = "grid", className, openBuild }: GameCardProps) {
  const navigate = usePlayLiquid((s) => s.navigate);
  const toggleSave = usePlayLiquid((s) => s.toggleSave);
  const saved = !!usePlayLiquid((s) => s.savedGames[game.id]);
  const hover = useHoverPreview({
    previewUrl: game.previewUrl,
    thumbnailUrl: game.thumbnailUrl,
    title: game.title,
  });

  function openGame(target: "play" | "details" | "build") {
    navigate(target, { gameId: game.id });
  }

  function openPrimary() {
    openGame(openBuild ? "build" : "play");
  }

  async function share() {
    const link = `${window.location.origin}/#view=details&game=${game.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied to clipboard");
    } catch {
      toast.info(`Share: ${link}`);
    }
  }

  return (
    <article
      className={cn(
        "group/card flex flex-col",
        variant === "rail" && "w-[300px] shrink-0 sm:w-[340px]",
        className,
      )}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
    >
      <button
        type="button"
        onClick={openPrimary}
        aria-label={openBuild ? `Open ${game.title} in the Game Builder` : `Play ${game.title}`}
        className="relative block w-full cursor-pointer overflow-hidden rounded-xl bg-secondary text-left"
      >
        <div data-thumb-anchor className="relative aspect-video w-full">
          <img
            src={game.thumbnailUrl}
            alt={`${game.title} cover art`}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover/card:scale-[1.03]"
          />
          {/* status badges */}
          {game.isLive ? (
            <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-sm bg-pl-rose px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">
              <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden />
              Live
            </span>
          ) : game.isUpcoming ? (
            <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-black/80 px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">
              Coming soon
            </span>
          ) : (
            <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
              {game.durationMin} min
            </span>
          )}
          {game.status === "draft" && (
            <span className="absolute left-1.5 top-1.5 rounded-sm bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-black">
              Draft
            </span>
          )}
          {/* play affordance */}
          <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover/card:opacity-100">
            <span className="flex size-12 items-center justify-center rounded-full bg-black/60 pl-1 text-white backdrop-blur-sm">
              <Gamepad2 className="size-6" />
            </span>
          </span>
          {/* continue progress */}
          {(game.progress ?? 0) > 0.02 && (
            <Progress
              value={(game.progress ?? 0) * 100}
              className="absolute bottom-0 left-0 h-1 w-full rounded-none bg-white/30"
              aria-label={`Played ${Math.round((game.progress ?? 0) * 100)}%`}
            />
          )}
        </div>
      </button>

      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={() => openGame("details")}
          aria-label={`Game details for ${game.title}`}
          className="hidden shrink-0 cursor-pointer sm:block"
          tabIndex={-1}
        >
          <Avatar className="size-9">
            {game.creator.avatarUrl ? <AvatarImage src={game.creator.avatarUrl} alt="" /> : null}
            <AvatarFallback>{game.creator.name.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={openPrimary}
            className="block w-full cursor-pointer text-left"
          >
            <h3
              title={game.title}
              className="line-clamp-2 text-sm font-medium leading-snug text-foreground"
            >
              {game.title}
            </h3>
          </button>
          <button
            type="button"
            onClick={() => openGame("details")}
            className="mt-1 flex w-fit cursor-pointer items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="truncate">{game.creator.name}</span>
            {game.creator.verified && (
              <svg viewBox="0 0 24 24" aria-label="Verified studio" className="size-3.5 shrink-0 fill-pl-cyan">
                <path d="M12 2l2.39 2.09 3.1-.52 1.13 2.94 2.94 1.13-.52 3.1L23 12l-1.96 2.26.52 3.1-2.94 1.13-1.13 2.94-3.1-.52L12 22l-2.39-2.09-3.1.52-1.13-2.94-2.94-1.13.52-3.1L1 12l2.39-2.26-.52-3.1 2.94-1.13L4.94 3.57l3.1.52L12 2zm-1 13.5l6-6-1.41-1.41L11 12.67 8.41 10.09 7 11.5l4 4z" />
              </svg>
            )}
          </button>
          <p className="text-[13px] text-muted-foreground">
            {formatPlays(game.plays)} · ★ {game.rating.toFixed(1)}
            {game.multiplayer ? ` · ${game.multiplayer}` : ""}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`More options for ${game.title}`}
              className="h-11 w-11 shrink-0 rounded-full opacity-0 transition-opacity focus-visible:opacity-100 group-hover/card:opacity-100 data-[state=open]:opacity-100 sm:h-8 sm:w-8"
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              onSelect={() => {
                const next = !saved;
                toggleSave(game.id);
                toast.success(next ? "Saved to Library" : "Removed from Library");
                // server-side Library persistence (optimistic)
                void postJson(`/api/games/${game.id}/save`, { saved: next }).catch(() => {
                  toast.error("Could not update your Library");
                });
              }}
            >
              <BookmarkPlus className="size-4" /> {saved ? "Remove from Library" : "Save to Library"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void share()}>
              <Share2 className="size-4" /> Share
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openGame("details")}>
              <ListPlus className="size-4" /> Game details
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

/** A horizontal rail of game cards with a section header. */
export function GameRail({
  title,
  icon,
  games,
  onMore,
  moreLabel,
  railLabel,
}: {
  title: string;
  icon?: React.ReactNode;
  games: GameDTO[];
  onMore?: () => void;
  moreLabel?: string;
  railLabel?: string;
}) {
  if (games.length === 0) return null;
  return (
    <section aria-label={railLabel ?? title} className="mt-8">
      <div className="flex items-center justify-between px-4 sm:px-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground sm:text-xl">
          {icon}
          {title}
        </h2>
        {onMore && (
          <button
            type="button"
            onClick={onMore}
            className="cursor-pointer text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {moreLabel ?? "More"} →
          </button>
        )}
      </div>
      <div className="no-scrollbar mt-3 flex gap-4 overflow-x-auto px-4 pb-2 sm:px-6">
        {games.map((g) => (
          <GameCard key={`${g.id}-${title}`} game={g} variant="rail" />
        ))}
      </div>
    </section>
  );
}

/** Feature-pill header icons used across rails. */
export const RailIcons = {
  Continue: <Flame className="size-5 text-pl-rose" aria-hidden />,
  Trending: <Flame className="size-5 text-pl-rose" aria-hidden />,
  Live: <Radio className="size-5 text-pl-rose" aria-hidden />,
  Sparks: <Sparkles className="size-6 text-pl-rose" strokeWidth={2.2} aria-hidden />,
};
