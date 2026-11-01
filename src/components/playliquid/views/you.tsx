"use client";

/** You — your studio dashboard: totals, games, comments, weekly plays, Sparks. */
import { useApi } from "@/hooks/use-api";
import { GameCard } from "../game-card";
import { formatCount, timeAgo } from "@/lib/format";
import type { StudioDTO } from "@/lib/types";

export function YouView() {
  const { data, loading, error, reload } = useApi<StudioDTO>("/api/studio");
  const me = data?.myGames[0]?.creator;
  const name = me?.name ?? "PlayLiquid Labs";
  const maxPlays = data ? Math.max(1, ...data.playStats.map((p) => p.plays)) : 1;

  return (
    <section aria-label="Your profile">
      <div className="page-head">
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          {me?.avatarUrl ? (
            <img
              src={me.avatarUrl}
              alt=""
              width={64}
              height={64}
              style={{
                borderRadius: "50%",
                objectFit: "cover",
                flex: "none",
                border: "3px solid #16323f",
              }}
            />
          ) : (
            <span className="studio-avatar" style={{ width: 64, height: 64, fontSize: 24 }} aria-hidden>
              ✦
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="kicker">Your studio</div>
            <h1>{name}</h1>
            <p>
              {me ? `${me.handle} · ` : ""}
              {me?.bio ?? "Profile, activity and followed studios."}
            </p>
          </div>
        </div>
      </div>

      {loading && (
        <div className="page-empty" aria-busy="true">
          Loading your studio…
        </div>
      )}
      {error && (
        <div className="page-empty" role="alert">
          Something went wrong
          <br />
          <small>{error}</small>
          <br />
          <button type="button" className="small-action" style={{ marginTop: 12 }} onClick={() => void reload()}>
            Try again
          </button>
        </div>
      )}

      {data && (
        <>
          <div className="you-stats">
            <Stat label="Games" value={data.totals.games.toLocaleString()} />
            <Stat label="Plays" value={formatCount(data.totals.plays)} />
            <Stat label="Likes" value={formatCount(data.totals.likes)} />
            <Stat label="Followers" value={formatCount(data.totals.followers)} />
            <Stat label="Sparks" value={data.totals.sparks.toLocaleString()} />
          </div>

          <div className="you-cols">
            <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
              <div className="you-card">
                <h3>Your games</h3>
                {data.myGames.length === 0 ? (
                  <div className="empty-note">No games yet — open New Task to build one.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {data.myGames.map((g) => (
                      <GameCard key={g.id} game={g} openBuild={g.status === "draft"} />
                    ))}
                  </div>
                )}
              </div>

              {data.savedGames.length > 0 && (
                <div className="you-card">
                  <h3>Saved to Library</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {data.savedGames.map((g) => (
                      <GameCard key={g.id} game={g} />
                    ))}
                  </div>
                </div>
              )}

              <div className="you-card">
                <h3>Recent comments</h3>
                {data.recentComments.length === 0 ? (
                  <div className="empty-note">No comments on your games yet.</div>
                ) : (
                  data.recentComments.map((c) => (
                    <div className="you-comment" key={c.id}>
                      <img src={c.authorAvatar} alt="" />
                      <div style={{ minWidth: 0 }}>
                        <span className="who" style={{ fontSize: 11, fontWeight: 700, color: "#cfe1f0" }}>
                          {c.authorName}
                        </span>{" "}
                        <span className="g">
                          on {c.gameTitle} · {timeAgo(c.createdAt)}
                        </span>
                        <p>{c.body}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
              <div className="you-card">
                <h3>Plays this week</h3>
                <div className="you-chart-wrap">
                  <div className="you-chart">
                    {data.playStats.map((p) => (
                      <div
                        key={p.label}
                        className="bar"
                        style={{ height: `${Math.max(6, Math.round((p.plays / maxPlays) * 100))}%` }}
                        title={`${p.plays.toLocaleString()} plays`}
                      >
                        <span>{p.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="you-card">
                <h3>Sparks</h3>
                {data.sparkStats.length === 0 ? (
                  <div className="empty-note">No Sparks yet.</div>
                ) : (
                  data.sparkStats.map((s) => (
                    <div className="you-spark-row" key={s.label}>
                      <span className="n">{s.sparkTitle}</span>
                      <span className="v">{formatCount(s.likes)} likes</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="you-stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
