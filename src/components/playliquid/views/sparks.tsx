"use client";

/**
 * Sparks — the vertical full-height feed, now backed by GET /api/sparks:
 * real clips layered over the animated scene backdrops, snap scrolling with
 * cursor paging on the arrows, server-persisted likes/follows, a comments
 * drawer, share deep-links, clear-screen mode and per-stage context menus.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { postJson, useApi } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { formatCount, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CommentDTO, CreatorDTO, SparkDTO, SparksPageDTO } from "@/lib/types";

/** Animated CSS backdrops kept under the real clips as poster/fallback. */
const SCENES = ["", "scene-two", "scene-three"];

export function SparksView({ initialIndex = 0 }: { initialIndex?: number }) {
  const navigate = usePlayLiquid((s) => s.navigate);
  const likedSparks = usePlayLiquid((s) => s.likedSparks);
  const toggleLikeSpark = usePlayLiquid((s) => s.toggleLikeSpark);
  const followedCreators = usePlayLiquid((s) => s.followedCreators);
  const toggleFollow = usePlayLiquid((s) => s.toggleFollow);
  const { data, loading, error, reload } = useApi<SparksPageDTO>("/api/sparks?cursor=0");

  // accumulated stages: the first page, plus pages appended while navigating
  const [sparks, setSparks] = useState<SparkDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [prevPage, setPrevPage] = useState<SparksPageDTO | null>(null);
  if (data && data !== prevPage) {
    setPrevPage(data);
    setSparks(data.sparks);
    setNextCursor(data.nextCursor);
  }

  // feed-level UI state
  const [muted, setMuted] = useState(true);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [likeOverrides, setLikeOverrides] = useState<Record<string, number>>({});
  const [postedComments, setPostedComments] = useState<Record<string, number>>({});
  const [clearScreen, setClearScreen] = useState(false);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (nextCursor === null || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const res = await fetch(`/api/sparks?cursor=${nextCursor}`);
      if (res.ok) {
        const page = (await res.json()) as SparksPageDTO;
        setSparks((prev) => [...prev, ...page.sparks]);
        setNextCursor(page.nextCursor);
      }
    } catch {
      /* keep the current stages — the arrows will retry */
    } finally {
      loadingMoreRef.current = false;
    }
  }, [nextCursor]);

  // deep link: page in more stages if the link points past the loaded ones,
  // then jump to the requested stage once it exists (once per link)
  const jumpedFor = useRef<number | null>(null);
  useEffect(() => {
    if (loading) return;
    if (sparks.length <= initialIndex && nextCursor !== null) {
      void loadMore();
      return;
    }
    if (initialIndex <= 0 || jumpedFor.current === initialIndex) return;
    const feed = feedRef.current;
    if (!feed || feed.children.length <= initialIndex) return;
    (feed.children[initialIndex] as HTMLElement | undefined)?.scrollIntoView({ block: "start" });
    jumpedFor.current = initialIndex;
  }, [loading, sparks.length, initialIndex, nextCursor, loadMore]);

  // close context menus on outside click
  useEffect(() => {
    if (menuOpenFor === null) return;
    function onDocClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest?.("[data-spark-menu],.spark-context-menu")) {
        setMenuOpenFor(null);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [menuOpenFor]);

  function step(dir: 1 | -1) {
    const feed = feedRef.current;
    if (!feed) return;
    // nearing the last loaded stage → pull the next page in
    const idx = Math.round(feed.scrollTop / Math.max(1, feed.clientHeight));
    if (dir === 1 && idx >= sparks.length - 2) void loadMore();
    feed.scrollBy({ top: dir * feed.clientHeight, behavior: "smooth" });
  }

  function likeSpark(spark: SparkDTO) {
    const next = !likedSparks[spark.id];
    toggleLikeSpark(spark.id);
    void postJson<{ likes: number }>(`/api/sparks/${spark.id}/like`, { liked: next })
      .then((r) => setLikeOverrides((o) => ({ ...o, [spark.id]: r.likes })))
      .catch(() => undefined);
  }

  function followCreator(creator: CreatorDTO) {
    const next = !followedCreators[creator.id];
    toggleFollow(creator.id);
    void postJson(`/api/creators/${creator.id}/follow`, { following: next }).catch(() => undefined);
  }

  async function share(index: number) {
    const link = `${window.location.origin}/#view=sparks&spark=${index}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Share link copied");
    } catch {
      toast.info(`Share: ${link}`);
    }
  }

  if (error && sparks.length === 0) {
    return (
      <div className="spark-layout" role="alert">
        <div className="page-empty" style={{ margin: "auto", maxWidth: 440 }}>
          Couldn&apos;t load Sparks
          <br />
          <small>{error}</small>
          <br />
          <button
            type="button"
            className="small-action"
            style={{ marginTop: 12 }}
            onClick={() => void reload()}
          >
            Try again
          </button>
        </div>
      </div>
    );
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
        {sparks.length === 0 && (
          <article className="spark-stage" aria-busy="true">
            <div className="spark-scene" aria-hidden />
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                color: "#cfe1f0",
                fontSize: 13,
                letterSpacing: ".4px",
              }}
            >
              Loading Sparks…
            </div>
          </article>
        )}

        {sparks.map((spark, i) => {
          const liked = !!likedSparks[spark.id];
          const likeCount = likeOverrides[spark.id] ?? spark.likes + (liked ? 1 : 0);
          const following = !!followedCreators[spark.creator.id];
          const commentCount = spark.commentCount + (postedComments[spark.id] ?? 0);
          return (
            <article
              key={spark.id}
              className="spark-stage"
              aria-label={`Spark: ${spark.title} by ${spark.creator.name}`}
            >
              <div className={cn("spark-scene", SCENES[i % SCENES.length])} aria-hidden />
              {spark.videoUrl && (
                <video
                  src={spark.videoUrl}
                  muted={muted}
                  loop
                  autoPlay
                  playsInline
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              )}
              <div className="spark-top">
                <button
                  type="button"
                  className="spark-badge"
                  aria-label={muted ? "Sound off" : "Sound on"}
                  onClick={() => setMuted((m) => !m)}
                >
                  {muted ? "🔇 Muted" : "🔊 Sound on"}
                </button>
                <span className="spark-badge">{spark.title}</span>
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
                  className={cn("spark-action", liked && "liked")}
                  aria-pressed={liked}
                  aria-label="Like this Spark"
                  onClick={() => likeSpark(spark)}
                >
                  <span className="action-icon" aria-hidden>
                    {liked ? "♥" : "♡"}
                  </span>
                  <span>{formatCount(likeCount)}</span>
                </button>
                <button
                  type="button"
                  className="spark-action"
                  aria-expanded={commentsFor === spark.id}
                  aria-label="Open comments"
                  onClick={() => setCommentsFor((c) => (c === spark.id ? null : spark.id))}
                >
                  <span className="action-icon" aria-hidden>
                    ▢
                  </span>
                  <span>{formatCount(commentCount)}</span>
                </button>
                <button
                  type="button"
                  className="spark-action"
                  aria-label="Share this Spark"
                  onClick={() => void share(i)}
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
                  aria-expanded={menuOpenFor === spark.id}
                  aria-label="More options"
                  onClick={() => setMenuOpenFor((m) => (m === spark.id ? null : spark.id))}
                >
                  <span className="action-icon" aria-hidden>
                    ⋮
                  </span>
                  <span>More</span>
                </button>
              </div>
              {menuOpenFor === spark.id && (
                <div className="spark-context-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpenFor(null);
                      toast("Feed preference saved");
                    }}
                  >
                    Not interested
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpenFor(null);
                      toast("Channel recommendations updated");
                    }}
                  >
                    Don&apos;t recommend this channel
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpenFor(null);
                      toast("Report options opened");
                    }}
                  >
                    Report
                  </button>
                </div>
              )}
              {commentsFor === spark.id && (
                <aside className="spark-drawer" aria-label={`Comments on ${spark.title}`}>
                  <div className="spark-drawer-head">
                    Comments · {commentCount}
                    <button
                      type="button"
                      onClick={() => setCommentsFor(null)}
                      aria-label="Close comments"
                    >
                      ×
                    </button>
                  </div>
                  <SparkComments
                    sparkId={spark.id}
                    onPosted={() =>
                      setPostedComments((p) => ({ ...p, [spark.id]: (p[spark.id] ?? 0) + 1 }))
                    }
                  />
                </aside>
              )}
              <div className="spark-bottom">
                <div className="spark-creator">
                  <span
                    className={cn("studio-avatar", spark.creator.avatarUrl && "has-img")}
                    aria-hidden
                  >
                    {spark.creator.avatarUrl ? (
                      <img src={spark.creator.avatarUrl} alt="" />
                    ) : (
                      spark.creator.name.slice(0, 1)
                    )}
                  </span>
                  <span>
                    <b
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate("channel", { channel: spark.creator.name })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          navigate("channel", { channel: spark.creator.name });
                        }
                      }}
                    >
                      {spark.creator.name}
                    </b>
                    <small>{formatCount(spark.creator.followers)} followers</small>
                  </span>
                  <button
                    type="button"
                    className="follow"
                    aria-pressed={following}
                    onClick={() => followCreator(spark.creator)}
                  >
                    {following ? "Following" : "Follow"}
                  </button>
                </div>
                <b style={{ display: "block", fontSize: 14, marginBottom: 4 }}>{spark.title}</b>
                <p>{spark.caption}</p>
                {spark.challenge && <span className="challenge">{spark.challenge}</span>}
              </div>
            </article>
          );
        })}
      </div>
      <div className="spark-nav-arrows">
        <button
          type="button"
          onClick={() => step(-1)}
          title="Previous Spark"
          aria-label="Previous Spark"
        >
          <ChevronUp className="size-5" strokeWidth={2} />
        </button>
        <button type="button" onClick={() => step(1)} title="Next Spark" aria-label="Next Spark">
          <ChevronDown className="size-5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/** The comments drawer body: fetches on open, posts prepend optimistically. */
function SparkComments({ sparkId, onPosted }: { sparkId: string; onPosted: () => void }) {
  const { data, loading, error } = useApi<{ comments: CommentDTO[] }>(
    `/api/sparks/${sparkId}/comments`,
  );
  const [draft, setDraft] = useState("");
  const [posted, setPosted] = useState<CommentDTO[]>([]);

  async function post() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      const res = await postJson<{ comment: CommentDTO }>(`/api/sparks/${sparkId}/comments`, {
        body: text,
      });
      setPosted((p) => [res.comment, ...p]);
      onPosted();
    } catch {
      toast.error("Could not post your comment");
    }
  }

  const comments = [...posted, ...(data?.comments ?? [])];

  return (
    <>
      <div className="spark-drawer-list">
        {loading && (
          <div className="spark-comment" style={{ color: "#8ba0b5", fontSize: 11 }}>
            Loading comments…
          </div>
        )}
        {error && (
          <div className="spark-comment" style={{ color: "#ff8ba0", fontSize: 11 }}>
            Could not load comments.
          </div>
        )}
        {!loading && !error && comments.length === 0 && (
          <div className="spark-comment" style={{ color: "#8ba0b5", fontSize: 11 }}>
            No comments yet — be the first.
          </div>
        )}
        {comments.map((c) => (
          <div className="spark-comment" key={c.id}>
            <img src={c.authorAvatar} alt="" />
            <div className="b">
              <span className="who">{c.authorName}</span>
              <span className="when">{timeAgo(c.createdAt)}</span>
              <p>{c.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="spark-drawer-input">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void post();
          }}
          placeholder="Add a comment…"
          aria-label="Add a comment"
        />
        <button type="button" onClick={() => void post()}>
          Post
        </button>
      </div>
    </>
  );
}
