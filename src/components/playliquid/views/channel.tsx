"use client";

/**
 * Channel page — a real creator channel from GET /api/creators/[idOrName]:
 * banner + identity, Join/Subscribe/notification actions, and the seven tab
 * panels (Home, Videos, Shorts, Live, Playlists, Community, About).
 */
import { useState } from "react";
import { toast } from "sonner";
import { postJson, useApi } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { formatCount, formatPlays, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChannelDTO, GameDTO, SparkDTO } from "@/lib/types";

type ChannelTab =
  | "channelHome"
  | "channelVideos"
  | "channelShorts"
  | "channelLive"
  | "channelPlaylists"
  | "channelCommunity"
  | "channelAbout";

const TABS: { id: ChannelTab; label: string }[] = [
  { id: "channelHome", label: "Home" },
  { id: "channelVideos", label: "Videos" },
  { id: "channelShorts", label: "Shorts" },
  { id: "channelLive", label: "Live" },
  { id: "channelPlaylists", label: "Playlists" },
  { id: "channelCommunity", label: "Community" },
  { id: "channelAbout", label: "About" },
];

type SortMode = "Latest" | "Popular" | "Oldest";

const SORTS: SortMode[] = ["Latest", "Popular", "Oldest"];

function sortGames(games: GameDTO[], mode: SortMode): GameDTO[] {
  const copy = [...games];
  if (mode === "Popular") return copy.sort((a, b) => b.plays - a.plays);
  if (mode === "Oldest") return copy.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
  return copy.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function ChannelView() {
  const channel = usePlayLiquid((s) => s.channel);
  const { data, loading, error, reload } = useApi<ChannelDTO>(
    `/api/creators/${encodeURIComponent(channel)}`,
  );

  const [tab, setTab] = useState<ChannelTab>("channelHome");
  const [sort, setSort] = useState<SortMode>("Latest");
  const [notify, setNotify] = useState(false);

  // when the resolved creator changes, reset the local panel state
  // (blessed render-time reset — no setState inside effects)
  const creatorId = data?.creator.id ?? null;
  const [prevCreatorId, setPrevCreatorId] = useState(creatorId);
  if (prevCreatorId !== creatorId) {
    setPrevCreatorId(creatorId);
    setTab("channelHome");
    setSort("Latest");
    setNotify(false);
  }

  const creator = data?.creator;
  const isCurrent =
    !!creator &&
    (creator.id === channel ||
      creator.name === channel ||
      creator.handle === channel ||
      creator.handle === `@${channel}`);

  return (
    <div className="channel-page">
      {loading && !isCurrent && (
        <div className="page-empty" aria-busy="true">
          Loading channel…
        </div>
      )}

      {error && (
        <div className="page-empty" role="alert">
          Studio not found
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
      )}

      {data && isCurrent && creator && (
        <ChannelBody
          data={data}
          tab={tab}
          setTab={setTab}
          sort={sort}
          setSort={setSort}
          notify={notify}
          setNotify={setNotify}
        />
      )}
    </div>
  );
}

function ChannelBody({
  data,
  tab,
  setTab,
  sort,
  setSort,
  notify,
  setNotify,
}: {
  data: ChannelDTO;
  tab: ChannelTab;
  setTab: (t: ChannelTab) => void;
  sort: SortMode;
  setSort: (s: SortMode) => void;
  notify: boolean;
  setNotify: (n: boolean) => void;
}) {
  const navigate = usePlayLiquid((s) => s.navigate);
  const toggleFollow = usePlayLiquid((s) => s.toggleFollow);
  const followedCreators = usePlayLiquid((s) => s.followedCreators);
  const { creator, games, sparks, stats, recentComments } = data;

  const following = !!followedCreators[creator.id];
  const initials = creator.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const featured = [...games].sort((a, b) => b.plays - a.plays)[0];
  const liveGames = games.filter((g) => g.isLive);
  const sortedGames = sortGames(games, sort);

  function toggleSubscribe() {
    const next = !following;
    toggleFollow(creator.id);
    void postJson(`/api/creators/${creator.id}/follow`, { following: next }).catch(
      () => undefined,
    );
  }

  function toggleNotify() {
    const next = !notify;
    setNotify(next);
    void postJson("/api/settings", {
      values: { [`notify:${creator.id}`]: String(next) },
    }).catch(() => undefined);
    toast(next ? "Channel notifications enabled" : "Channel notifications off");
  }

  return (
    <>
      <div className="channel-banner">
        <span className="channel-banner-label" id="channelBannerLabel">
          {creator.name.toUpperCase()} · PLAYLIQUID CREATOR CHANNEL
        </span>
      </div>

      <div className="channel-identity">
        <div className="channel-avatar" id="channelAvatar" aria-hidden>
          {creator.avatarUrl ? (
            <img
              src={creator.avatarUrl}
              alt=""
              style={{ width: "100%", height: "100%", borderRadius: "inherit", objectFit: "cover" }}
            />
          ) : (
            initials
          )}
        </div>
        <div className="channel-meta">
          <h1 id="channelName">
            {creator.name}{" "}
            {creator.verified && <span style={{ color: "#45c9e7", fontSize: 15 }}>✓</span>}
          </h1>
          <p id="channelHandle">
            {creator.handle} · {formatCount(stats.followers)} subscribers · {stats.videos} games
          </p>
          <p className="channel-aboutline" id="channelDescription">
            {creator.bio}
          </p>
        </div>
        <div className="channel-actions">
          <button
            type="button"
            className="join-btn"
            onClick={() => toast("Channel membership preview")}
          >
            Join
          </button>
          <button
            type="button"
            className="subscribe-btn"
            aria-pressed={following}
            onClick={toggleSubscribe}
          >
            {following ? "Subscribed" : "Subscribe"}
          </button>
          <button
            type="button"
            className="round-action"
            title="Channel notifications"
            aria-label="Channel notifications"
            aria-pressed={notify}
            onClick={toggleNotify}
          >
            ♧
          </button>
        </div>
      </div>

      <div className="channel-tabs" id="channelTabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={cn(tab === t.id && "active")}
            aria-selected={tab === t.id}
            role="tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "channelHome" && (
        <div className="channel-tab-panel active" id="channelHome">
          {featured ? (
            <div className="channel-featured">
              <div className="channel-feature-thumb">
                <img
                  src={featured.thumbnailUrl}
                  alt=""
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
                <span className="channel-feature-play" aria-hidden>
                  ▶
                </span>
              </div>
              <div className="channel-feature-copy">
                <div className="kicker">Featured game</div>
                <h2>{featured.title}</h2>
                <small>
                  {creator.name} · {formatPlays(featured.plays)} · {timeAgo(featured.updatedAt)}
                </small>
                <p>{featured.description}</p>
                <button
                  type="button"
                  className="small-action"
                  onClick={() => navigate("play", { gameId: featured.id })}
                >
                  Play now
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-note">This studio hasn&apos;t published any games yet.</div>
          )}

          {sparks.length > 0 && (
            <section className="channel-section">
              <div className="channel-section-head">
                <h2>Shorts</h2>
                <button
                  type="button"
                  className="channel-tab-link"
                  onClick={() => setTab("channelShorts")}
                >
                  View all
                </button>
              </div>
              <div className="channel-shorts-row">
                {sparks.slice(0, 4).map((s) => (
                  <ChannelShort key={s.id} spark={s} />
                ))}
              </div>
            </section>
          )}

          {games.length > 0 && (
            <section className="channel-section">
              <div className="channel-section-head">
                <h2>Uploads</h2>
                <button
                  type="button"
                  className="channel-tab-link"
                  onClick={() => setTab("channelVideos")}
                >
                  View all
                </button>
              </div>
              <div className="channel-video-grid">
                {sortedGames.slice(0, 4).map((g) => (
                  <ChannelVideo key={g.id} game={g} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {tab === "channelVideos" && (
        <div className="channel-tab-panel active" id="channelVideos">
          <div className="filters" role="tablist" aria-label="Sort uploads">
            {SORTS.map((f) => (
              <button
                key={f}
                type="button"
                className={cn("filter", sort === f && "active")}
                onClick={() => setSort(f)}
              >
                {f}
              </button>
            ))}
          </div>
          {games.length === 0 ? (
            <div className="empty-note">No uploads yet.</div>
          ) : (
            <div className="channel-video-grid">
              {sortedGames.map((g) => (
                <ChannelVideo key={g.id} game={g} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "channelShorts" && (
        <div className="channel-tab-panel active" id="channelShorts">
          {sparks.length === 0 ? (
            <div className="empty-note">No Shorts yet.</div>
          ) : (
            <div className="channel-shorts-row">
              {sparks.map((s) => (
                <ChannelShort key={s.id} spark={s} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "channelLive" && (
        <div className="channel-tab-panel active" id="channelLive">
          {liveGames.length === 0 ? (
            <div className="page-empty">
              No live streams are currently active.
              <br />
              <small>Past live streams will appear here.</small>
            </div>
          ) : (
            <div className="channel-video-grid">
              {liveGames.map((g) => (
                <ChannelVideo key={g.id} game={g} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "channelPlaylists" && (
        <div className="channel-tab-panel active" id="channelPlaylists">
          {games.length === 0 ? (
            <div className="empty-note">No playlists yet.</div>
          ) : (
            <div className="channel-playlists">
              {groupedByCategory(games).map(([category, list]) => (
                <button
                  type="button"
                  className="playlist-card"
                  key={category}
                  onClick={() => navigate("play", { gameId: list[0].id })}
                  style={{ textAlign: "left", border: "1px solid #263342", cursor: "pointer" }}
                >
                  <div className="playlist-art" aria-hidden>
                    <img
                      src={list[0].thumbnailUrl}
                      alt=""
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        borderRadius: "inherit",
                      }}
                    />
                    <span style={{ position: "relative", fontSize: 22, color: "#eaf7ff" }}>▶</span>
                  </div>
                  <b>{category}</b>
                  <small>
                    {list.length} {list.length === 1 ? "game" : "games"}
                  </small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "channelCommunity" && (
        <div className="channel-tab-panel active" id="channelCommunity">
          {recentComments.length === 0 ? (
            <div className="empty-note">No community activity yet.</div>
          ) : (
            recentComments.map((c) => (
              <div className="channel-post" key={c.id}>
                <img
                  src={c.authorAvatar}
                  alt=""
                  width={42}
                  height={42}
                  style={{ borderRadius: "50%", objectFit: "cover", flex: "none" }}
                />
                <div>
                  <b>{c.authorName}</b>
                  <small>
                    {" "}
                    · on {c.gameTitle} · {timeAgo(c.createdAt)}
                  </small>
                  <p>{c.body}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "channelAbout" && (
        <div className="channel-tab-panel active" id="channelAbout">
          <div className="channel-about">
            <h3>About</h3>
            <p>{creator.bio}</p>
            <p>
              {stats.videos} games · {stats.sparks} sparks · {formatCount(stats.totalPlays)} plays
              · Joined{" "}
              {new Date(stats.joinedAt).toLocaleDateString(undefined, {
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function groupedByCategory(games: GameDTO[]): [string, GameDTO[]][] {
  const map = new Map<string, GameDTO[]>();
  for (const g of games) {
    const list = map.get(g.category) ?? [];
    list.push(g);
    map.set(g.category, list);
  }
  return [...map.entries()];
}

const CARD_RESET = {
  border: 0,
  background: "transparent",
  padding: 0,
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
} as const;

function ChannelVideo({ game }: { game: GameDTO }) {
  const navigate = usePlayLiquid((s) => s.navigate);
  return (
    <button
      type="button"
      className="channel-video"
      style={{ ...CARD_RESET, textAlign: "left" }}
      onClick={() => navigate("play", { gameId: game.id })}
      aria-label={`Play ${game.title}`}
    >
      <div className="channel-thumb">
        <img
          src={game.thumbnailUrl}
          alt=""
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
        <span className="duration">{game.durationMin} min</span>
      </div>
      <h3>{game.title}</h3>
      <p>
        {formatPlays(game.plays)} · {timeAgo(game.updatedAt)}
      </p>
    </button>
  );
}

function ChannelShort({ spark }: { spark: SparkDTO }) {
  const navigate = usePlayLiquid((s) => s.navigate);
  return (
    <button
      type="button"
      onClick={() =>
        spark.game ? navigate("play", { gameId: spark.game.id }) : navigate("sparks")
      }
      aria-label={`Open ${spark.title}`}
      style={CARD_RESET}
    >
      <div className="channel-short-thumb">
        <video
          src={spark.videoUrl}
          muted
          loop
          playsInline
          preload="metadata"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          onMouseEnter={(e) => e.currentTarget.play().catch(() => undefined)}
          onMouseLeave={(e) => {
            e.currentTarget.pause();
            e.currentTarget.currentTime = 0;
          }}
        />
      </div>
      <div className="channel-short-info">
        {spark.title}
        <small>
          {formatCount(spark.likes)} likes · {spark.game ? spark.game.title : "PlayLiquid"}
        </small>
      </div>
    </button>
  );
}
