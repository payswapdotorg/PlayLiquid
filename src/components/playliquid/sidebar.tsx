"use client";

import { useEffect, useState } from "react";
import {
  Compass,
  Flame,
  Gamepad2,
  History,
  Home,
  ListVideo,
  Radio,
  Settings,
  Sparkles,
  Trophy,
  UserRound,
} from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { HomeDTO } from "@/lib/types";

type NavItem = { view: "home" | "sparks" | "studio" | "newtask" | "creator"; label: string; icon: typeof Home };

const MAIN_NAV: NavItem[] = [
  { view: "home", label: "Home", icon: Home },
  { view: "sparks", label: "Sparks", icon: Sparkles },
  { view: "studio", label: "Game Studio", icon: Gamepad2 },
];

const YOU_NAV: NavItem[] = [
  { view: "creator", label: "Your games", icon: ListVideo },
];

const EXPLORE_NAV: NavItem[] = [
  { view: "home", label: "Trending", icon: Flame },
  { view: "home", label: "Live", icon: Radio },
  { view: "home", label: "Leaderboards", icon: Trophy },
  { view: "home", label: "Explore", icon: Compass },
];

/** One sidebar row (module-level — no render-time component creation). */
function NavRow({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const navigate = usePlayLiquid((s) => s.navigate);
  const Icon = item.icon;
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={() => {
        navigate(item.view);
        onNavigate?.();
      }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-6 rounded-lg px-3 py-2.5 text-sm font-medium leading-none transition-colors",
        active ? "bg-secondary text-foreground" : "text-foreground/90 hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-[22px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

/** Sidebar navigation — expanded desktop / mobile drawer share this nav. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const view = usePlayLiquid((s) => s.view);
  const navigate = usePlayLiquid((s) => s.navigate);
  const { data } = useApi<HomeDTO>("/api/home");

  const studios = Array.from(
    new Map((data?.recommended ?? []).map((g) => [g.creator.id, g.creator])).values(),
  ).slice(0, 5);

  const Row = NavRow;

  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-0.5 px-2 pb-4">
      {MAIN_NAV.map((item) => (
        <Row key={item.label} item={item} active={view === item.view} />
      ))}

      <div className="mx-3 my-2 border-t border-border/70" role="separator" />
      <Row item={{ view: "creator", label: "You", icon: UserRound }} active={view === "creator"} />
      {YOU_NAV.map((item) => (
        <Row key={item.label} item={item} active={view === "creator"} />
      ))}
      <Row item={{ view: "newtask", label: "New Task", icon: History }} active={view === "newtask"} />

      <div className="mx-3 my-2 border-t border-border/70" role="separator" />
      <h3 className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Studios
      </h3>
      {studios.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => {
            navigate("home");
            onNavigate?.();
          }}
          className="flex cursor-pointer items-center gap-6 rounded-lg px-3 py-2 text-sm text-foreground/90 transition-colors hover:bg-accent/60"
        >
          <img src={s.avatarUrl} alt="" loading="lazy" className="size-6 shrink-0 rounded-full object-cover" />
          <span className="truncate">{s.name}</span>
          {s.verified && (
            <svg viewBox="0 0 24 24" className="ml-auto size-3.5 shrink-0 fill-pl-cyan" aria-label="Verified">
              <path d="M12 2l2.39 2.09 3.1-.52 1.13 2.94 2.94 1.13-.52 3.1L23 12l-1.96 2.26.52 3.1-2.94 1.13-1.13 2.94-3.1-.52L12 22l-2.39-2.09-3.1.52-1.13-2.94-2.94-1.13.52-3.1L1 12l2.39-2.26-.52-3.1 2.94-1.13L4.94 3.57l3.1.52L12 2zm-1 13.5l6-6-1.41-1.41L11 12.67 8.41 10.09 7 11.5l4 4z" />
            </svg>
          )}
        </button>
      ))}

      <div className="mx-3 my-2 border-t border-border/70" role="separator" />
      <h3 className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Explore
      </h3>
      {EXPLORE_NAV.map((item) => (
        <Row key={item.label} item={item} active={false} />
      ))}

      <div className="mx-3 my-2 border-t border-border/70" role="separator" />
      <button
        type="button"
        onClick={() => {
          navigate("studio");
          onNavigate?.();
        }}
        className="flex cursor-pointer items-center gap-6 rounded-lg px-3 py-2 text-sm text-foreground/90 transition-colors hover:bg-accent/60"
      >
        <Settings className="size-[22px] shrink-0" strokeWidth={1.8} />
        <span>Settings</span>
      </button>

      <p className="px-3 pt-3 text-[11px] text-muted-foreground/70">© 2026 PlayLiquid GameOS</p>
    </nav>
  );
}

/** Desktop sidebar — collapsible to an icon rail. */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const saved = window.localStorage.getItem("pl-sidebar-collapsed");
    if (saved === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage after SSR
      setCollapsed(true);
    }
  }, []);
  function toggle() {
    setCollapsed((c) => {
      window.localStorage.setItem("pl-sidebar-collapsed", c ? "0" : "1");
      return !c;
    });
  }
  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title="Toggle sidebar"
        className="fixed bottom-4 left-4 z-40 hidden cursor-pointer rounded-full border border-border/70 bg-card/90 p-2.5 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground md:block"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d={collapsed ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7"} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <aside
        data-collapsed={collapsed}
        className={cn(
          "hidden shrink-0 overflow-y-auto slim-scrollbar transition-[width] duration-200 md:block",
          collapsed ? "w-[72px]" : "w-60",
        )}
      >
        {collapsed ? <SidebarRail /> : <SidebarNav />}
      </aside>
    </>
  );
}

function SidebarRail() {
  const view = usePlayLiquid((s) => s.view);
  const navigate = usePlayLiquid((s) => s.navigate);
  const items = [...MAIN_NAV, { view: "creator" as const, label: "You", icon: UserRound }, { view: "newtask" as const, label: "New Task", icon: History }];
  return (
    <nav aria-label="Main navigation (collapsed)" className="flex w-full flex-col items-center gap-1 px-1 py-2">
      {items.map((item) => {
        const Icon = item.icon;
        const active = view === item.view;
        return (
          <button
            key={item.label}
            type="button"
            aria-current={active ? "page" : undefined}
            title={item.label}
            onClick={() => navigate(item.view)}
            className={cn(
              "flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg px-1 py-3.5 text-[10px] leading-tight transition-colors",
              active ? "bg-secondary text-foreground" : "text-foreground/90 hover:bg-accent/60",
            )}
          >
            <Icon className="size-6" strokeWidth={active ? 2.2 : 1.8} />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
