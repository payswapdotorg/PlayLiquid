"use client";

/**
 * Automations — recurring tasks and idle-time work, ported from the
 * Interface Reconstruction v2 design. Full CRUD against /api/automations:
 * create (form or template prefill), enable/disable, "Run now" (fires the
 * real task pipeline with mode "Automation") and delete. The keep-awake
 * toggle persists through /api/settings.
 */
import { useState } from "react";
import { toast } from "sonner";
import { useApi, postJson } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AutomationDTO, GameDTO } from "@/lib/types";
import { DeskBackButton } from "./desk-back";

const SCHEDULES = [
  "Weekdays at 09:00",
  "Daily at 10:00",
  "Weekly on Friday at 16:00",
  "Weekly on Wednesday at 15:00",
  "Manual",
];

const TEMPLATES = [
  {
    icon: "◎",
    title: "Morning dev brief",
    body: "Summarize commits, module changes, CI status, and follow-ups since the previous workday, then produce notes.",
    schedule: "Weekdays at 09:00",
    prompt:
      "Prepare the morning dev brief: summarize commits, module changes, CI status and follow-ups since the previous workday, then produce concise notes.",
  },
  {
    icon: "∿",
    title: "Risk scan",
    body: "Inspect code changes from the last 24 hours for high-confidence risks involving runtime failures, data loss, security regressions and more.",
    schedule: "Daily at 10:00",
    prompt:
      "Inspect code changes from the last 24 hours for high-confidence risks involving runtime failures, data loss and security regressions. Summarize the findings and likely root causes.",
  },
  {
    icon: "▤",
    title: "Release brief",
    body: "Organize PRs and commits merged this week into Features, Fixes, Experience improvements, and Engineering.",
    schedule: "Weekly on Friday at 16:00",
    prompt:
      "Organize the PRs and commits merged this week into Features, Fixes, Experience improvements and Engineering sections, and draft the release brief.",
  },
  {
    icon: "☷",
    title: "Documentation sync check",
    body: "Compare code, configuration, API, and documentation changes from the last seven days. Identify high-confidence drift.",
    schedule: "Weekly on Wednesday at 15:00",
    prompt:
      "Compare code, configuration, API and documentation changes from the last seven days and identify high-confidence drift between the docs and the implementation.",
  },
];

/** JSON request helper for the non-POST verbs (postJson only issues POST). */
async function sendJson<T>(
  url: string,
  method: "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export function AutomationsView() {
  const navigate = usePlayLiquid((s) => s.navigate);
  const {
    data: autoData,
    loading,
    reload,
  } = useApi<{ automations: AutomationDTO[] }>("/api/automations");
  const { data: settingsData } = useApi<{ values: Record<string, string> }>("/api/settings");

  const list = autoData?.automations ?? [];

  // keep-awake preference — hydrate from the server via render-time sync
  const [awake, setAwake] = useState(false);
  const [awakeFor, setAwakeFor] = useState<Record<string, string> | null>(null);
  const serverValues = settingsData?.values ?? null;
  if (serverValues && awakeFor !== serverValues) {
    setAwakeFor(serverValues);
    setAwake(serverValues["keep-awake"] === "true");
  }

  // create form
  const [formOpen, setFormOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formSchedule, setFormSchedule] = useState(SCHEDULES[0]);
  const [formPrompt, setFormPrompt] = useState("");
  const [creating, setCreating] = useState(false);

  // "Run now" in-flight marker
  const [runningId, setRunningId] = useState<string | null>(null);

  function openBlankForm() {
    setFormName("");
    setFormSchedule(SCHEDULES[0]);
    setFormPrompt("");
    setFormOpen(true);
  }

  function openTemplateForm(t: (typeof TEMPLATES)[number]) {
    setFormName(t.title);
    setFormSchedule(t.schedule);
    setFormPrompt(t.prompt);
    setFormOpen(true);
  }

  async function createAutomation() {
    const name = formName.trim();
    const prompt = formPrompt.trim();
    if (!name || !prompt) {
      toast.error("Name and prompt are required");
      return;
    }
    if (creating) return;
    setCreating(true);
    try {
      await postJson("/api/automations", { name, prompt, schedule: formSchedule });
      setFormOpen(false);
      await reload();
      toast.success("Automation created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the automation");
    } finally {
      setCreating(false);
    }
  }

  async function toggleAutomation(a: AutomationDTO) {
    try {
      await sendJson(`/api/automations/${a.id}`, "PATCH", { enabled: !a.enabled });
      await reload();
    } catch {
      toast.error("Could not update the automation");
    }
  }

  async function runAutomation(a: AutomationDTO) {
    if (runningId) return;
    setRunningId(a.id);
    try {
      const res = await postJson<{
        task: { id: string; status: string };
        game: GameDTO;
        modelUsed: string;
        usedFallback: boolean;
      }>("/api/tasks", { prompt: a.prompt, mode: "Automation" });
      await sendJson(`/api/automations/${a.id}`, "PATCH", { markRun: true });
      await reload();
      toast.success(`"${res.game.title}" is ready`, {
        action: {
          label: "Open builder",
          onClick: () => navigate("build", { gameId: res.game.id }),
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The automation run failed");
    } finally {
      setRunningId(null);
    }
  }

  async function deleteAutomation(a: AutomationDTO) {
    try {
      await sendJson(`/api/automations/${a.id}`, "DELETE");
      await reload();
      toast("Automation removed");
    } catch {
      toast.error("Could not delete the automation");
    }
  }

  async function toggleAwake() {
    const next = !awake;
    setAwake(next);
    try {
      await sendJson("/api/settings", "PUT", { values: { "keep-awake": String(next) } });
      toast("Setting saved");
    } catch {
      setAwake(!next);
      toast.error("Could not save the setting");
    }
  }

  return (
    <section className="desk-inner automations-view" id="automationsView" aria-label="Automations">
      <DeskBackButton />
      <div className="desk-title-row">
        <h1>Automations</h1>
        <span className="secondary-title">Workflows</span>
      </div>
      <p className="desk-subtitle">
        Schedule recurring tasks or queue background work that runs during idle time.
      </p>

      {list.length > 0 && !formOpen && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
          <button
            type="button"
            className="accent-select"
            id="createScheduled"
            onClick={openBlankForm}
          >
            Create scheduled task　⌄
          </button>
        </div>
      )}

      {formOpen && (
        <div className="auto-form" id="automationForm">
          <div>
            <label htmlFor="autoName">Name</label>
            <input
              id="autoName"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Morning dev brief"
              aria-label="Automation name"
              maxLength={80}
            />
          </div>
          <div>
            <label htmlFor="autoSchedule">Schedule</label>
            <select
              id="autoSchedule"
              value={formSchedule}
              onChange={(e) => setFormSchedule(e.target.value)}
              aria-label="Automation schedule"
            >
              {SCHEDULES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="full">
            <label htmlFor="autoPrompt">Prompt</label>
            <textarea
              id="autoPrompt"
              value={formPrompt}
              onChange={(e) => setFormPrompt(e.target.value)}
              placeholder="What should PlayLiquid do on this schedule?"
              aria-label="Automation prompt"
              maxLength={2000}
            />
          </div>
          <div className="auto-actions">
            <button
              type="button"
              className="desk-action"
              onClick={() => setFormOpen(false)}
              disabled={creating}
            >
              Cancel
            </button>
            <button
              type="button"
              className="desk-action light"
              onClick={() => void createAutomation()}
              disabled={creating}
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      )}

      {!loading && list.length === 0 && !formOpen && (
        <div className="empty-schedule">
          <span>No scheduled tasks yet.</span>
          <button
            type="button"
            className="accent-select"
            id="createScheduled"
            onClick={openBlankForm}
          >
            Create scheduled task　⌄
          </button>
        </div>
      )}

      {list.length > 0 && (
        <div id="automationList">
          {list.map((a) => (
            <div className="auto-row" key={a.id}>
              <div className="info">
                <b>{a.name}</b>
                <span className="sched">{a.schedule}</span>
                <span className="prompt">{a.prompt}</span>
                <span className="ran">
                  {a.lastRunAt ? `Last run ${timeAgo(a.lastRunAt)}` : "Never run"}
                </span>
              </div>
              <button
                type="button"
                className={cn("switch", a.enabled && "on")}
                aria-label={`${a.enabled ? "Disable" : "Enable"} ${a.name}`}
                aria-pressed={a.enabled}
                onClick={() => void toggleAutomation(a)}
              />
              <button
                type="button"
                className="auto-icon-btn"
                disabled={runningId !== null}
                onClick={() => void runAutomation(a)}
              >
                {runningId === a.id ? "Running…" : "Run now"}
              </button>
              <button
                type="button"
                className="auto-icon-btn danger"
                aria-label={`Delete ${a.name}`}
                title="Delete automation"
                disabled={runningId === a.id}
                onClick={() => void deleteAutomation(a)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="awake-bar">
        <span style={{ fontSize: 16 }} aria-hidden>
          ⓘ
        </span>
        <span>Keep your computer awake while PlayLiquid is running a task.</span>
        <button
          type="button"
          className={cn("switch", awake && "on")}
          aria-label="Keep computer awake"
          aria-pressed={awake}
          style={{ marginLeft: "auto" }}
          onClick={() => void toggleAwake()}
        />
      </div>

      <div className="template-title">Scheduled task templates</div>
      <div className="template-grid">
        {TEMPLATES.map((t) => (
          <button
            type="button"
            className="template-card"
            key={t.title}
            title={`Create the "${t.title}" automation`}
            style={{ textAlign: "left", font: "inherit", cursor: "pointer", width: "100%" }}
            onClick={() => openTemplateForm(t)}
          >
            <h3>
              <span aria-hidden>{t.icon}</span> {t.title}
            </h3>
            <p>{t.body}</p>
            <small>{t.schedule}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
