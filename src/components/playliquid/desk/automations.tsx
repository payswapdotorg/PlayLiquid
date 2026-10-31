"use client";

/**
 * Automations — recurring tasks and idle-time work, ported from the
 * Interface Reconstruction v2 design.
 */
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const TEMPLATES = [
  {
    icon: "◎",
    title: "Morning dev brief",
    body: "Summarize commits, module changes, CI status, and follow-ups since the previous workday, then produce notes.",
    schedule: "Every weekday at 09:00",
  },
  {
    icon: "∿",
    title: "Risk scan",
    body: "Inspect code changes from the last 24 hours for high-confidence risks involving runtime failures, data loss, security regressions and more.",
    schedule: "Daily at 10:00",
  },
  {
    icon: "▤",
    title: "Release brief",
    body: "Organize PRs and commits merged this week into Features, Fixes, Experience improvements, and Engineering.",
    schedule: "Weekly on Fri at 16:00",
  },
  {
    icon: "☷",
    title: "Documentation sync check",
    body: "Compare code, configuration, API, and documentation changes from the last seven days. Identify high-confidence drift.",
    schedule: "Weekly on Wed at 15:00",
  },
];

export function AutomationsView() {
  const [awake, setAwake] = useState(false);

  return (
    <section className="desk-inner" id="automationsView" aria-label="Automations">
      <div className="desk-title-row">
        <h1>Automations</h1>
        <span className="secondary-title">Workflows</span>
      </div>
      <p className="desk-subtitle">
        Schedule recurring tasks or queue background work that runs during idle time.
      </p>

      <div className="empty-schedule">
        <span>No scheduled tasks yet.</span>
        <button
          type="button"
          className="accent-select"
          id="createScheduled"
          onClick={() => toast("Scheduled task creation flow")}
        >
          Create scheduled task　⌄
        </button>
      </div>

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
          onClick={() => setAwake((a) => !a)}
        />
      </div>

      <div className="template-title">Scheduled task templates</div>
      <div className="template-grid">
        {TEMPLATES.map((t) => (
          <div className="template-card" key={t.title}>
            <h3>
              <span aria-hidden>{t.icon}</span> {t.title}
            </h3>
            <p>{t.body}</p>
            <small>{t.schedule}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
