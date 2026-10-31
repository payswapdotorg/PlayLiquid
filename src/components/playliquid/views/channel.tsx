"use client";

/**
 * Channel page — ported from the Interface Reconstruction v2 design:
 * banner, identity (initials avatar, per-channel handle/description),
 * Join/Subscribe actions, and the seven tab panels.
 */
import { useState } from "react";
import { toast } from "sonner";
import { usePlayLiquid } from "@/lib/store";
import { cn } from "@/lib/utils";

type ChannelTab = "channelHome" | "channelVideos" | "channelShorts" | "channelLive" | "channelPlaylists" | "channelCommunity" | "channelAbout";

const TABS: { id: ChannelTab; label: string }[] = [
  { id: "channelHome", label: "Home" },
  { id: "channelVideos", label: "Videos" },
  { id: "channelShorts", label: "Shorts" },
  { id: "channelLive", label: "Live" },
  { id: "channelPlaylists", label: "Playlists" },
  { id: "channelCommunity", label: "Community" },
  { id: "channelAbout", label: "About" },
];

const SHORTS: { thumb: string; title: string; meta: string }[] = [
  { thumb: "", title: "The tiny router with a big range", meta: "46K views · 2 days ago" },
  { thumb: "s2", title: "Mesh networking on the move", meta: "38K views · 1 week ago" },
  { thumb: "s3", title: "Can this work without Wi-Fi?", meta: "27K views · 2 weeks ago" },
  { thumb: "s4", title: "Antenna range test", meta: "21K views · 3 weeks ago" },
  { thumb: "s5", title: "Open source hardware find", meta: "19K views · 1 month ago" },
];

const UPLOADS: { thumb: string; duration: string; title: string; meta: string }[] = [
  { thumb: "", duration: "54:20", title: "This Hotspot Pays for Itself", meta: "96K views · 1 day ago" },
  { thumb: "t2", duration: "12:01", title: "The Open-Source Internet Is Bigger Than I Thought", meta: "63K views · 3 weeks ago" },
  { thumb: "t3", duration: "59:02", title: "The Open Source Internet Is Here", meta: "2.6M views · 1 month ago" },
  { thumb: "t4", duration: "27:02", title: "The Anywhere Network is Here", meta: "499K views · 2 months ago" },
  { thumb: "t5", duration: "21:59", title: "How to Become Your Own ISP", meta: "1.3M views · 2 months ago" },
  { thumb: "t6", duration: "25:13", title: "This Wi-Fi Feels Illegal", meta: "176K views · 3 months ago" },
];

const PLAYLISTS: { art: string; title: string; count: string }[] = [
  { art: "⌁", title: "Build your own network", count: "12 videos" },
  { art: "◉", title: "Open-source hardware", count: "8 videos" },
  { art: "⌘", title: "Internet without ISPs", count: "6 videos" },
  { art: "⚡", title: "Field tests", count: "9 videos" },
];

export function ChannelView() {
  const channel = usePlayLiquid((s) => s.channel);
  const [tab, setTab] = useState<ChannelTab>("channelHome");
  const [subscribed, setSubscribed] = useState(false);
  const [sort, setSort] = useState("Latest");

  // per the design's openChannel(): reset to the Home tab and "Subscribe"
  // (blessed render-time reset when the channel changes)
  const [prevChannel, setPrevChannel] = useState(channel);
  if (prevChannel !== channel) {
    setPrevChannel(channel);
    setTab("channelHome");
    setSubscribed(false);
  }

  const isDataSlayer = channel === "Data Slayer";
  const initials =
    channel
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  const handle = isDataSlayer
    ? "@dataslayermedia · 544K subscribers · 256 videos"
    : "PlayLiquid creator channel";
  const description = isDataSlayer
    ? "Building an open source internet. Technology, networks and tools for a more open internet."
    : `Creator channel for ${channel} on PlayLiquid.`;

  return (
    <div className="channel-page">
      <div className="channel-banner">
        <span className="channel-banner-label" id="channelBannerLabel">
          {channel.toUpperCase()} · PLAYLIQUID CREATOR CHANNEL
        </span>
      </div>

      <div className="channel-identity">
        <div className="channel-avatar" id="channelAvatar" aria-hidden>
          {initials}
        </div>
        <div className="channel-meta">
          <h1 id="channelName">
            {channel} <span style={{ color: "#45c9e7", fontSize: 15 }}>✓</span>
          </h1>
          <p id="channelHandle">{handle}</p>
          <p className="channel-aboutline" id="channelDescription">
            {description}
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
            aria-pressed={subscribed}
            onClick={() => setSubscribed((s) => !s)}
          >
            {subscribed ? "Subscribed" : "Subscribe"}
          </button>
          <button
            type="button"
            className="round-action"
            title="Channel notifications"
            aria-label="Channel notifications"
            onClick={() => toast("Channel notifications enabled")}
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
          <div className="channel-featured">
            <div className="channel-feature-thumb">
              <span className="channel-feature-play" aria-hidden>
                ▶
              </span>
            </div>
            <div className="channel-feature-copy">
              <div className="kicker">Featured video</div>
              <h2>The Open-Source Internet Is Bigger Than I Thought</h2>
              <small>Data Slayer · 12:01 · 63K views</small>
              <p>
                Exploring the people and projects building networks outside the traditional
                internet infrastructure.
              </p>
              <button
                type="button"
                className="small-action"
                onClick={() => toast("Opening featured video")}
              >
                Watch featured video
              </button>
            </div>
          </div>

          <section className="channel-section">
            <div className="channel-section-head">
              <h2>Shorts</h2>
              <button type="button" className="channel-tab-link" onClick={() => setTab("channelShorts")}>
                View all
              </button>
            </div>
            <div className="channel-shorts-row">
              {SHORTS.map((s) => (
                <div key={s.title}>
                  <div className={cn("channel-short-thumb", s.thumb)} aria-hidden />
                  <div className="channel-short-info">
                    {s.title}
                    <small>{s.meta}</small>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="channel-section">
            <div className="channel-section-head">
              <h2>Uploads</h2>
              <button type="button" className="channel-tab-link" onClick={() => setTab("channelVideos")}>
                View all
              </button>
            </div>
            <div className="channel-video-grid">
              {UPLOADS.slice(0, 4).map((v) => (
                <ChannelVideo key={v.title} video={v} />
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === "channelVideos" && (
        <div className="channel-tab-panel active" id="channelVideos">
          <div className="filters" role="tablist" aria-label="Sort uploads">
            {["Latest", "Popular", "Oldest"].map((f) => (
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
          <div className="channel-video-grid">
            {UPLOADS.map((v) => (
              <ChannelVideo key={v.title} video={v} />
            ))}
          </div>
        </div>
      )}

      {tab === "channelShorts" && (
        <div className="channel-tab-panel active" id="channelShorts">
          <div className="channel-shorts-row">
            {SHORTS.map((s) => (
              <div key={s.title}>
                <div className={cn("channel-short-thumb", s.thumb)} aria-hidden />
                <div className="channel-short-info">
                  {s.title}
                  <small>{s.meta}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "channelLive" && (
        <div className="channel-tab-panel active" id="channelLive">
          <div className="page-empty">
            No live streams are currently active.
            <br />
            <small>Past live streams will appear here.</small>
          </div>
        </div>
      )}

      {tab === "channelPlaylists" && (
        <div className="channel-tab-panel active" id="channelPlaylists">
          <div className="channel-playlists">
            {PLAYLISTS.map((p) => (
              <div className="playlist-card" key={p.title}>
                <div className="playlist-art" aria-hidden>
                  {p.art}
                </div>
                <b>{p.title}</b>
                <small>{p.count}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "channelCommunity" && (
        <div className="channel-tab-panel active" id="channelCommunity">
          <div className="channel-post">
            <span
              className="channel-avatar"
              style={{ width: 42, height: 42, fontSize: 13, borderWidth: 1 }}
              aria-hidden
            >
              {initials}
            </span>
            <div>
              <b>{channel}</b>
              <small> · 4 days ago</small>
              <p>
                What should we test next: a longer-range mesh node or a fully off-grid hotspot
                build?
              </p>
              <button
                type="button"
                className="small-action"
                onClick={() => toast("Poll selected")}
              >
                Vote on the poll
              </button>
            </div>
          </div>
          <div className="channel-post">
            <span
              className="channel-avatar"
              style={{ width: 42, height: 42, fontSize: 13, borderWidth: 1 }}
              aria-hidden
            >
              {initials}
            </span>
            <div>
              <b>{channel}</b>
              <small> · 2 weeks ago</small>
              <p>
                New video is up. This one takes us out into the field to test a network that works
                without traditional infrastructure.
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === "channelAbout" && (
        <div className="channel-tab-panel active" id="channelAbout">
          <div className="channel-about">
            <h3>About</h3>
            <p>
              Building an open source internet. {channel} explores technologies that enable an
              internet independent of traditional ISPs, including open networking protocols, radio
              hardware, mesh networks and long-range wireless experiments.
            </p>
            <p>544K subscribers · 256 videos · Joined February 14, 2016</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelVideo({ video }: { video: { thumb: string; duration: string; title: string; meta: string } }) {
  return (
    <div className="channel-video">
      <div className={cn("channel-thumb", video.thumb)}>
        <span className="duration">{video.duration}</span>
      </div>
      <h3>{video.title}</h3>
      <p>{video.meta}</p>
    </div>
  );
}
