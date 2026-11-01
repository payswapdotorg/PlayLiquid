import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toGameDTO } from "@/lib/serialize";
import type { LeaderboardsDTO } from "@/lib/types";

const GAME_INCLUDE = {
  creator: true,
  sessions: true,
  _count: { select: { comments: true } },
} as const;

/** Global leaderboards — top players by aggregated score + the most-played games. */
export async function GET() {
  const [grouped, topScoreRows, topGames] = await Promise.all([
    db.score.groupBy({
      by: ["player", "avatar"],
      _sum: { score: true },
      _count: { _all: true },
      orderBy: { _sum: { score: "desc" } },
      take: 12,
    }),
    db.score.findMany({
      orderBy: { score: "desc" },
      include: { game: { select: { title: true } } },
      take: 240,
    }),
    db.game.findMany({
      where: { status: "published" },
      include: GAME_INCLUDE,
      orderBy: { plays: "desc" },
      take: 8,
    }),
  ]);

  const bestByPlayer = new Map<string, string>();
  for (const row of topScoreRows) {
    const current = bestByPlayer.get(row.player);
    if (!current) bestByPlayer.set(row.player, row.game.title);
  }

  const dto: LeaderboardsDTO = {
    topPlayers: grouped.map((g) => ({
      player: g.player,
      avatar: g.avatar,
      totalScore: g._sum.score ?? 0,
      runs: g._count._all,
      bestGame: bestByPlayer.get(g.player) ?? "—",
    })),
    topGames: topGames.map((g) => toGameDTO(g)),
  };
  return NextResponse.json(dto);
}
