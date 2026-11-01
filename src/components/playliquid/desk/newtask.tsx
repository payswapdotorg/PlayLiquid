"use client";

/**
 * New Task — the creator workspace center, ported from the Interface
 * Reconstruction v2 design: the composer (project/branch selectors, prompt,
 * context menu, execution mode, model + thought level), the idle banner,
 * task templates, and the exclusive Browser / Terminal side panels.
 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  MonitorSmartphone,
  MoreHorizontal,
  MousePointer2,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { usePlayLiquid } from "@/lib/store";
import { postJson, useApi } from "@/hooks/use-api";
import type { GameDTO, GameDetailDTO, GameTheme, StudioDTO } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDeskTasks } from "./desk-tasks";
import { GameEngine } from "../mini-games/game-engine";

const TEMPLATES: { icon: string; title: string; hint: string; template: string }[] = [
  {
    icon: "◷",
    title: "Standup Git Summary",
    hint: "A Friday summary of what happened this week.",
    template:
      "Prepare a standup Git summary for this project: summarize commits, code changes, CI status and follow-ups from the previous workday.",
  },
  {
    icon: "◷",
    title: "CI Failures & Flaky Test Report",
    hint: "A report on recent CI failures, flaky tests, and likely causes.",
    template:
      "Inspect recent CI failures and flaky tests in this project. Summarize the failures and likely root causes.",
  },
  {
    icon: "✧",
    title: "Customize",
    hint: "Skip the template and tell it directly what you want to do.",
    template:
      "Help me plan and implement the task I describe next. Start by asking the minimum clarifying questions.",
  },
];

const CONTEXT_ACTIONS: { token: string; label: string }[] = [
  { token: "attachment", label: "Add attachment" },
  { token: "@", label: "Insert @ file reference" },
  { token: "/", label: "Insert / command" },
  { token: "$", label: "Insert $ skill" },
  { token: "#", label: "Link related conversation" },
];

type TermLine =
  | { kind: "muted"; text: string }
  | { kind: "cmd"; cmd: string };

const TERM_SEED: TermLine[] = [
  { kind: "muted", text: "Windows PowerShell · Preview session" },
  { kind: "muted", text: "Project: PlayLiquid" },
  { kind: "cmd", cmd: "git status --short" },
  { kind: "muted", text: "Working tree preview · no local command is executed." },
];

export function NewTaskView() {
  // prefill handed over by the web Create menu (store)
  const taskPrefill = usePlayLiquid((s) => s.taskPrefill);
  const clearTaskPrefill = usePlayLiquid((s) => s.clearTaskPrefill);
  const navigate = usePlayLiquid((s) => s.navigate);

  // composer
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const [prompt, setPrompt] = useState(() => (taskPrefill ? taskPrefill : ""));
  const [project, setProject] = useState("PlayLiquid");
  const [branchVisible, setBranchVisible] = useState(true);
  const [execution, setExecution] = useState("Ask before changes");
  const [model, setModel] = useState("GLM-5.3");
  const [thought, setThought] = useState("Max");

  // prefill arriving while mounted — applied at render-time (no effect setState)
  const [prevPrefill, setPrevPrefill] = useState(taskPrefill);
  if (prevPrefill !== taskPrefill) {
    setPrevPrefill(taskPrefill);
    if (taskPrefill) setPrompt(taskPrefill);
  }
  useEffect(() => {
    // store action + DOM focus only
    if (taskPrefill) {
      clearTaskPrefill();
      setTimeout(() => promptRef.current?.focus(), 30);
    }
  }, [taskPrefill, clearTaskPrefill]);

  // chrome
  const [panel, setPanel] = useState<"browserPanel" | "terminalPanel" | "playtestPanel" | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(true);

  // task list
  const addTask = useDeskTasks((s) => s.addTask);

  // real submission — POST /api/tasks lets the Game Architect design a full
  // game spec (5–30 s), so the composer shows a running state meanwhile
  const [submitting, setSubmitting] = useState(false);

  // close the context popover on outside click
  useEffect(() => {
    if (!contextOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest?.("#contextPopover,#contextAdd")) {
        setContextOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [contextOpen]);

  async function submitTask() {
    const text = prompt.trim();
    if (!text) {
      toast("Describe what you want PlayLiquid to do first");
      promptRef.current?.focus();
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await postJson<{
        task: { id: string; status: string };
        game: GameDTO;
        modelUsed: string;
        usedFallback: boolean;
      }>("/api/tasks", { prompt: text, model, mode: execution });
      addTask({
        id: res.task.id,
        title: res.game.title,
        time: "now",
        gameId: res.game.id,
        status: res.game.status,
      });
      setPrompt("");
      toast.success(
        `"${res.game.title}" is ready — a ${res.game.category.toLowerCase()} on the ${res.game.engine} engine`,
        {
          action: {
            label: "Open builder",
            onClick: () => navigate("build", { gameId: res.game.id }),
          },
        },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The task could not be started");
      promptRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  function onProjectChange(value: string) {
    if (value === "NewProject") {
      setProject("PlayLiquid");
      setBranchVisible(true);
      toast("Select or create project menu preview");
    } else {
      setProject(value);
      setBranchVisible(value !== "none");
    }
  }

  function onContextAction(token: string) {
    if (token === "attachment") {
      toast("Attachment picker opened");
    } else {
      setPrompt((p) => (p ? `${p} ` : "") + token);
      promptRef.current?.focus();
    }
    setContextOpen(false);
  }

  return (
    <section className="newtask-view" data-panel={panel ?? undefined} id="newTaskView" aria-label="New task">
      <button
        type="button"
        className="newtask-back"
        id="backToApp"
        title="Back to PlayLiquid"
        onClick={() => navigate("home", { gameId: null, sparkIndex: 0 })}
      >
        ‹　<span className="back-label">Back to PlayLiquid</span>
      </button>

      <div className="newtask-top-tools">
        <button
          type="button"
          className={cn("newtask-tool", panel === "playtestPanel" && "active")}
          id="togglePlaytest"
          aria-label="Toggle playtest panel"
          aria-pressed={panel === "playtestPanel"}
          title="Toggle live playtest"
          onClick={() => setPanel((p) => (p === "playtestPanel" ? null : "playtestPanel"))}
        >
          <span aria-hidden>▶</span>
          <span className="tool-name">Playtest</span>
        </button>
        <button
          type="button"
          className={cn("newtask-tool", panel === "browserPanel" && "active")}
          id="toggleBrowser"
          aria-label="Toggle browser panel"
          aria-pressed={panel === "browserPanel"}
          title="Toggle browser"
          onClick={() => setPanel((p) => (p === "browserPanel" ? null : "browserPanel"))}
        >
          <span aria-hidden>▣</span>
          <span className="tool-name">Browser</span>
        </button>
        <button
          type="button"
          className={cn("newtask-tool", panel === "terminalPanel" && "active")}
          id="toggleTerminal"
          aria-label="Toggle terminal panel"
          aria-pressed={panel === "terminalPanel"}
          title="Toggle terminal"
          onClick={() => setPanel((p) => (p === "terminalPanel" ? null : "terminalPanel"))}
        >
          <span aria-hidden>&gt;_</span>
          <span className="tool-name">Terminal</span>
        </button>
      </div>

      <div className="newtask-center">
        <div className="kicker" style={{ textAlign: "center", marginBottom: 12 }}>
          Your creative workspace
        </div>
        <h1 className="newtask-greeting">Noon break?</h1>

        <div className="newtask-composer">
          <div className="composer-project-row">
            <span aria-hidden>▱</span>
            <select
              className="composer-select"
              id="projectSelect"
              aria-label="Select project"
              value={project}
              onChange={(e) => onProjectChange(e.target.value)}
            >
              <option value="PlayLiquid">PlayLiquid</option>
              <option value="none">Work outside a project</option>
              <option value="NewProject">＋ Select or create project</option>
            </select>
            {branchVisible && (
              <span className="composer-branch" id="branchGroup">
                ⑂{" "}
                <select
                  className="composer-select"
                  id="branchSelect"
                  aria-label="Select branch"
                  defaultValue="main"
                >
                  <option>main</option>
                  <option>develop</option>
                  <option>feature/new-world</option>
                </select>
              </span>
            )}
          </div>

          <textarea
            ref={promptRef}
            className="task-prompt"
            id="taskPrompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void submitTask();
              }
            }}
            placeholder="Ask PlayLiquid anything, @ for files, folders, or whiteboards, / for commands or agents, $ for skills, # for related conversations"
            aria-label="Task prompt"
          />

          <div className="composer-footer">
            <div className="composer-footer-left">
              <button
                type="button"
                className="composer-icon"
                id="contextAdd"
                aria-label="Add context"
                title="Add context"
                onClick={() => setContextOpen((o) => !o)}
              >
                <Plus className="size-[13px]" strokeWidth={2.2} />
              </button>
              <select
                className="execution-select"
                id="executionMode"
                aria-label="Execution mode"
                value={execution}
                onChange={(e) => setExecution(e.target.value)}
              >
                <option>Ask before changes</option>
                <option>Plan mode</option>
                <option>Edit automatically</option>
                <option>Full access</option>
              </select>
            </div>
            <div className="composer-footer-right">
              <select
                className="model-select"
                id="modelSelect"
                aria-label="Model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                <option>GLM-5.3</option>
                <option>Claude Sonnet</option>
                <option>GPT</option>
                <option>Gemini</option>
              </select>
              <span className="thought-icon" title="Reasoning effort" aria-hidden>
                ♧
              </span>
              <select
                className="model-select"
                aria-label="Thought level"
                value={thought}
                onChange={(e) => setThought(e.target.value)}
              >
                <option>Max</option>
                <option>High</option>
                <option>Low</option>
              </select>
              <button
                type="button"
                className="send-task"
                id="sendTask"
                aria-label="Start task"
                title={submitting ? "Designing your game…" : "Start task"}
                aria-busy={submitting}
                disabled={submitting}
                style={submitting ? { opacity: 0.55, cursor: "default", transform: "none" } : undefined}
                onClick={() => void submitTask()}
              >
                <ArrowUp className="size-[14px]" strokeWidth={2.4} />
              </button>
            </div>
          </div>
        </div>

        {submitting ? (
          <div className="newtask-banner" role="status" aria-live="polite">
            <span className="banner-icon" aria-hidden>
              ◷
            </span>
            <span>
              Game Architect is designing your game — usually under 30 s…
            </span>
          </div>
        ) : (
          bannerVisible && (
            <div className="newtask-banner" id="idleBanner">
              <span className="banner-icon" aria-hidden>
                ⚑
              </span>
              <span>
                New for subscribers: Create an idle-time task. We&apos;ll complete assigned work
                during periods of surplus computing power.
              </span>
              <button
                type="button"
                id="dismissIdle"
                aria-label="Dismiss banner"
                onClick={() => setBannerVisible(false)}
              >
                ×
              </button>
            </div>
          )
        )}

        <div className="task-template-grid">
          {TEMPLATES.map((t) => (
            <button
              key={t.title}
              type="button"
              className="task-template"
              onClick={() => {
                setPrompt(t.template);
                promptRef.current?.focus();
              }}
            >
              <b>
                <span className="template-icon" aria-hidden>
                  {t.icon}
                </span>
                {t.title}
              </b>
              <span>{t.hint}</span>
            </button>
          ))}
        </div>

        <p className="project-dropdown-note">
          Start with a project for repository-aware work, or choose Work outside a project for
          anything else.
        </p>
      </div>

      {contextOpen && (
        <div className="popover" id="contextPopover" style={{ left: 20, bottom: 100 }} role="menu">
          {CONTEXT_ACTIONS.map((a) => (
            <button key={a.token} type="button" role="menuitem" onClick={() => onContextAction(a.token)}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {panel === "browserPanel" && <BrowserPanel onClose={() => setPanel(null)} />}
      {panel === "terminalPanel" && <TerminalPanel onClose={() => setPanel(null)} />}
      {panel === "playtestPanel" && <PlaytestPanel onClose={() => setPanel(null)} />}
    </section>
  );
}

function BrowserPanel({ onClose }: { onClose: () => void }) {
  const [address, setAddress] = useState("");
  const [tabTitle, setTabTitle] = useState("New tab");
  const [status, setStatus] = useState("Ready · No page loaded");
  const [target, setTarget] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  function navigateBrowser() {
    let value = address.trim();
    if (!value) {
      toast("Enter a URL or search term");
      return;
    }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
    setAddress(value);
    setTabTitle(value.replace(/^https?:\/\//, "").slice(0, 32));
    setStatus(`Navigation requested · ${value}`);
    setTarget(value);
    toast("Browser target updated");
  }

  return (
    <aside className="task-side-panel" id="browserPanel" aria-label="Browser panel">
      <div className="side-pane-titlebar">
        <span className="side-pane-app-icon" aria-hidden>
          ◎
        </span>
        <span className="side-pane-title">Browser</span>
        <span className="side-pane-subtitle" id="browserTabTitle">
          {tabTitle}
        </span>
        <span className="side-pane-spacer" />
        <button
          type="button"
          title="New browser tab"
          aria-label="New browser tab"
          onClick={() => toast("New browser tab created")}
        >
          <Plus className="size-[15px]" strokeWidth={2} />
        </button>
        <button
          type="button"
          data-close-panel="browserPanel"
          aria-label="Close browser panel"
          title="Close"
          onClick={onClose}
        >
          <X className="size-[15px]" strokeWidth={2.2} />
        </button>
      </div>

      <div className="browser-toolbar">
        <button
          type="button"
          className="browser-icon-button"
          title="Back"
          onClick={() => toast("No previous page")}
        >
          <ChevronLeft className="size-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="browser-icon-button"
          title="Forward"
          onClick={() => toast("No next page")}
        >
          <ChevronRight className="size-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="browser-icon-button"
          title="Reload"
          onClick={() => toast("Browser refreshed")}
        >
          <RotateCw className="size-4" strokeWidth={2} />
        </button>
        <input
          className="browser-address"
          id="browserAddress"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigateBrowser();
          }}
          placeholder="Search or enter address"
          aria-label="Browser address"
        />
        <button
          type="button"
          className="browser-icon-button"
          title="Responsive view"
          onClick={() => toast("Responsive viewport selected")}
        >
          <MonitorSmartphone className="size-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="browser-icon-button"
          title="Select element"
          onClick={() => toast("Element picker selected")}
        >
          <MousePointer2 className="size-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="browser-icon-button"
          id="browserMoreButton"
          title="More browser actions"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <MoreHorizontal className="size-4" strokeWidth={2} />
        </button>
      </div>

      {moreOpen && (
        <div className="browser-more-menu" id="browserMoreMenu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMoreOpen(false);
              toast("Open in external browser");
            }}
          >
            Open in external browser
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMoreOpen(false);
              toast("Developer tools selected");
            }}
          >
            Developer tools
          </button>
        </div>
      )}

      <div className="browser-viewport" id="browserViewport">
        {target === null ? (
          <div className="browser-empty">
            <div className="browser-empty-icon" aria-hidden>
              ◎
            </div>
            <h3>Browser</h3>
            <p>
              Navigate to a page to preview it here. The PlayLiquid agent can inspect pages,
              interact with controls and verify the running world.
            </p>
          </div>
        ) : (
          <div className="browser-empty">
            <div className="browser-empty-icon" aria-hidden>
              <ArrowUpRight className="size-6" strokeWidth={1.6} />
            </div>
            <h3>Preview target selected</h3>
            <p>{target}</p>
            <p style={{ marginTop: 8 }}>
              The browser chrome is a preview — it does not embed or navigate a live webview.
            </p>
          </div>
        )}
      </div>
      <div className="browser-statusbar" id="browserStatus">
        {status}
      </div>
    </aside>
  );
}

function TerminalPanel({ onClose }: { onClose: () => void }) {
  const [tabs, setTabs] = useState<string[]>(["PlayLiquid"]);
  const [active, setActive] = useState(0);
  const [lines, setLines] = useState<TermLine[]>(TERM_SEED);
  const [command, setCommand] = useState("");
  const consoleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  function newTab() {
    setTabs((t) => [...t, `Terminal ${t.length + 1}`]);
    setActive(tabs.length);
    toast("New terminal tab created");
  }

  function runCommand() {
    const value = command.trim();
    if (!value) return;
    setLines((l) => [...l, { kind: "cmd", cmd: value }, { kind: "muted", text: "Preview only · command not executed" }]);
    setCommand("");
  }

  return (
    <aside className="task-side-panel terminal-pane" id="terminalPanel" aria-label="Terminal panel">
      <div className="terminal-header">
        <span className="terminal-header-title">Terminal</span>
        <span className="terminal-shell-label" id="terminalShellLabel">
          PowerShell
        </span>
        <div className="terminal-header-actions">
          <button type="button" title="New terminal" aria-label="New terminal" onClick={newTab}>
            <Plus className="size-[15px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            data-close-panel="terminalPanel"
            aria-label="Close terminal panel"
            title="Close"
            onClick={onClose}
          >
            <X className="size-[15px]" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <div className="terminal-tabs">
        {tabs.map((name, i) => (
          <button
            key={name + i}
            type="button"
            className={cn("terminal-tab", i === active && "active")}
            onClick={() => {
              setActive(i);
              if (i !== active) toast("Terminal tab selected");
            }}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="terminal-console" id="terminalConsole" ref={consoleRef}>
        {lines.map((line, i) =>
          line.kind === "muted" ? (
            <div className="terminal-line muted" key={i}>
              {line.text}
            </div>
          ) : (
            <div className="terminal-line" key={i}>
              <span className="terminal-prompt">PS C:\PlayLiquid&gt;</span>{" "}
              <span className="terminal-command">{line.cmd}</span>
            </div>
          ),
        )}
        <div className="terminal-line">
          <span className="terminal-prompt">PS C:\PlayLiquid&gt;</span> <span aria-hidden>_</span>
        </div>
      </div>

      <div className="terminal-input-row">
        <span aria-hidden>PS&gt;</span>
        <input
          id="terminalCommand"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runCommand();
          }}
          placeholder="Type a command (visual preview only)"
          aria-label="Terminal command"
        />
        <button type="button" id="runCommand" onClick={runCommand}>
          Run
        </button>
      </div>
    </aside>
  );
}

/**
 * PlaytestPanel — the live playtest canvas, raised to the same level as the
 * Browser and Terminal side panels: pick any of your builds (drafts included,
 * from GET /api/studio) and play it right inside the New Task workspace via
 * the shared GameEngine. Manual Play mode, Auto demo mode and Restart mirror
 * the Game Builder's playtest controls.
 */
function PlaytestPanel({ onClose }: { onClose: () => void }) {
  const navigate = usePlayLiquid((s) => s.navigate);
  const { data: studioData, loading } = useApi<StudioDTO>("/api/studio");
  const games = studioData?.myGames ?? [];

  // selected build — defaults to the most recent one (list is recency-sorted)
  const [gameId, setGameId] = useState<string | null>(null);
  const [pickedFor, setPickedFor] = useState<GameDTO[] | null>(null);
  if (games.length > 0 && pickedFor !== games) {
    setPickedFor(games);
    if (!games.some((g) => g.id === gameId)) setGameId(games[0].id);
  }

  const { data: detail } = useApi<{ game: GameDetailDTO }>(gameId ? `/api/games/${gameId}` : null);
  const game = detail?.game ?? null;

  const [mode, setMode] = useState<"play" | "auto">("play");
  const [restartKey, setRestartKey] = useState(0);

  // restart when switching builds so the canvas never shows the previous game
  const [engineFor, setEngineFor] = useState<string | null>(null);
  if (game && engineFor !== game.id) {
    setEngineFor(game.id);
    setRestartKey((k) => k + 1);
  }

  const theme: GameTheme = game?.theme ?? {
    palette: { bg: [10, 6, 24], accent: [0, 229, 255], accent2: [138, 125, 255], ball: [240, 248, 255], platform: [122, 110, 150] },
    speed: 1,
    difficulty: 1,
    label: "Default",
  };

  return (
    <aside className="task-side-panel playtest-pane" id="playtestPanel" aria-label="Playtest panel">
      <div className="side-pane-titlebar">
        <span className="side-pane-app-icon" aria-hidden>
          ▶
        </span>
        <span className="side-pane-title">Playtest</span>
        <span className="side-pane-subtitle" id="playtestGameTitle">
          {game ? game.title : "No build"}
        </span>
        <span className="side-pane-spacer" />
        <button
          type="button"
          title="Open in Game Builder"
          aria-label="Open in Game Builder"
          disabled={!gameId}
          onClick={() => gameId && navigate("build", { gameId })}
        >
          <ArrowUpRight className="size-[15px]" strokeWidth={2} />
        </button>
        <button
          type="button"
          data-close-panel="playtestPanel"
          aria-label="Close playtest panel"
          title="Close"
          onClick={onClose}
        >
          <X className="size-[15px]" strokeWidth={2.2} />
        </button>
      </div>

      <div className="playtest-toolbar">
        <select
          className="composer-select"
          aria-label="Select a build to playtest"
          value={gameId ?? ""}
          onChange={(e) => setGameId(e.target.value || null)}
        >
          {games.length === 0 && <option value="">No builds yet</option>}
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
              {g.status === "draft" ? " (draft)" : ""}
            </option>
          ))}
        </select>
        <span className="playtest-mode">
          <button
            type="button"
            className={cn("gb-mode", mode === "play" && "active")}
            aria-pressed={mode === "play"}
            onClick={() => setMode("play")}
          >
            Play
          </button>
          <button
            type="button"
            className={cn("gb-mode", mode === "auto" && "active")}
            aria-pressed={mode === "auto"}
            onClick={() => setMode("auto")}
          >
            Auto
          </button>
          <button
            type="button"
            className="gb-mode"
            aria-label="Restart playtest"
            onClick={() => setRestartKey((k) => k + 1)}
          >
            <RotateCw className="size-[12px]" strokeWidth={2.2} />
          </button>
        </span>
      </div>

      <div className="playtest-viewport" id="playtestViewport">
        {loading ? (
          <div className="browser-empty">
            <div className="browser-empty-icon" aria-hidden>
              ◷
            </div>
            <h3>Loading builds…</h3>
          </div>
        ) : games.length === 0 ? (
          <div className="browser-empty">
            <div className="browser-empty-icon" aria-hidden>
              ▶
            </div>
            <h3>No builds yet</h3>
            <p>
              Submit a task below — the Game Architect will design a playable draft you can test
              right here.
            </p>
          </div>
        ) : !game ? (
          <div className="browser-empty">
            <div className="browser-empty-icon" aria-hidden>
              ◷
            </div>
            <h3>Loading build…</h3>
          </div>
        ) : (
          <div className="playtest-canvas">
            <GameEngine
              engine={game.engine}
              theme={theme}
              restartKey={restartKey}
              auto={mode === "auto"}
            />
          </div>
        )}
      </div>

      <div className="browser-statusbar" id="playtestStatus">
        {game
          ? `Live playtest · ${game.engine} engine · v${game.version} · ${game.status}`
          : "Pick one of your builds to play it here"}
      </div>
    </aside>
  );
}
