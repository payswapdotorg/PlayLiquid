"use client";

/**
 * Settings window — ported from the Interface Reconstruction v2 design:
 * grouped menu (Basics / Agent capabilities / Data and statistics), the
 * General panel with its control rows, and window chrome controls.
 */
import { useState } from "react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { SettingsValues } from "@/lib/types";

const MENU: { group: string; items: { glyph: string; label: string }[] }[] = [
  {
    group: "Basics",
    items: [
      { glyph: "☷", label: "General" },
      { glyph: "◉", label: "Appearance" },
      { glyph: "⬡", label: "Model settings" },
      { glyph: "◎", label: "Browser Use" },
      { glyph: "▱", label: "Remote devices" },
      { glyph: "▣", label: "Computer Use" },
      { glyph: "▦", label: "Keyboard Shortcuts" },
    ],
  },
  {
    group: "Agent capabilities",
    items: [
      { glyph: "♙", label: "Personalization" },
      { glyph: "♧", label: "Memory" },
      { glyph: "♧", label: "Subagents" },
      { glyph: "▧", label: "Plugins" },
      { glyph: "◉", label: "MCP Servers" },
      { glyph: "✧", label: "Skills" },
      { glyph: "›_", label: "Commands" },
      { glyph: "⌘", label: "Hooks" },
    ],
  },
  {
    group: "Data and statistics",
    items: [
      { glyph: "▤", label: "Usage" },
      { glyph: "◷", label: "History" },
    ],
  },
];

/** Settings control state — booleans unwrapped from the server's "true"/"false" strings. */
interface Prefs {
  language: string;
  interfaceMode: string;
  proactive: boolean;
  inheritTerminal: boolean;
  terminalFont: string;
  terminalShell: string;
  restoreWorkspace: boolean;
}

const DEFAULT_PREFS: Prefs = {
  language: "System default",
  interfaceMode: "Coding mode",
  proactive: false,
  inheritTerminal: true,
  terminalFont: "",
  terminalShell: "Auto",
  restoreWorkspace: true,
};

/** Read a string preference; a missing key keeps the built-in default. */
function strPref(values: SettingsValues, key: string, fallback: string) {
  const raw: string | undefined = values[key];
  return raw === undefined ? fallback : raw;
}

/** Read a boolean preference ("true"/"false"); a missing key keeps the built-in default. */
function boolPref(values: SettingsValues, key: string, fallback: boolean) {
  const raw: string | undefined = values[key];
  return raw === undefined ? fallback : raw === "true";
}

export function SettingsShell() {
  const navigate = usePlayLiquid((s) => s.navigate);
  const { data } = useApi<{ values: SettingsValues }>("/api/settings");
  const [active, setActive] = useState("General");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);

  // server preferences arriving while mounted — applied at render-time (no effect setState);
  // the settings window remounts on every open, so hydrate once per open
  const [hydrated, setHydrated] = useState(false);
  if (!hydrated && data) {
    setHydrated(true);
    const v = data.values;
    setPrefs({
      language: strPref(v, "language", DEFAULT_PREFS.language),
      interfaceMode: strPref(v, "interface-mode", DEFAULT_PREFS.interfaceMode),
      proactive: boolPref(v, "proactive-tasks", DEFAULT_PREFS.proactive),
      inheritTerminal: boolPref(v, "inherit-terminal", DEFAULT_PREFS.inheritTerminal),
      terminalFont: strPref(v, "terminal-font", ""),
      terminalShell: strPref(v, "terminal-shell", DEFAULT_PREFS.terminalShell),
      restoreWorkspace: boolPref(v, "restore-workspace", DEFAULT_PREFS.restoreWorkspace),
    });
  }

  async function savePrefs() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            language: prefs.language,
            "interface-mode": prefs.interfaceMode,
            "proactive-tasks": String(prefs.proactive),
            "inherit-terminal": String(prefs.inheritTerminal),
            "terminal-font": prefs.terminalFont,
            "terminal-shell": prefs.terminalShell,
            "restore-workspace": String(prefs.restoreWorkspace),
          } satisfies SettingsValues,
        }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      toast.success("Settings saved");
    } catch {
      toast.error("Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-shell" id="settingsShell" aria-label="Settings">
      <aside className="settings-sidebar">
        <div className="settings-window-title">
          <span className="drop-logo" aria-hidden />
          <span className="settings-word" style={{ fontSize: 14, fontWeight: 800 }}>
            PlayLiquid
          </span>
        </div>
        <button
          type="button"
          className="back-workspace"
          id="backWorkspace"
          onClick={() => navigate("newtask")}
        >
          ‹　<span className="back-label">Back to workspace</span>
        </button>
        <div className="settings-menu">
          {MENU.map((g) => (
            <div key={g.group} className="settings-group-wrap">
              <div className="settings-group">{g.group}</div>
              {g.items.map((item) => (
                <button
                  key={g.group + item.label}
                  type="button"
                  className={cn(active === item.label && "active")}
                  aria-current={active === item.label ? "true" : undefined}
                  onClick={() => setActive(item.label)}
                >
                  <span aria-hidden>{item.glyph}</span>
                  <span className="settings-label">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <main className="settings-main">
        <div className="settings-top-controls" aria-hidden>
          <span>ⓘ</span>
          <span>–</span>
          <span>□</span>
          <button type="button" aria-label="Close settings" onClick={() => navigate("newtask")}>
            ×
          </button>
        </div>

        <div className="settings-inner">
          <h1 className="settings-title">{active}</h1>
          <span className="system-pill">System default</span>

          <div className="setting-card">
            <div className="setting-row">
              <div className="setting-text">
                <b>Language</b>
                <p>Choose the display language used by the application UI.</p>
              </div>
              <select
                className="setting-control"
                aria-label="Language"
                value={prefs.language}
                onChange={(e) => setPrefs((p) => ({ ...p, language: e.target.value }))}
              >
                <option>System default</option>
                <option>English</option>
                <option>French</option>
              </select>
            </div>
            <div className="setting-row">
              <div className="setting-text">
                <b>Interface mode</b>
                <p>
                  Office mode focuses on summaries and results. Coding mode shows commands, output,
                  and code changes.
                </p>
              </div>
              <select
                className="setting-control"
                aria-label="Interface mode"
                value={prefs.interfaceMode}
                onChange={(e) => setPrefs((p) => ({ ...p, interfaceMode: e.target.value }))}
              >
                <option>Coding mode</option>
                <option>Office mode</option>
              </select>
            </div>
            <div className="setting-row">
              <div className="setting-text">
                <b>Proactive task suggestions</b>
                <p>Available only in Office mode.</p>
              </div>
              <button
                type="button"
                className={cn("switch", prefs.proactive && "on")}
                aria-label="Proactive task suggestions"
                aria-pressed={prefs.proactive}
                onClick={() => setPrefs((p) => ({ ...p, proactive: !p.proactive }))}
              />
            </div>
          </div>

          <div className="setting-card">
            <div className="setting-row">
              <div className="setting-text">
                <b>Inherit system terminal profile</b>
                <p>
                  When launching the built-in terminal, inherit login shell environment, proxy,
                  Kubernetes variables, and local terminal font when possible.
                </p>
              </div>
              <button
                type="button"
                className={cn("switch", prefs.inheritTerminal && "on")}
                aria-label="Inherit system terminal profile"
                aria-pressed={prefs.inheritTerminal}
                onClick={() => setPrefs((p) => ({ ...p, inheritTerminal: !p.inheritTerminal }))}
              />
            </div>
            <div className="setting-row">
              <div className="setting-text">
                <b>Terminal font</b>
                <p>Leave blank to auto-detect system settings; set a value to override the terminal font.</p>
                <input
                  className="setting-control text"
                  placeholder="Leave blank to inherit, e.g. MesloLGS NF, monospace"
                  style={{ marginTop: 12 }}
                  aria-label="Terminal font"
                  value={prefs.terminalFont}
                  onChange={(e) => setPrefs((p) => ({ ...p, terminalFont: e.target.value }))}
                />
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-text">
                <b>Integrated terminal shell</b>
                <p>
                  Applies to new sessions only. On Windows, Bash uses this shell; Auto tries Git
                  Bash then cmd.exe.
                </p>
              </div>
              <select
                className="setting-control"
                aria-label="Integrated terminal shell"
                value={prefs.terminalShell}
                onChange={(e) => setPrefs((p) => ({ ...p, terminalShell: e.target.value }))}
              >
                <option>Auto</option>
                <option>PowerShell</option>
                <option>Command Prompt</option>
                <option>Git Bash</option>
              </select>
            </div>
            <button
              type="button"
              className="save-btn"
              disabled={saving}
              onClick={() => void savePrefs()}
            >
              Save
            </button>
          </div>

          <div className="setting-card">
            <div className="setting-row">
              <div className="setting-text">
                <b>Restore previous workspace</b>
                <p>Reopen the last workspace when the application starts.</p>
              </div>
              <button
                type="button"
                className={cn("switch", prefs.restoreWorkspace && "on")}
                aria-label="Restore previous workspace"
                aria-pressed={prefs.restoreWorkspace}
                onClick={() => setPrefs((p) => ({ ...p, restoreWorkspace: !p.restoreWorkspace }))}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
