"use client";

/**
 * Plugin Marketplace — ported from the Interface Reconstruction v2 design:
 * market tools, Public/Community/Personal tabs, live search and the
 * App plugins / Developer Tools sections with install toggles.
 */
import { useState } from "react";
import { ChevronDown, House, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type PluginKind = "switch" | "install";

interface PluginItem {
  name: string;
  glyph: string;
  glyphClass?: string; // orange | green | blue | teal | pink | dark
  desc: string;
  kind: PluginKind;
  enabled?: boolean;
}

const APP_PLUGINS: PluginItem[] = [
  { name: "PDF", glyph: "PDF", desc: "PDF production skills and a PDF viewer pane...", kind: "switch", enabled: true },
  { name: "Presentations", glyph: "▣", glyphClass: "orange", desc: "PPTX presentation production skills and a PowerPoint viewer...", kind: "switch", enabled: true },
  { name: "Spreadsheets", glyph: "▦", glyphClass: "green", desc: "XLSX spreadsheet production skills and an Excel viewer...", kind: "switch", enabled: true },
  { name: "Documents", glyph: "▤", glyphClass: "blue", desc: "DOCX document production skills and a Word viewer...", kind: "switch", enabled: true },
  { name: "Jupyter Notebook", glyph: "▧", glyphClass: "orange", desc: "Work on Jupyter notebooks in a side panel: code, data and charts...", kind: "install" },
  { name: "Typst Workbench", glyph: "T", glyphClass: "teal", desc: "Live-preview Typst documents in a side panel...", kind: "install" },
  { name: "Zotero", glyph: "❝", glyphClass: "pink", desc: "Work with your Zotero library in a side panel...", kind: "install" },
  { name: "PlayLiquid Sites", glyph: "▧", glyphClass: "blue", desc: "Publish new or throwaway web projects to PlayLiquid Sites...", kind: "switch", enabled: true },
];

const DEV_PLUGINS: PluginItem[] = [
  { name: "GitHub", glyph: "◉", glyphClass: "dark", desc: "GitHub CLI workflows for commits, pull requests...", kind: "install" },
  { name: "GitLab", glyph: "◢", glyphClass: "orange", desc: "GitLab CLI workflows based on GitLab's official...", kind: "install" },
  { name: "Alibaba Cloud CLI", glyph: "⌘", glyphClass: "orange", desc: "Alibaba Cloud CLI workflows for credential setup...", kind: "install" },
  { name: "Cloudbase Skills", glyph: "◈", glyphClass: "blue", desc: "CloudBase development skills and MCP integrations...", kind: "install" },
  { name: "Code Security Protection", glyph: "⬡", glyphClass: "pink", desc: "Security checks and code review workflow...", kind: "install" },
  { name: "Android Emulator", glyph: "◉", glyphClass: "green", desc: "Launch and test Android applications...", kind: "switch", enabled: false },
];

export function PluginsView() {
  const [tab, setTab] = useState("Public");
  const [query, setQuery] = useState("");
  const [appCollapsed, setAppCollapsed] = useState(false);
  const [states, setStates] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const p of [...APP_PLUGINS, ...DEV_PLUGINS]) {
      initial[p.name] = p.kind === "switch" ? !!p.enabled : false;
    }
    return initial;
  });

  function setPluginState(name: string, kind: PluginKind, next: boolean) {
    setStates((s) => ({ ...s, [name]: next }));
    if (kind === "install") toast(next ? "Plugin installed" : "Plugin removed");
  }

  const q = query.trim().toLowerCase();
  const matches = (p: PluginItem) => !q || `${p.name} ${p.desc}`.toLowerCase().includes(q);

  return (
    <section className="market-content" id="pluginsView" aria-label="Plugin Marketplace">
      <div className="market-head">
        <h1>Plugin Marketplace</h1>
        <div className="market-tools">
          <button
            type="button"
            className="desk-action"
            aria-label="Refresh marketplace"
            title="Refresh"
            onClick={() => toast("Marketplace refreshed")}
          >
            <RefreshCw className="size-[15px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            className="desk-action"
            aria-label="Plugin home"
            title="Plugin home"
            onClick={() => toast("Plugin home")}
          >
            <House className="size-[15px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            className="desk-action"
            id="addPlugin"
            onClick={() => toast("Add plugin menu")}
          >
            Add　<ChevronDown className="inline size-[13px]" strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="desk-action light"
            onClick={() => toast("Plugin management opened")}
          >
            Manage plugins
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div className="market-tabs" role="tablist" aria-label="Plugin tabs">
          {["Public", "Community", "Personal"].map((t) => (
            <button
              key={t}
              type="button"
              className={cn(tab === t && "active")}
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          className="market-search"
          id="pluginSearch"
          placeholder="⌕  Search plugins"
          aria-label="Search plugins"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <section className="plugin-section" aria-label="App plugins">
        <div className="plugin-section-head">App plugins</div>
        <div className="plugin-grid" id="appPluginGrid">
          {APP_PLUGINS.filter(matches)
            .map((p, i) => ({ p, i }))
            .filter(({ i }) => !appCollapsed || i < 4)
            .map(({ p }) => (
              <PluginRow
                key={p.name}
                plugin={p}
                on={!!states[p.name]}
                onToggle={(next) => setPluginState(p.name, p.kind, next)}
              />
            ))}
        </div>
        <button
          type="button"
          className="show-less"
          onClick={() => setAppCollapsed((c) => !c)}
        >
          {appCollapsed ? "Show more" : "Show less"}
        </button>
      </section>

      <section className="plugin-section" aria-label="Developer Tools">
        <div className="plugin-section-head">Developer Tools</div>
        <div className="plugin-grid">
          {DEV_PLUGINS.filter(matches).map((p) => (
            <PluginRow
              key={p.name}
              plugin={p}
              on={!!states[p.name]}
              onToggle={(next) => setPluginState(p.name, p.kind, next)}
            />
          ))}
        </div>
      </section>
    </section>
  );
}

function PluginRow({
  plugin,
  on,
  onToggle,
}: {
  plugin: PluginItem;
  on: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="plugin-item" data-plugin={plugin.name}>
      <span className={cn("plugin-glyph", plugin.glyphClass)} aria-hidden>
        {plugin.glyph}
      </span>
      <div className="plugin-desc">
        <b>{plugin.name}</b>
        <small>{plugin.desc}</small>
      </div>
      {plugin.kind === "switch" ? (
        <button
          type="button"
          className={cn("switch", on && "on")}
          aria-label={`${plugin.name} plugin toggle`}
          aria-pressed={on}
          onClick={() => onToggle(!on)}
        />
      ) : (
        <button
          type="button"
          className="plugin-state"
          aria-pressed={on}
          onClick={() => onToggle(!on)}
        >
          {on ? "Installed" : "Install"}
        </button>
      )}
    </div>
  );
}
