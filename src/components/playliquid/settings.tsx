"use client";

/**
 * Settings window — ported from the Interface Reconstruction v2 design:
 * grouped menu (Basics / Agent capabilities / Data and statistics), the
 * General panel with its control rows, and window chrome controls.
 */
import { useState } from "react";
import { toast } from "sonner";
import { usePlayLiquid } from "@/lib/store";
import { cn } from "@/lib/utils";

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

export function SettingsShell() {
  const navigate = usePlayLiquid((s) => s.navigate);
  const [active, setActive] = useState("General");
  const [sw, setSw] = useState<Record<string, boolean>>({
    proactive: false,
    inheritTerminal: true,
    restoreWorkspace: true,
  });

  const toggle = (key: string) => setSw((s) => ({ ...s, [key]: !s[key] }));

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
              <select className="setting-control" aria-label="Language" defaultValue="System default">
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
              <select className="setting-control" aria-label="Interface mode" defaultValue="Coding mode">
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
                className={cn("switch", sw.proactive && "on")}
                aria-label="Proactive task suggestions"
                aria-pressed={sw.proactive}
                onClick={() => toggle("proactive")}
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
                className={cn("switch", sw.inheritTerminal && "on")}
                aria-label="Inherit system terminal profile"
                aria-pressed={sw.inheritTerminal}
                onClick={() => toggle("inheritTerminal")}
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
              <select className="setting-control" aria-label="Integrated terminal shell" defaultValue="Auto">
                <option>Auto</option>
                <option>PowerShell</option>
                <option>Command Prompt</option>
                <option>Git Bash</option>
              </select>
            </div>
            <button type="button" className="save-btn" onClick={() => toast("Settings saved")}>
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
                className={cn("switch", sw.restoreWorkspace && "on")}
                aria-label="Restore previous workspace"
                aria-pressed={sw.restoreWorkspace}
                onClick={() => toggle("restoreWorkspace")}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
