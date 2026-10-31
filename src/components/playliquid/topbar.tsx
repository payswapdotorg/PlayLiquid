"use client";

import { useMemo, useState } from "react";
import { Bell, Menu, Mic, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { formatCount } from "@/lib/format";
import { PlayLiquidLogo } from "./logo";
import { SidebarNav } from "./sidebar";
import { cn } from "@/lib/utils";
import type { HomeDTO } from "@/lib/types";

/** Topbar — logo, search with suggestions, create, notifications, account. */
export function Topbar() {
  const navigate = usePlayLiquid((s) => s.navigate);
  const view = usePlayLiquid((s) => s.view);
  const { data } = useApi<HomeDTO>(view === "home" ? "/api/home" : null);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focused, setFocused] = useState(false);

  const suggestions = useMemo(() => {
    if (!query.trim() || !data) return [];
    const q = query.toLowerCase();
    const games = data.recommended
      .filter((g) => g.title.toLowerCase().includes(q) || g.category.toLowerCase().includes(q))
      .slice(0, 4);
    const creators = Array.from(new Map(data.recommended.map((g) => [g.creator.id, g.creator])).values())
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 2);
    return [...games.map((g) => ({ id: g.id, kind: "game" as const, label: g.title, meta: g.category })), ...creators.map((c) => ({ id: c.id, kind: "creator" as const, label: c.name, meta: "Studio" }))];
  }, [query, data]);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border/50 bg-background/90 px-2 backdrop-blur-md sm:px-4">
      {/* left: menu + logo */}
      <div className="flex items-center gap-1">
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation menu" className="rounded-full md:hidden">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] overflow-y-auto p-0 pt-14 slim-scrollbar">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Main navigation for PlayLiquid</SheetDescription>
            <SidebarNav onNavigate={() => setDrawerOpen(false)} />
          </SheetContent>
        </Sheet>
        <button
          type="button"
          onClick={() => navigate("home")}
          aria-label="PlayLiquid Home"
          className="cursor-pointer px-1"
        >
          <PlayLiquidLogo />
        </button>
      </div>

      {/* center: search */}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = query.trim();
          if (!q) return;
          const hit = suggestions[0];
          if (hit && hit.kind === "game") navigate("details", { gameId: hit.id });
          else navigate("home");
        }}
        className="relative mx-auto hidden w-full max-w-[560px] items-center gap-2 sm:flex"
      >
        <div className="relative flex h-10 flex-1 items-center rounded-full border border-border bg-secondary/40 focus-within:border-pl-cyan/60">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="Search games, studios, Sparks"
            aria-label="Search games and studios"
            className="h-full flex-1 rounded-l-full bg-transparent pl-4 pr-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="mr-1 cursor-pointer rounded-full p-1.5 text-muted-foreground hover:bg-accent"
            >
              <X className="size-3.5" />
            </button>
          )}
          <button
            type="submit"
            aria-label="Search"
            className="flex h-full cursor-pointer items-center rounded-r-full border-l border-border bg-secondary px-5 transition-colors hover:bg-accent"
          >
            <Search className="size-4" />
          </button>
          {focused && suggestions.length > 0 && (
            <ul
              role="listbox"
              aria-label="Search suggestions"
              className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
            >
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setQuery("");
                      if (s.kind === "game") navigate("details", { gameId: s.id });
                      else navigate("home");
                    }}
                    className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent"
                  >
                    <Search className="size-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{s.label}</span>
                    <span className="text-xs text-muted-foreground">{s.meta}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Search with your voice"
          title="Voice search"
          onClick={() => toast.info("Voice search — hold to speak (demo)")}
          className="size-10 shrink-0 rounded-full bg-secondary/60"
        >
          <Mic className="size-5" />
        </Button>
      </form>

      {/* mobile search icon */}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Search"
        className="rounded-full sm:hidden"
        onClick={() => {
          navigate("home");
          toast.info("Type in the search bar on a wider screen for live suggestions");
        }}
      >
        <Search className="size-5" />
      </Button>

      {/* right: actions */}
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <button
          type="button"
          onClick={() => navigate("newtask")}
          className="hidden cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent sm:flex"
        >
          <Plus className="size-4" /> Create
        </button>
        <button
          type="button"
          aria-label="Notifications"
          onClick={() =>
            toast("3 new notifications", {
              description: "GlitchQueen beat your Neon Breaker score · Lava Leap v1.9 is live · 2 new followers",
            })
          }
          className="relative cursor-pointer rounded-full p-2 transition-colors hover:bg-accent"
        >
          <Bell className="size-5" />
          <span className="absolute right-1 top-1 size-2 rounded-full bg-pl-rose" aria-hidden />
        </button>
        <ThemeToggle />
        <AccountMenu />
      </div>
    </header>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(true);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      window.localStorage.setItem("pl-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      type="button"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggle}
      className="cursor-pointer rounded-full p-2 transition-colors hover:bg-accent"
    >
      {dark ? (
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

function AccountMenu() {
  const [open, setOpen] = useState(false);
  const navigate = usePlayLiquid((s) => s.navigate);
  const { data } = useApi<HomeDTO>("/api/home");
  const followers = data ? data.recommended.find((g) => g.creator.isMe)?.creator.followers ?? 128400 : 128400;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer rounded-full transition-transform hover:scale-105"
      >
        <Avatar className="size-8 border border-pl-cyan/40">
          <AvatarImage src="/avatars/playliquid-labs.jpg" alt="PlayLiquid Labs" />
          <AvatarFallback>P</AvatarFallback>
        </Avatar>
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-hidden onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-xl">
            <div className="px-3 py-2.5">
              <p className="text-sm font-semibold">PlayLiquid Labs</p>
              <p className="text-xs text-muted-foreground">@playliquidlabs · {formatCount(followers)} followers</p>
            </div>
            <div className="my-1 border-t border-border/60" />
            {[
              { label: "Game Studio", view: "studio" as const },
              { label: "Creator Studio", view: "creator" as const },
              { label: "New Task", view: "newtask" as const },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate(item.view);
                }}
                className="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
