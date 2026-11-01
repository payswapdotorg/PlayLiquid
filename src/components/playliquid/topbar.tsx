"use client";

/**
 * Web topbar — ported from the Interface Reconstruction v2 design:
 * global search (+ voice + submit), Create menu, notifications, appearance
 * toggle and the profile orb. Popovers anchor under their triggers.
 */
import { useEffect, useRef, useState } from "react";
import { Bell, Mic, Moon, Plus, Search, Sun } from "lucide-react";
import { toast } from "sonner";
import { usePlayLiquid } from "@/lib/store";

export function Topbar() {
  const navigate = usePlayLiquid((s) => s.navigate);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [dark, setDark] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from the DOM theme after the app shell mounts
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  // close menus on outside click
  useEffect(() => {
    if (!createOpen && !notifyOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setCreateOpen(false);
        setNotifyOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [createOpen, notifyOpen]);

  function submitSearch() {
    const q = query.trim();
    if (q) {
      // hand the query to the Explore view via the store (hash keeps &q=)
      navigate("explore", { search: q });
      setQuery("");
    } else {
      toast("Enter a game, studio or Spark to search");
    }
  }

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      window.localStorage.setItem("pl-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
    toast("Appearance updated");
  }

  return (
    <header className="web-topbar">
      <div ref={rootRef} className="contents">
        <div className="web-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSearch();
            }}
            id="globalSearch"
            placeholder="Search games, studios, Sparks"
            aria-label="Search games, studios, Sparks"
          />
          <button
            type="button"
            className="search-btn"
            title="Search"
            aria-label="Search"
            onClick={submitSearch}
          >
            <Search className="size-[18px]" strokeWidth={2} />
          </button>
        </div>
        <button
          type="button"
          className="round-action"
          title="Voice search"
          aria-label="Voice search"
          onClick={() => toast("Voice search preview")}
        >
          <Mic className="size-[17px]" strokeWidth={1.9} />
        </button>
        <span className="top-spacer" />
        <button
          type="button"
          className="create-btn"
          aria-haspopup="menu"
          aria-expanded={createOpen}
          onClick={() => {
            setCreateOpen((o) => !o);
            setNotifyOpen(false);
          }}
        >
          <Plus className="size-[13px]" strokeWidth={2.4} aria-hidden />
          Create
        </button>
        <button
          type="button"
          className="round-action notif"
          title="Notifications"
          aria-label="Notifications"
          aria-haspopup="menu"
          aria-expanded={notifyOpen}
          onClick={() => {
            setNotifyOpen((o) => !o);
            setCreateOpen(false);
          }}
        >
          <Bell className="size-[17px]" strokeWidth={1.9} />
        </button>
        <button
          type="button"
          className="round-action"
          title="Toggle appearance"
          aria-label="Toggle appearance"
          onClick={toggleTheme}
        >
          {dark ? (
            <Sun className="size-[17px]" strokeWidth={1.9} />
          ) : (
            <Moon className="size-[17px]" strokeWidth={1.9} />
          )}
        </button>
        <button
          type="button"
          className="user-orb"
          title="Profile"
          aria-label="Open your profile"
          onClick={() => navigate("you")}
        />

        {createOpen && (
          <div
            className="popover"
            role="menu"
            style={{ top: "calc(100% + 2px)", right: 168 }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setCreateOpen(false);
                navigate("newtask", { prefill: "Create a new game world from this idea: " });
              }}
            >
              Create a game / world
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setCreateOpen(false);
                navigate("newtask", { prefill: "Create a new instant-play Spark: " });
              }}
            >
              Create a Spark
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setCreateOpen(false);
                navigate("automations");
              }}
            >
              Create an automation
            </button>
          </div>
        )}
        {notifyOpen && (
          <div
            className="popover"
            role="menu"
            style={{ top: "calc(100% + 2px)", right: 64 }}
          >
            <b style={{ fontSize: 12 }}>Notifications</b>
            <p style={{ color: "#a9b6c7", fontSize: 12, margin: "8px 4px 3px" }}>
              You&apos;re all caught up.
            </p>
          </div>
        )}
      </div>
    </header>
  );
}
