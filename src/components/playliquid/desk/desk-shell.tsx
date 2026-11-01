"use client";

/**
 * Desktop shell — the ZCode-derived creator workspace from the Interface
 * Reconstruction v2 design: brand bar back to the web experience, the
 * New Task / Automations / Plugin Marketplace nav, the task list and the
 * user row (settings).
 */
import { useEffect } from "react";
import { CirclePlus, Clock, LayoutGrid, Settings } from "lucide-react";
import { usePlayLiquid } from "@/lib/store";
import { useApi } from "@/hooks/use-api";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TaskDTO, ViewName } from "@/lib/types";
import { useDeskTasks } from "./desk-tasks";
import { NewTaskView } from "./newtask";
import { GameBuilderView } from "./gamebuilder";
import { AutomationsView } from "./automations";
import { PluginsView } from "./plugins";

const NAV: { view: ViewName; label: string; icon: typeof Clock; shortcut?: string }[] = [
  { view: "newtask", label: "New task", icon: CirclePlus, shortcut: "Ctrl+N" },
  { view: "automations", label: "Automations", icon: Clock },
  { view: "plugins", label: "Plugin Marketplace", icon: LayoutGrid },
];

export function DeskShell() {
  const view = usePlayLiquid((s) => s.view);
  const navigate = usePlayLiquid((s) => s.navigate);
  const openSettings = usePlayLiquid((s) => s.openSettings);
  const tasks = useDeskTasks((s) => s.tasks);
  const hydrate = useDeskTasks((s) => s.hydrate);

  // server task list → sidebar task store (external-store sync, post-render)
  const { data: taskData } = useApi<{ tasks: TaskDTO[] }>("/api/tasks");
  const serverTasks = taskData?.tasks ?? null;
  useEffect(() => {
    if (!serverTasks) return;
    hydrate(
      serverTasks.map((t) => ({
        id: t.id,
        title: (t.gameTitle ?? t.prompt).slice(0, 34),
        time: timeAgo(t.createdAt),
        gameId: t.gameId,
        status: t.status,
      })),
    );
  }, [serverTasks, hydrate]);

  // Ctrl/Cmd+N opens the New Task workspace (design shortcut)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        navigate("newtask");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="desktop-shell" id="deskShell">
      <aside className="desk-sidebar">
        <div className="desk-sidebar-top">
          <button
            type="button"
            className="desk-brand"
            title="Back to PlayLiquid"
            onClick={() => navigate("home")}
          >
            <span className="drop-logo" aria-hidden />
            <span>PlayLiquid</span>
          </button>
        </div>

        <nav className="desk-nav" aria-label="Workspace">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = view === item.view;
            return (
              <button
                key={item.view}
                type="button"
                className={cn(active && "active")}
                aria-current={active ? "page" : undefined}
                onClick={() => navigate(item.view)}
              >
                <span className="desk-ico" aria-hidden>
                  <Icon className="size-4" strokeWidth={1.9} />
                </span>
                <span className="desk-label">{item.label}</span>
                {item.shortcut && <span className="desk-nav-shortcut">{item.shortcut}</span>}
              </button>
            );
          })}
        </nav>

        <div className="task-area">
          <div className="task-area-head">
            <span>Task list</span>
            <span aria-hidden>⌕　☰</span>
          </div>
          <h5>Projects</h5>
          <div className="task-entry">
            ▸ PlayLiquid <span className="task-time">⌄</span>
          </div>
          <h5>Tasks</h5>
          <div id="taskEntries">
            {tasks.map((t) =>
              t.gameId ? (
                <button
                  type="button"
                  className="task-entry clickable"
                  key={t.id}
                  title={`${t.title} — open in Game Builder`}
                  onClick={() => navigate("build", { gameId: t.gameId })}
                >
                  {t.title} <span className="task-time">{t.time}</span>
                </button>
              ) : (
                <div className="task-entry" key={t.id}>
                  {t.title} <span className="task-time">{t.time}</span>
                </div>
              ),
            )}
          </div>
        </div>

        <div className="desk-user">
          <span className="user-circle" aria-hidden>
            A
          </span>
          <span className="desk-user-label">Ali19</span>
          <button
            type="button"
            className="desk-action"
            style={{ marginLeft: "auto", padding: "5px 8px" }}
            title="Settings"
            aria-label="Open settings"
            onClick={openSettings}
          >
            <Settings className="size-[15px]" strokeWidth={1.9} />
          </button>
        </div>
      </aside>

      <main className="desk-content" id="deskMain">
        {view === "newtask" && <NewTaskView />}
        {view === "build" && <GameBuilderView />}
        {view === "automations" && <AutomationsView />}
        {view === "plugins" && <PluginsView />}
      </main>
    </div>
  );
}
