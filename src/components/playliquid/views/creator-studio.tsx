"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MessageSquare, Rocket, TrendingUp } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useApi } from "@/hooks/use-api";
import { usePlayLiquid } from "@/lib/store";
import { formatCount, timeAgo } from "@/lib/format";
import type { StudioDTO } from "@/lib/types";

/** Creator Studio — analytics, releases, community moderation. */
export function CreatorStudioView() {
  const navigate = usePlayLiquid((s) => s.navigate);
  const { data, loading } = useApi<StudioDTO>("/api/studio");

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="mt-6 h-72 rounded-2xl" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:px-6">
      <h1 className="text-2xl font-bold">Creator Studio</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Analytics, releases and community health across your studio.
      </p>

      {/* analytics */}
      <section aria-label="Plays this week" className="mt-6 rounded-2xl border border-border/70 bg-card/40 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="size-4 text-pl-cyan" /> Plays this week
        </h2>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.playStats} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.08} vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "currentColor", opacity: 0.55 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "currentColor", opacity: 0.55 }} />
              <Tooltip
                cursor={{ fill: "currentColor", opacity: 0.06 }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="plays" fill="var(--pl-cyan)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* release table */}
      <section aria-label="Games and releases" className="mt-6 overflow-hidden rounded-2xl border border-border/70">
        <h2 className="flex items-center gap-2 border-b border-border/60 bg-card/60 px-5 py-4 text-sm font-semibold">
          <Rocket className="size-4 text-pl-cyan" /> Games & releases
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Your games with plays, likes and status</caption>
            <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-3">Game</th>
                <th scope="col" className="px-5 py-3">Version</th>
                <th scope="col" className="px-5 py-3 text-right">Plays</th>
                <th scope="col" className="px-5 py-3 text-right">Likes</th>
                <th scope="col" className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.myGames.map((g) => (
                <tr
                  key={g.id}
                  className="cursor-pointer border-t border-border/50 transition-colors hover:bg-accent/30"
                  onClick={() => navigate("builder", { gameId: g.id })}
                >
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-3">
                      <img src={g.thumbnailUrl} alt="" className="h-9 w-16 rounded object-cover" />
                      <span>
                        <span className="block font-medium">{g.title}</span>
                        <span className="block text-xs text-muted-foreground">{g.category}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">{g.version}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{formatCount(g.plays)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{formatCount(g.likes)}</td>
                  <td className="px-5 py-3">
                    <Badge
                      variant="secondary"
                      className={g.status === "draft" ? "text-amber-400" : "text-emerald-400"}
                    >
                      {g.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* sparks performance + moderation */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section aria-label="Sparks performance" className="rounded-2xl border border-border/70 bg-card/40 p-5">
          <h2 className="text-sm font-semibold">Sparks performance</h2>
          <ul className="mt-4 space-y-3">
            {data.sparkStats.map((s) => (
              <li key={s.label} className="flex items-center gap-3 rounded-xl bg-secondary/40 p-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.sparkTitle}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatCount(s.plays)} plays
                  </span>
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  <span className="block font-mono text-sm text-pl-rose">♥ {formatCount(s.likes)}</span>
                </span>
              </li>
            ))}
            {data.sparkStats.length === 0 && (
              <li className="text-sm text-muted-foreground">No Sparks published yet.</li>
            )}
          </ul>
        </section>

        <section aria-label="Community moderation" className="rounded-2xl border border-border/70 bg-card/40 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="size-4 text-pl-cyan" /> Community moderation
          </h2>
          <ul className="mt-4 space-y-3">
            {data.recentComments.map((c) => (
              <li key={c.id} className="flex items-start gap-3">
                <Avatar className="size-8 shrink-0">
                  <AvatarImage src={c.authorAvatar} alt="" />
                  <AvatarFallback>{c.authorName.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{c.authorName}</span> on{" "}
                    <span className="text-pl-cyan">{c.gameTitle}</span> · {timeAgo(c.createdAt)}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-sm">{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
