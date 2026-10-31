"use client";

/**
 * Sparks — the vertical full-height feed, ported from the Interface
 * Reconstruction v2 design: gradient scene stages, top badges, engagement
 * rail, per-stage context menus, clear-screen mode and snap navigation.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { usePlayLiquid } from "@/lib/store";
import { cn } from "@/lib/utils";

interface SparkStageData {
  scene: string; // "", "scene-two", "scene-three"
  title: string;
  likes: string;
  comments: string;
  avatar: string;
  creator: string;
  creatorMeta: string;
  followLabel: "Follow" | "Subscribe";
  caption: string;
  challenge: string;
}

const STAGES: SparkStageData[] = [
  {
    scene: "",
    title: "Lava Leap",
    likes: "71.5K",
    comments: "2",
    avatar: "🌋",
    creator: "Volcano Interactive",
    creatorMeta: "458K plays",
    followLabel: "Follow",
    caption: "SO close to 4k in Lava Leap. The magma got me at 3,980m 💀",
    challenge: "⚡ Beat my height: 3,980m",
  },
  {
    scene: "scene-two",
    title: "Beat Drop",
    likes: "28.2K",
    comments: "394",
    avatar: "🎧",
    creator: "Data Slayer",
    creatorMeta: "544K subscribers",
    followLabel: "Subscribe",
    caption: "Building a tiny rhythm machine from open hardware. Wait for the drop 🎛️",
    challenge: "♫ original sound · Data Slayer",
  },
  {
    scene: "scene-three",
    title: "Orb Catch",
    likes: "9.8K",
    comments: "126",
    avatar: "🟣",
    creator: "Pixel Pioneers",
    creatorMeta: "86K subscribers",
    followLabel: "Follow",
    caption: "One more round. Just one more round. ✨",
    challenge: "Play this Spark · 00:18",
  },
];

export function SparksView({ initialIndex = 0 }: { initialIndex?: number }) {
  const navigate = usePlayLiquid((s) => s.navigate);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const [liked, setLiked] = useState<Record<number, boolean>>({});
  const [soundOn, setSoundOn] = useState<Record<number, boolean>>({});
  const [following, setFollowing] = useState<Record<number, boolean>>({});
  const [menuOpen, setMenuOpen] = useState<number | null>(null);
  const [clearScreen, setClearScreen] = useState(false);

  // jump to the requested stage (deep link from the home shelf)
  useEffect(() => {
    if (initialIndex > 0 && feedRef.current) {
      const slide = feedRef.current.children[initialIndex] as HTMLElement | undefined;
      slide?.scrollIntoView({ block: "start" });
    }
  }, [initialIndex]);

  // close context menus on outside click
  useEffect(() => {
    if (menuOpen === null) return;
    function onDocClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest?.("[data-spark-menu],.spark-context-menu")) {
        setMenuOpen(null);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [menuOpen]);

  function step(dir: 1 | -1) {
    feedRef.current?.scrollBy({ top: dir * feedRef.current.clientHeight, behavior: "smooth" });
  }

  return (
    <div className="spark-layout">
      <div
        ref={feedRef}
        id="sparkFeed"
        className={cn("spark-feed", clearScreen && "clear-screen")}
        role="feed"
        aria-label="Sparks feed"
      >
        {STAGES.map((stage, i) => (
          <article
            key={stage.title}
            className="spark-stage"
            aria-label={`Spark: ${stage.title} by ${stage.creator}`}
          >
            <div className={cn("spark-scene", stage.scene)} aria-hidden />
            <div className="spark-top">
              <button
                type="button"
                className="spark-badge"
                aria-label={soundOn[i] ? "Sound on" : "Muted"}
                onClick={() => setSoundOn((s) => ({ ...s, [i]: !s[i] }))}
              >
                {soundOn[i] ? "🔊 Sound on" : "🔇 Muted"}
              </button>
              <span className="spark-badge">{stage.title}</span>
            </div>
            <button
              type="button"
              className="spark-clear"
              onClick={() => setClearScreen((c) => !c)}
            >
              Clear screen
            </button>
            <div className="spark-actions">
              <button
                type="button"
                className={cn("spark-action", liked[i] && "liked")}
                aria-pressed={!!liked[i]}
                aria-label="Like this Spark"
                onClick={() => setLiked((l) => ({ ...l, [i]: !l[i] }))}
              >
                <span className="action-icon" aria-hidden>
                  {liked[i] ? "♥" : "♡"}
                </span>
                <span>{stage.likes}</span>
              </button>
              <button
                type="button"
                className="spark-action"
                aria-label="Open comments"
                onClick={() => toast("Comments opened")}
              >
                <span className="action-icon" aria-hidden>
                  ▢
                </span>
                <span>{stage.comments}</span>
              </button>
              <button
                type="button"
                className="spark-action"
                aria-label="Share this Spark"
                onClick={() => toast("Share link copied")}
              >
                <span className="action-icon" aria-hidden>
                  ♧
                </span>
                <span>Share</span>
              </button>
              <button
                type="button"
                className="spark-action"
                aria-label="Open the sound page"
                onClick={() => toast("Sound page opened")}
              >
                <span className="action-icon" aria-hidden>
                  ♫
                </span>
                <span>Sound</span>
              </button>
              <button
                type="button"
                className="spark-action"
                data-spark-menu
                aria-haspopup="menu"
                aria-expanded={menuOpen === i}
                aria-label="More options"
                onClick={() => setMenuOpen((m) => (m === i ? null : i))}
              >
                <span className="action-icon" aria-hidden>
                  ⋮
                </span>
                <span>More</span>
              </button>
            </div>
            {menuOpen === i && (
              <div className="spark-context-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(null);
                    toast("Feed preference saved");
                  }}
                >
                  Not interested
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(null);
                    toast("Channel recommendations updated");
                  }}
                >
                  Don&apos;t recommend this channel
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(null);
                    toast("Report options opened");
                  }}
                >
                  Report
                </button>
              </div>
            )}
            <div className="spark-bottom">
              <div className="spark-creator">
                <span className="studio-avatar" aria-hidden>
                  {stage.avatar}
                </span>
                <span>
                  <b
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate("channel", { channel: stage.creator })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") navigate("channel", { channel: stage.creator });
                    }}
                  >
                    {stage.creator}
                  </b>
                  <small>{stage.creatorMeta}</small>
                </span>
                <button
                  type="button"
                  className="follow"
                  onClick={() => setFollowing((f) => ({ ...f, [i]: !f[i] }))}
                >
                  {following[i]
                    ? stage.followLabel === "Follow"
                      ? "Following"
                      : "Subscribed"
                    : stage.followLabel}
                </button>
              </div>
              <p>{stage.caption}</p>
              <span className="challenge">{stage.challenge}</span>
            </div>
          </article>
        ))}
      </div>
      <div className="spark-nav-arrows">
        <button type="button" onClick={() => step(-1)} title="Previous Spark" aria-label="Previous Spark">
          <ChevronUp className="size-5" strokeWidth={2} />
        </button>
        <button type="button" onClick={() => step(1)} title="Next Spark" aria-label="Next Spark">
          <ChevronDown className="size-5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
