"use client";

/**
 * Game Builder — the creator workspace's flagship view (#view=build&game=…):
 * a live playtest canvas (GameEngine in manual or auto demo mode), a Build
 * Agent chat that retunes the theme via POST /api/agent, manual palette /
 * speed / difficulty / label controls, and Save draft / Publish via
 * POST /api/games/[id]/theme.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApi, postJson } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { CommentDTO, GameDetailDTO, GameDTO, GameTheme, ScoreDTO, UpdateDTO } from "@/lib/types";
import { GameEngine } from "../mini-games/game-engine";

interface GameDetailPayload {
  game: GameDetailDTO;
  related: GameDTO[];
  leaderboard: ScoreDTO[];
  updates: UpdateDTO[];
  comments: CommentDTO[];
}

/** Theme patch returned by the Build Agent (POST /api/agent). */
interface ThemePatch {
  palette?: Partial<Record<PaletteKey, number[]>>;
  speed?: number;
  difficulty?: number;
  label?: string;
}

type PaletteKey = "bg" | "accent" | "accent2" | "ball" | "platform";
type ChatMessage = { role: "user" | "assistant"; content: string };

const DEFAULT_THEME: GameTheme = {
  palette: {
    bg: [7, 0, 18],
    accent: [0, 240, 255],
    accent2: [255, 0, 212],
    ball: [255, 255, 255],
    platform: [0, 240, 255],
  },
  speed: 1,
  difficulty: 1,
  label: "Custom",
};

const PALETTE_ROWS: { key: PaletteKey; label: string }[] = [
  { key: "bg", label: "Background" },
  { key: "accent", label: "Accent" },
  { key: "accent2", label: "Accent 2" },
  { key: "ball", label: "Player" },
  { key: "platform", label: "Platforms" },
];

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
}

function rgbToHex(rgb: number[]): string {
  const [r = 0, g = 0, b = 0] = rgb;
  return `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): number[] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Server themes may be missing/empty (older seeded games) — default sensibly. */
function normalizeTheme(theme: GameTheme | null | undefined): GameTheme {
  const pal = theme?.palette;
  const color = (c: number[] | undefined, fallback: number[]): number[] =>
    Array.isArray(c) && c.length >= 3
      ? [clamp255(c[0]), clamp255(c[1]), clamp255(c[2])]
      : fallback;
  return {
    palette: {
      bg: color(pal?.bg, DEFAULT_THEME.palette.bg),
      accent: color(pal?.accent, DEFAULT_THEME.palette.accent),
      accent2: color(pal?.accent2, DEFAULT_THEME.palette.accent2),
      ball: color(pal?.ball, DEFAULT_THEME.palette.ball),
      platform: color(pal?.platform, DEFAULT_THEME.palette.platform),
    },
    speed:
      typeof theme?.speed === "number" && Number.isFinite(theme.speed)
        ? theme.speed
        : DEFAULT_THEME.speed,
    difficulty:
      typeof theme?.difficulty === "number" && Number.isFinite(theme.difficulty)
        ? theme.difficulty
        : DEFAULT_THEME.difficulty,
    label:
      typeof theme?.label === "string" && theme.label.trim() ? theme.label : DEFAULT_THEME.label,
  };
}

/** Merge a Build Agent patch into the current theme (clamped to safe ranges). */
function applyPatch(theme: GameTheme, patch: ThemePatch): GameTheme {
  const next: GameTheme = { ...theme, palette: { ...theme.palette } };
  if (patch.palette) {
    for (const row of PALETTE_ROWS) {
      const c = patch.palette[row.key];
      if (Array.isArray(c) && c.length >= 3) {
        next.palette[row.key] = [clamp255(c[0]), clamp255(c[1]), clamp255(c[2])];
      }
    }
  }
  if (typeof patch.speed === "number" && Number.isFinite(patch.speed)) {
    next.speed = Math.max(0.6, Math.min(1.6, patch.speed));
  }
  if (typeof patch.difficulty === "number" && Number.isFinite(patch.difficulty)) {
    next.difficulty = Math.max(0.6, Math.min(1.6, patch.difficulty));
  }
  if (typeof patch.label === "string" && patch.label.trim()) {
    next.label = patch.label.trim().slice(0, 24);
  }
  return next;
}

export function GameBuilderView() {
  const navigate = usePlayLiquid((s) => s.navigate);
  const gameId = usePlayLiquid((s) => s.gameId);
  const { data, loading, error } = useApi<GameDetailPayload>(
    gameId ? `/api/games/${gameId}` : null,
  );

  // local build state (canvas + panel) — initialized when a game loads
  const [theme, setTheme] = useState<GameTheme>(() => normalizeTheme(null));
  const [meta, setMeta] = useState<{ version: string; status: string }>({
    version: "—",
    status: "draft",
  });
  const [themeFor, setThemeFor] = useState<string | null>(null);
  const [mode, setMode] = useState<"play" | "auto">("play");
  const [restartKey, setRestartKey] = useState(0);

  // Build Agent chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  // saving (draft | publish)
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);

  // render-time sync: initialize the build whenever a (different) game arrives
  if (data && themeFor !== data.game.id) {
    setThemeFor(data.game.id);
    setTheme(normalizeTheme(data.game.theme));
    setMeta({ version: data.game.version, status: data.game.status });
    setMessages([]);
    setChatInput("");
  }

  // keep the newest agent message in view (DOM only — no state updates here)
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function sendAgentMessage() {
    const text = chatInput.trim();
    if (!data || !text || sending) return;
    const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setChatInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setSending(true);
    try {
      const res = await postJson<{ reply: string; patch: ThemePatch | null }>("/api/agent", {
        gameId: data.game.id,
        message: text,
        history,
      });
      setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
      const patch = res.patch;
      if (patch) {
        setTheme((t) => applyPatch(t, patch));
        toast.success("Theme updated");
      }
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            "I hit a snag reaching the build service — your build is untouched. Try again in a moment, or tweak the palette and sliders in the Build panel.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function saveTheme(status: "draft" | "publish") {
    if (!data || saving) return;
    setSaving(status);
    try {
      const res = await postJson<{ game: { version: string; themeJson: string; status: string } }>(
        `/api/games/${data.game.id}/theme`,
        status === "publish"
          ? { themeJson: JSON.stringify(theme), status: "published", version: "1.0.0" }
          : { themeJson: JSON.stringify(theme), status: "draft" },
      );
      setMeta({ version: res.game.version, status: res.game.status });
      if (status === "publish") {
        toast.success("Published to the PlayLiquid feed");
        navigate("play", { gameId: data.game.id });
      } else {
        toast.success("Draft saved");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the build");
    } finally {
      setSaving(null);
    }
  }

  function setPaletteColor(key: PaletteKey, rgb: number[]) {
    setTheme((t) => {
      const palette = { ...t.palette };
      palette[key] = rgb;
      return { ...t, palette };
    });
  }

  if (!gameId) {
    return (
      <section className="gb-shell" aria-label="Game Builder">
        <div
          className="desk-inner"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            textAlign: "center",
            minHeight: "70vh",
          }}
        >
          <p style={{ color: "#8293a8", fontSize: 13, margin: 0 }}>
            No game open — start a task or pick one from Your games.
          </p>
          <button type="button" className="gb-btn" onClick={() => navigate("newtask")}>
            Back to New task
          </button>
        </div>
      </section>
    );
  }

  // while switching games the previous payload may still be cached — show a
  // neutral loading state instead of the wrong build
  const stale = !!data && data.game.id !== gameId && data.game.slug !== gameId;
  if (error && (!data || stale)) {
    return (
      <section className="gb-shell" aria-label="Game Builder">
        <div
          className="desk-inner"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            textAlign: "center",
            minHeight: "70vh",
          }}
        >
          <p style={{ color: "#f0a9c4", fontSize: 13, margin: 0 }}>{error}</p>
          <button type="button" className="gb-btn" onClick={() => navigate("newtask")}>
            Back to New task
          </button>
        </div>
      </section>
    );
  }
  if (!data || loading || stale) {
    return (
      <section className="gb-shell" aria-label="Game Builder">
        <div
          className="desk-inner"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "70vh",
            color: "#8293a8",
            fontSize: 13,
          }}
        >
          Loading build…
        </div>
      </section>
    );
  }

  const game = data.game;
  const scenes = game.scenes;

  return (
    <section className="gb-shell" id="gameBuilderView" aria-label="Game Builder">
      <header className="gb-head">
        <h1>{game.title}</h1>
        <span className={cn("gb-badge", meta.status === "published" && "published")}>
          {meta.status}
        </span>
        <span style={{ fontSize: 11, color: "#71859b", whiteSpace: "nowrap" }}>
          {game.engine} engine · v{meta.version}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="gb-btn"
          disabled={saving !== null}
          onClick={() => void saveTheme("draft")}
        >
          {saving === "draft" ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          className="gb-btn primary"
          disabled={saving !== null}
          onClick={() => void saveTheme("publish")}
        >
          {saving === "publish" ? "Publishing…" : "Publish"}
        </button>
      </header>

      <div className="gb-body">
        <aside className="gb-chat" aria-label="Build Agent chat">
          <div className="gb-chat-head">
            Build Agent <span className="dot" aria-hidden />
          </div>
          <div className="gb-messages" ref={messagesRef}>
            <div className="gb-msg hint">
              Ask me to retune the game — e.g. “make it faster”, “neon purple palette”, “easier for
              kids”.
            </div>
            {messages.map((m, i) => (
              <div key={i} className={cn("gb-msg", m.role === "user" ? "user" : "agent")}>
                {m.content}
              </div>
            ))}
            {sending && <div className="gb-msg hint">Build Agent is thinking…</div>}
          </div>
          <div className="gb-chat-input">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendAgentMessage();
                }
              }}
              placeholder="Tell the agent what to change…"
              aria-label="Message the Build Agent"
              disabled={sending}
            />
            <button
              type="button"
              onClick={() => void sendAgentMessage()}
              disabled={sending || !chatInput.trim()}
              aria-label="Send message to the Build Agent"
            >
              Send
            </button>
          </div>
        </aside>

        <div className="gb-stage">
          <div className="gb-stage-bar">
            <span>
              Live playtest · {game.engine} engine · v{meta.version}
            </span>
            <span className="mode">
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
                Restart
              </button>
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#71859b", padding: "9px 14px 0" }} aria-live="polite">
            Theme · {theme.label}
          </div>
          <div className="gb-canvas">
            <div className="gb-canvas-inner">
              <GameEngine
                engine={game.engine}
                theme={theme}
                restartKey={restartKey}
                auto={mode === "auto"}
              />
            </div>
          </div>
        </div>

        <aside className="gb-panel" aria-label="Build panel">
          <h3>Build panel</h3>
          <p className="sub">Changes apply live to the playtest canvas. Save to keep them.</p>

          {PALETTE_ROWS.map((row) => (
            <div className="gb-color-row" key={row.key}>
              <span>{row.label}</span>
              <input
                type="color"
                aria-label={`${row.label} color`}
                value={rgbToHex(theme.palette[row.key])}
                onChange={(e) => setPaletteColor(row.key, hexToRgb(e.target.value))}
              />
              <code style={{ fontFamily: "monospace", fontSize: 10, color: "#71859b" }}>
                {rgbToHex(theme.palette[row.key])}
              </code>
            </div>
          ))}

          <div className="gb-field" style={{ marginTop: 14 }}>
            <label htmlFor="gb-speed">
              Speed <b>{theme.speed.toFixed(2)}</b>
            </label>
            <input
              id="gb-speed"
              type="range"
              className="gb-range"
              min={0.6}
              max={1.6}
              step={0.05}
              value={theme.speed}
              aria-label="Game speed"
              onChange={(e) => setTheme((t) => ({ ...t, speed: Number(e.target.value) }))}
            />
          </div>
          <div className="gb-field">
            <label htmlFor="gb-difficulty">
              Difficulty <b>{theme.difficulty.toFixed(2)}</b>
            </label>
            <input
              id="gb-difficulty"
              type="range"
              className="gb-range"
              min={0.6}
              max={1.6}
              step={0.05}
              value={theme.difficulty}
              aria-label="Game difficulty"
              onChange={(e) => setTheme((t) => ({ ...t, difficulty: Number(e.target.value) }))}
            />
          </div>
          <div className="gb-field">
            <label htmlFor="gb-label">Theme label</label>
            <input
              id="gb-label"
              type="text"
              value={theme.label}
              maxLength={24}
              aria-label="Theme label"
              onChange={(e) => setTheme((t) => ({ ...t, label: e.target.value }))}
              style={{
                width: "100%",
                height: 32,
                border: "1px solid #2d4256",
                borderRadius: 9,
                background: "#0a1119",
                color: "#e2edf8",
                padding: "0 11px",
                fontSize: 12,
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          </div>

          <h3 style={{ marginTop: 20 }}>Scenes</h3>
          {scenes.scenes.length + scenes.assets.length === 0 ? (
            <p className="sub">No scenes or assets yet — they appear once the draft is generated.</p>
          ) : (
            <div className="gb-scenes">
              {scenes.scenes.map((s) => (
                <div className="row" key={s.id}>
                  <span>{s.name}</span>
                  <span className="k">
                    {s.entities} entities · {s.kind}
                  </span>
                </div>
              ))}
              {scenes.assets.map((a) => (
                <div className="row" key={a.id}>
                  <span>{a.name}</span>
                  <span className="k">
                    {a.kind} · {a.size}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
